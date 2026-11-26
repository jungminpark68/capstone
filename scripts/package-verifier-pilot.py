"""Build a 20-image review UI and a self-contained, reviewed-only Kaggle experiment."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))
from diary_verifier.pilot_data import make_source


def md(text):
    return {"cell_type": "markdown", "metadata": {}, "source": text.splitlines(True)}


def code(text):
    return {"cell_type": "code", "metadata": {}, "execution_count": None,
            "outputs": [], "source": text.splitlines(True)}


def notebook():
    sources = {"diary_verifier/" + p.name: p.read_text(encoding="utf-8")
               for p in sorted((ROOT / "ml/diary_verifier").glob("*.py"))}
    digest = hashlib.sha256(json.dumps(sources, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    cells = [md('''# 기억잇다 · 20장 판정기 학습 전후 예비 비교

01_review.html에서 **20장 모두 직접 확인한 검토 JSON**과 이 묶음의 source 폴더를 Kaggle Input에 연결하세요.
사진 생성과 유료 API 호출은 없습니다. 기본 비교는 **동일한 Qwen3-VL-4B의 추가 학습 전 / 일반 LoRA 학습 후**입니다.

자료는 채팅에서 생성한 색연필풍 20장·10개 사건입니다. 실제 앱 생성 모델과 동일하다고 주장하지 않습니다. 예비 실행이며 대규모 성능 입증이 아닙니다.
'''), code('''from pathlib import Path
import hashlib,json,os,subprocess,sys,zipfile

SOURCE_PATH=""  # 비우면 Kaggle Input에서 pilot-source.json 하나를 찾습니다.
REVIEW_PATH=""  # 비우면 memory-verifier-human-review.json 하나를 찾습니다.
BASE_MODEL="Qwen/Qwen3-VL-4B-Instruct"
METHODS=["plain"]  # 우선 학습 전/후만 비교. 추가 대조 실험: ["plain","relation"]
EPOCHS=2
BATCH_SIZE=2
ACCUMULATION=4
LEARNING_RATE=1e-4
LORA_RANK=16
PAIR_WEIGHT=0.25
TRAIN_SEED=42
MAX_PIXELS=200704
FOUR_BIT=True
BALANCED=True
WORK=Path("/kaggle/working/memory-verifier-pilot")
WORK.mkdir(parents=True,exist_ok=True)
PROJECT=WORK/"bundled-code"
'''), code("BUNDLED_SOURCES=" + repr(sources) + "\nBUNDLE_SHA256=" + repr(digest) + '''
assert hashlib.sha256(json.dumps(BUNDLED_SOURCES,ensure_ascii=False,sort_keys=True).encode()).hexdigest()==BUNDLE_SHA256
for name,source in BUNDLED_SOURCES.items():
    target=PROJECT/name
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(source,encoding="utf-8")
sys.path.insert(0,str(PROJECT))
os.environ["PYTHONPATH"]=str(PROJECT)
def run(*args):
    subprocess.run([sys.executable,"-m",*map(str,args)],check=True)
'''), md('''## 1. 자료 확인 · 정답이 없으면 학습 전에 중단

같은 사건의 두 그림은 같은 분할에 둡니다. 학습 12장·검증 4장·시험 4장으로 고정했습니다.
AI 초벌이나 생성 의도는 정답으로 사용하지 않습니다. 시험 정답은 초벌 답 없이 검토한 값만 받습니다.
입력 검사는 GPU 모델 다운로드보다 먼저 실행합니다. 누락된 정답을 채우거나 도식 자료로 대체하지 않습니다.
'''), code('''def find_one(pattern,explicit):
    if explicit:
        path=Path(explicit)
        if not path.is_file():raise FileNotFoundError(path)
        return path
    found=list(Path("/kaggle/input").rglob(pattern))
    if len(found)!=1:raise RuntimeError(f"{pattern} 파일이 정확히 하나 필요합니다. SOURCE_PATH/REVIEW_PATH에 경로를 지정하세요. ZIP만 보이면 압축을 풀어 Input에 연결하세요.")
    return found[0]
SOURCE=find_one("pilot-source.json",SOURCE_PATH)
REVIEWS=find_one("memory-verifier-human-review*.json",REVIEW_PATH)
from diary_verifier.pilot_data import prepare_reviewed
from diary_verifier.common import file_sha
DATA=WORK/("reviewed-"+file_sha(REVIEWS)[:12])
if DATA.exists():
    info=json.loads((DATA/"dataset-info.json").read_text())
    assert info["review_sha256"]==file_sha(REVIEWS) and info["source_sha256"]==file_sha(SOURCE),"기존 자료 지문이 달라요. 새 WORK 경로를 사용하세요."
else:
    info=prepare_reviewed(SOURCE,REVIEWS,DATA)
print(json.dumps(info,ensure_ascii=False,indent=2))
assert info["pilot_only"]
'''), md('''## 2. 라이브러리와 GPU

Kaggle의 GPU·Internet을 켭니다. T4 두 개의 메모리가 자동으로 합쳐지는 설정이 아니며 GPU 한 개를 사용합니다.
기반 모델은 공개 체크포인트입니다. 이 기본 후보가 최고 성능으로 확인됐다는 뜻은 아닙니다.
'''), code('''subprocess.run([sys.executable,"-m","pip","install","torch>=2.6,<3","torchvision>=0.21,<1","transformers==5.23.0","peft==0.21.3","accelerate>=1.2,<2","Pillow>=10.4,<13"],check=True)
if FOUR_BIT:
    subprocess.run([sys.executable,"-m","pip","install","bitsandbytes>=0.45,<1"],check=True)
import torch
assert torch.cuda.is_available(),"GPU를 켜세요. 이 VLM 파인튜닝은 CPU에서 실행하지 않습니다."
print("GPU:",torch.cuda.get_device_name(0))
'''), md('''## 3. 실험 계획 고정

학습 전/후에 같은 기반 가중치 revision·프롬프트·출력층·양자화 조건을 씁니다. 무작위 분류층을 순정 모델이라고 부르지 않습니다.
원래 모델의 A/B/C 다음 토큰 점수를 비교하고, 언어모델 내부 LoRA만 학습합니다. 비전 인코더와 원래 출력층은 고정합니다.
최적 epoch는 검증셋 Macro-F1로 선택합니다. 시험셋은 선택에 사용하지 않습니다.
'''), code('''from diary_verifier.vlm_benchmark import create_plan
number=1
RUN=WORK/f"experiment-{number:03d}"
while RUN.exists():
    number+=1;RUN=WORK/f"experiment-{number:03d}"
PLAN=create_plan(DATA,RUN,[BASE_MODEL],epochs=EPOCHS,batch_size=BATCH_SIZE,
                 accumulation=ACCUMULATION,lr=LEARNING_RATE,lora_rank=LORA_RANK,
                 pair_weight=PAIR_WEIGHT,seed=TRAIN_SEED,four_bit=FOUR_BIT,
                 max_pixels=MAX_PIXELS,balanced=BALANCED,methods=METHODS)
print("이번 실험:",RUN)
print(Path(PLAN).read_text())
'''), md('''## 4. 학습 전 / 학습 후 검증셋 비교

순정 모델 검증 → LoRA 학습 → 검증셋으로 고른 가중치의 예측과 비교표를 생성합니다.
점수가 좋아진다고 미리 가정하지 않습니다. 여기의 점수는 튜닝에 쓰는 검증 성능입니다.
'''), code('''run("diary_verifier.vlm_benchmark","develop","--plan",PLAN)
from IPython.display import display,HTML
display(HTML((RUN/"development-comparison.html").read_text()))
from diary_verifier.vlm_benchmark import gallery
CONDITIONS=["pretrained",*METHODS]
gallery(DATA/"dev.jsonl",[RUN/"development"/(name+".jsonl") for name in CONDITIONS],RUN/"development-examples.html")
display(HTML((RUN/"development-examples.html").read_text()))
print("분석용으로 먼저 development-comparison과 history.json을 보내 주세요. 시험은 아직 사용하지 않았습니다.")
'''), md('''## 5. 최종 예비 시험 · 설정을 결정한 뒤 이 셀만 실행

처음 Run All에서는 실행하지 않습니다. 검증 결과로 설정을 결정한 뒤 아래 첫 줄을 True로 바꾸고 **이 셀만** 실행하세요.
같은 시험 자료로 학습 전/후를 평가합니다. 시험 결과를 보고 추가 튜닝하면 새 독립 시험 자료가 필요합니다.
20장·10개 사건의 단일 검토자 파일이므로 예비 비교로 표시하며, 4장 시험 결과를 일반 성능으로 확대하지 않습니다.
'''), code('''RUN_FINAL_TEST=False
if RUN_FINAL_TEST:
    run("diary_verifier.vlm_benchmark","test","--plan",PLAN)
    display(HTML((RUN/"final-test-comparison.html").read_text()))
    gallery(DATA/"test.jsonl",[RUN/"final-test"/(name+".jsonl") for name in CONDITIONS],RUN/"final-test-examples.html")
    display(HTML((RUN/"final-test-examples.html").read_text()))
else:
    print("시험은 보류했습니다. 설정을 결정한 뒤 이 셀 첫 줄만 True로 바꿔 실행하세요.")
'''), md('''## 6. 결과 저장

검증/시험 HTML·CSV·JSON, 예측, 혼동행렬, 학습 기록과 LoRA 가중치, 고정 자료를 저장합니다. 큰 사전학습 모델 캐시는 제외합니다.
중단 전에도 이 셀을 실행해 현재 결과를 보관할 수 있습니다. 이 노트북에서 세션 중단 후 기울기 상태까지 이어 학습하는 기능은 제공하지 않습니다.
'''), code('''RESULT=WORK/(RUN.name+"-results.zip")
with zipfile.ZipFile(RESULT,"w",zipfile.ZIP_DEFLATED) as archive:
    for folder in [RUN,DATA,PROJECT]:
        for path in folder.rglob("*"):
            if path.is_file() and "__pycache__" not in path.parts:
                archive.write(path,path.relative_to(WORK))
print("Kaggle Output에서 받을 파일:",RESULT)
print("실제 학습 결과와 LoRA 가중치는 이 셀 실행 뒤 생성됩니다. 배포 묶음에 미리 들어 있지 않습니다.")
''')]
    for i, cell in enumerate(cells):
        cell["id"] = f"pilot-{i:02d}"
    return {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.12"},
            "memory_connect": {"self_contained": True, "pilot_only": True, "contains_trained_results": False,
                               "version": "0.20.0", "bundle_sha256": digest}}, "nbformat": 4, "nbformat_minor": 5}


def build(manifest, out):
    out = Path(out).resolve()
    if out.exists():
        raise ValueError("Use a new ZIP filename")
    with tempfile.TemporaryDirectory(prefix="memory-pilot-") as folder:
        root = Path(folder) / "memory-verifier-pilot-v0.20"
        root.mkdir()
        source = make_source(manifest, root / "source")
        template = (ROOT / "ml/templates/pilot-review.html").read_text(encoding="utf-8")
        payload = json.dumps(source, ensure_ascii=False).replace("<", "\\u003c")
        (root / "01_review.html").write_text(template.replace("__PILOT_DATA__", payload), encoding="utf-8")
        (root / "02_train_compare_kaggle.ipynb").write_text(json.dumps(notebook(), ensure_ascii=False, indent=2), encoding="utf-8")
        shutil.copyfile(ROOT / "docs/verifier-pilot-guide.md", root / "README.md")
        out.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(out, "w", ZIP_DEFLATED) as archive:
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(root.parent))
    with ZipFile(out) as archive:
        assert archive.testzip() is None
        source = json.loads(archive.read("memory-verifier-pilot-v0.20/source/pilot-source.json"))
        assert len(source["items"]) == 20
        assert all("draft_label" not in f for r in source["items"] if source["groups"][r["group_id"]] == "test" for f in r["facts"])
    print(json.dumps({"file": str(out), "bytes": out.stat().st_size, "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
                      "dataset_id": source["dataset_id"], "images": 20, "facts": 160, "trained_results_included": False}, ensure_ascii=False))


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", required=True)
    p.add_argument("--out", required=True)
    a = p.parse_args()
    build(a.manifest, a.out)
