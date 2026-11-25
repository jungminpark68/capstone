"""Bundle API-free image collection and strict pretrained/LoRA comparison notebooks."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).parent
MODULES = ["__init__", "common", "prepare", "losses", "shared_encoder", "synthetic",
           "free_diary_data", "model", "train", "predict", "evaluate", "vlm_benchmark"]


def md(text):
    return {"cell_type": "markdown", "metadata": {}, "source": text.splitlines(True)}


def code(text):
    return {"cell_type": "code", "metadata": {}, "source": text.splitlines(True),
            "outputs": [], "execution_count": None}


def bundled():
    sources = {"diary_verifier/" + name + ".py":
               (ROOT / "diary_verifier" / (name + ".py")).read_text() for name in MODULES}
    digest = hashlib.sha256(json.dumps(sources, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return code("BUNDLED_SOURCES=" + repr(sources) + "\nBUNDLE_SHA256=" + repr(digest) + '''
import hashlib
assert hashlib.sha256(json.dumps(BUNDLED_SOURCES,ensure_ascii=False,sort_keys=True).encode()).hexdigest()==BUNDLE_SHA256
for name,source in BUNDLED_SOURCES.items():
    target=PROJECT/name
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(source,encoding="utf-8")
print("준비한 소스:",len(BUNDLED_SOURCES),"개")
''')


def setup(root):
    return code('''from pathlib import Path
import os,sys,json,subprocess,zipfile
WORK_ROOT=Path(''' + repr(root) + ''')
WORK_ROOT.mkdir(parents=True,exist_ok=True)
PROJECT=WORK_ROOT/"bundled-code"
os.environ["PYTHONPATH"]=str(PROJECT)
os.environ["HF_HOME"]=str(WORK_ROOT/"hf-cache")
sys.path.insert(0,str(PROJECT))
for name in list(sys.modules):
    if name=="diary_verifier" or name.startswith("diary_verifier."):sys.modules.pop(name,None)
def run(*args):
    subprocess.run([sys.executable,"-m",*map(str,args)],check=True,env=os.environ.copy())
''')


def generation():
    return [
        md("""# ① 무료 색연필풍 그림 자료 만들기 · SDXL

Kaggle 무료 GPU 할당 범위에서 공개 SDXL 가중치를 직접 실행합니다. 이미지당 API 요금과 API 키는 없습니다. GPU 시간·디스크 제한은 적용됩니다. 모델 이용 조건은 모델 카드에서 확인하세요.

현재 앱의 '명료한 색연필 그림' 요청문에 맞춰 윤곽선·파스텔 색면·색연필 결·구별되는 인물과 사물을 요청합니다. **같은 생성 모델이나 동일 화풍을 보장하지 않습니다.** SDXL 대체 자료의 성능을 앱 생성 모델의 실제 성능·오류율로 해석하지 않습니다.

1. 우선 20장으로 화풍과 사물 구별을 확인합니다.
2. TOTAL_IMAGES를 100·300·1000으로 올려 이어서 생성합니다.
3. 그림과 원래 사건을 대조해 사실마다 사람이 정답을 붙입니다.
4. 검토 완료 자료를 사건 단위로 나누어 ② 판정기 노트북에 연결합니다.

생성 요청에 넣은 정상·오류 종류는 정답이 아닙니다. 생성 모델이 지시를 따르지 않을 수 있어 **모든 정답 칸은 비워 둡니다.**"""),
        setup("/kaggle/working/free-diary-data"),
        code('''SOURCE_NAME="pencil-sdxl-v1"
TOTAL_IMAGES=20       # 화풍 확인 후 100, 300, 1000 등으로 증가. 같은 SOURCE_NAME에서 이어 만듭니다.
RUN_GENERATION=True   # 정답 검토만 할 때 False로 바꾸고 Kaggle GPU도 꺼도 됩니다.
DATA_SEED=42
STEPS=25
SIZE=1024
GUIDANCE=6.5
CPU_OFFLOAD=True      # 메모리를 절약. GPU 메모리가 충분하면 False로 비교 가능합니다.
SOURCE=WORK_ROOT/SOURCE_NAME
RESTORE_SOURCE_DIR="" # 새 세션: Kaggle input에 보관한 압축 해제 source 폴더 경로
if RESTORE_SOURCE_DIR:
    import shutil
    if SOURCE.exists():raise RuntimeError("복원 대상 폴더가 이미 있습니다. 기존 파일을 덮어쓰지 않습니다.")
    shutil.copytree(Path(RESTORE_SOURCE_DIR),SOURCE)
REVIEWED=WORK_ROOT/(SOURCE_NAME+"-reviewed-v1")
BUILD_REVIEWED=False  # 사람이 정답 검토를 마친 뒤 True로 바꾸고 해당 셀을 실행합니다.
'''),
        bundled(),
        code('''subprocess.run([sys.executable,"-m","pip","install","torch>=2.6,<3","torchvision>=0.21,<1",
    "transformers==5.23.0","diffusers==0.43.0","accelerate>=1.2,<2","Pillow>=10.4,<13","ipywidgets>=8,<9"],check=True)
import torch
print("GPU:",torch.cuda.get_device_name(0) if torch.cuda.is_available() else "없음")
if RUN_GENERATION:assert torch.cuda.is_available(),"Kaggle에서 GPU를 켜세요."
'''),
        md("""## 생성 · 중단 뒤 이어 만들기

같은 폴더와 설정으로 재실행하면 저장한 그림을 검사하고 없는 그림부터 만듭니다. TOTAL_IMAGES만 늘리면 기존 그림·사람 정답을 유지하며 추가합니다. 화풍·모델·크기·시드·품질 설정을 바꾸려면 SOURCE_NAME을 새 이름으로 지정하세요.

같은 사건의 여러 생성 의도를 만들지만, 실제 그림에서 어떤 오류가 발생했는지는 검토 후 확정합니다. 이 초기 자료는 두 배경·네 행동을 중심으로 구성되어 있으므로 장수가 많아져도 실제 일상 전체를 대표하지는 않습니다."""),
        code('''args=["diary_verifier.free_diary_data","generate","--out",SOURCE,"--total",str(TOTAL_IMAGES),
      "--seed",str(DATA_SEED),"--steps",str(STEPS),"--size",str(SIZE),"--guidance",str(GUIDANCE)]
if not CPU_OFFLOAD:args.append("--no-cpu-offload")
if RUN_GENERATION:run(*args)
elif not (SOURCE/"generated-manifest.jsonl").exists():raise RuntimeError("검토할 생성 자료를 먼저 복원하세요.")
from diary_verifier.common import read_jsonl
from IPython.display import display,HTML
from PIL import Image
generated=read_jsonl(SOURCE/"generated-manifest.jsonl")
for row in generated[:4]:
    print(row["id"],row["scene"],row["characters"],sep="\\n")
    with Image.open(SOURCE/row["image"]) as image:
        preview=image.copy();preview.thumbnail((512,512));display(preview)
print("생성 장수:",len(generated),"· 정답은 아직 사람 검토가 필요합니다.")
'''),
        md("""## 사람이 정답 붙이기

아래 화면은 생성 의도나 모델 예측을 보여주지 않습니다. 그림과 원래 사건만 보고 일치·불일치·판단 불가를 선택하세요. 검토자 ID와 정답은 human-review.csv에 저장됩니다. CSV를 직접 편집해도 됩니다.

가려져 확인할 수 없으면 판단 불가, 명확하게 다른 행동이나 필수 대상 누락이면 불일치입니다. '정상으로 생성 요청했다'는 이유로 일치라고 선택하지 않습니다. 정식 시험 자료는 다른 팀원이 독립 검토한 뒤 이견을 조정하는 것이 좋습니다."""),
        code('''from diary_verifier.free_diary_data import review_widget
review_widget(SOURCE,start=0,reviewer="")
'''),
        md("""## 검토 완료 자료 만들기

모든 사실에 정답과 검토자 ID가 있는 그림만 포함합니다. 미완료 그림은 제외하며 개수를 보고합니다. 최소 6개 사건을 검토해야 합니다. 기본 20장은 화풍 확인용이므로 먼저 100장 이상으로 늘리세요.

같은 사건과 원본 이미지 묶음은 학습·검증·시험을 함께 나눕니다. 학습에는 일치·불일치·판단 불가가 필요하고, 관계 대조 학습에는 같은 사실의 일치/불일치 그림 쌍이 필요합니다. 부족하면 추가 자료를 검토하며 정답을 임의로 바꾸지 않습니다."""),
        code('''if BUILD_REVIEWED:
    run("diary_verifier.free_diary_data","prepare","--source",SOURCE,"--out",REVIEWED,"--seed",str(DATA_SEED))
    print((REVIEWED/"dataset-info.json").read_text(encoding="utf-8"))
else:
    print("BUILD_REVIEWED=False: 정답 검토 후 이 셀을 실행하세요.")
'''),
        md("""## 세션 종료 전 저장

아래 ZIP은 생성 그림·원래 사건·요청문·사람 정답 CSV와, 준비했다면 reviewed 자료를 포함합니다. 큰 모델 캐시는 제외합니다. Kaggle Output에서 ZIP을 저장하고 다음 세션에 이어 쓸 원본 폴더도 보관하세요.

② 노트북에서는 압축을 푼 reviewed 폴더를 DATA_DIR로 지정합니다. 데이터셋으로 올릴 경우 개인정보가 들어 있는 자료는 비공개로 보관하세요."""),
        code('''RESULT=WORK_ROOT/(SOURCE_NAME+"-data.zip")
with zipfile.ZipFile(RESULT,"w",zipfile.ZIP_DEFLATED) as archive:
    for label,folder in [("source",SOURCE),("reviewed",REVIEWED)]:
        if folder.exists():
            for path in folder.rglob("*"):
                if path.is_file() and path.suffix!=".tmp":archive.write(path,Path(label)/path.relative_to(folder))
print("저장할 파일:",RESULT)
'''),
    ]


def benchmark():
    return [
        md("""# ② 순정 모델 → 일반 LoRA → 오류 특화 LoRA

**추가 학습 전후에 같은 공개 VLM을 사용합니다.** 무작위 판정층을 추가하지 않고 원래 언어모델의 A/B/C 다음 토큰 점수를 사용합니다. 모든 조건의 프롬프트·출력·화질·양자화 설정을 맞춥니다.

- A: 순정 사전학습 모델. 추가 학습 없음.
- B: 같은 모델 + 사실별 3분류 LoRA.
- C: B와 같은 초기 모델·자료·배치·LoRA 설정 + 같은 사실의 일치/불일치 그림 쌍 대조 손실.

LoRA는 GPU 메모리를 줄이는 학습 도구입니다. C의 개선 여부를 실험하며 우수성·학술적 신규성을 미리 가정하지 않습니다. 비전 인코더와 기존 LM 출력층은 고정하고 언어모델 내부 LoRA를 학습합니다.

처음에는 자료 없이 schematic 모드로 연결을 확인할 수 있습니다. SDXL 그림을 사람 검토했다면 reviewed 모드로 바꾸세요. **실제 앱 생성 모델에 대한 성능은 별도 실제 자료가 필요합니다.**"""),
        setup("/kaggle/working/pretrained-lora-lab"),
        code('''DATA_MODE="schematic"       # schematic / reviewed
DATA_DIR=""                  # reviewed 모드: train/dev/test.jsonl과 dataset-info.json이 있는 폴더
SCHEMATIC_EVENTS=12           # 합성 도식 연결 확인용. 실제 색연필풍 그림이 아닙니다.
DATA_SEED=42
BASE_CANDIDATES=["Qwen/Qwen3-VL-4B-Instruct"]
# 필요하면 후보를 추가: "Qwen/Qwen2.5-VL-3B-Instruct"
# 후보는 순정 모델의 개발셋 성능으로 고릅니다. 이 기본값이 최적이라는 뜻은 아닙니다.
EPOCHS=2
BATCH_SIZE=2
ACCUMULATION=4
LEARNING_RATE=1e-4
LORA_RANK=16
PAIR_WEIGHT=0.25
TRAIN_SEED=42
FOUR_BIT=True
MAX_PIXELS=200704
BALANCED=True
RUN_FINAL_TEST=False         # 개발·튜닝 완료 후에만 True로 바꾸고 최종 시험 셀 실행
RUN=WORK_ROOT/"experiment-v1"
number=2
while RUN.exists():
    RUN=WORK_ROOT/f"experiment-v1-{number:02d}";number+=1
RUN.mkdir()
print("이번 실행:",RUN)
'''),
        bundled(),
        code('''subprocess.run([sys.executable,"-m","pip","install","torch>=2.6,<3","torchvision>=0.21,<1",
    "transformers==5.23.0","peft==0.21.3","accelerate>=1.2,<2","Pillow>=10.4,<13"],check=True)
if FOUR_BIT:
    subprocess.run([sys.executable,"-m","pip","install","bitsandbytes>=0.45,<1"],check=True)
import torch
assert torch.cuda.is_available(),"Kaggle GPU를 켜세요. 4-bit VLM 학습은 CPU에서 실행하지 않습니다."
print("GPU:",torch.cuda.get_device_name(0))
print("두 GPU의 메모리는 자동으로 합쳐지지 않습니다. 이 실험은 한 GPU씩 사용합니다.")
'''),
        md("""## 자료 선택

schematic은 이전 도식형 그림·규칙 정답입니다. 모델 학습 경로의 확인에 사용합니다. reviewed에서는 ① 노트북에서 사람이 정답을 붙인 SDXL 자료나 앱의 검토 완료 자료를 사용합니다.

Kaggle이 ZIP을 자동으로 풀지 않으면 먼저 안전한 작업 폴더에 압축을 풀고 DATA_DIR를 그 안의 reviewed 폴더로 지정하세요. reviewed를 선택했는데 자료가 없으면 중단하며 도식 자료로 자동 대체하지 않습니다."""),
        code('''if DATA_MODE=="schematic":
    DATA=RUN/"data"
    run("diary_verifier.synthetic","--out",DATA,"--events",str(SCHEMATIC_EVENTS),"--seed",str(DATA_SEED))
elif DATA_MODE=="reviewed":
    if DATA_DIR:
        DATA=Path(DATA_DIR)
    else:
        candidates=[]
        for info_path in Path("/kaggle/input").rglob("dataset-info.json"):
            try:
                info=json.loads(info_path.read_text(encoding="utf-8"))
                if info.get("data_purpose")=="collected_human_reviewed_data":candidates.append(info_path.parent)
            except (ValueError,OSError):pass
        if len(candidates)!=1:raise RuntimeError("검토 완료 자료 폴더를 DATA_DIR에 지정하세요.")
        DATA=candidates[0]
else:raise ValueError("DATA_MODE는 schematic 또는 reviewed")
assert (DATA/"dataset-info.json").is_file()
print((DATA/"dataset-info.json").read_text(encoding="utf-8"))
'''),
        md("""## 실험 계획 고정

기본 비교는 학습률·학습량·시드·LoRA 크기가 같은 B/C 한 쌍입니다. PAIR_WEIGHT만 다릅니다. EPOCHS는 최대 학습 횟수이고, 각 조건의 최적 체크포인트는 개발셋 Macro-F1로 고릅니다. 동점이면 개발 loss를 봅니다.

기반 모델 후보가 여러 개면 순정 모델의 개발셋 Macro-F1로 하나를 고릅니다. **순정 후보 선택이 최상의 파인튜닝 후보를 보장하는 것은 아닙니다.** 최종 시험셋으로 모델이나 설정을 고르지 않습니다.

실험 계획에는 공개 가중치의 고정 revision, 프롬프트 지문, 자료 지문, 양자화와 학습 설정을 저장합니다."""),
        code('''EXPERIMENT=RUN/"matched-comparison"
args=["diary_verifier.vlm_benchmark","init","--data",DATA,"--out",EXPERIMENT,
      "--base-models",*BASE_CANDIDATES,"--epochs",str(EPOCHS),"--batch-size",str(BATCH_SIZE),
      "--accumulation",str(ACCUMULATION),"--lr",str(LEARNING_RATE),"--pair-weight",str(PAIR_WEIGHT),
      "--lora-rank",str(LORA_RANK),"--seed",str(TRAIN_SEED),"--max-pixels",str(MAX_PIXELS)]
if not FOUR_BIT:args.append("--no-four-bit")
if not BALANCED:args.append("--unbalanced")
run(*args)
PLAN=EXPERIMENT/"plan.json"
'''),
        md("""## 개발 비교 · 실제 파인튜닝

순정 모델의 개발 판정 → B 학습 → C 학습 → 선택한 체크포인트의 개발 비교를 실행합니다. 각 단계는 별도 프로세스로 실행해 GPU 메모리를 반환합니다. 학습 시간과 성능 수치는 미리 넣지 않았습니다.

설정을 바꿀 때는 새 실험으로 실행하고 같은 DATA_SEED·자료 버전을 유지하세요. 테스트를 시작한 실험에서는 추가 학습을 막습니다. 출력된 학습 성능은 개발 성능이며 최종 성능으로 발표하지 않습니다."""),
        code('''run("diary_verifier.vlm_benchmark","develop","--plan",PLAN)
from IPython.display import display,HTML
display(HTML((EXPERIMENT/"development-comparison.html").read_text(encoding="utf-8")))
selection=json.loads((EXPERIMENT/"selection.json").read_text(encoding="utf-8"))
print("개발셋 기준 선택:",selection["selected_method_on_dev"])
print("기반 모델:",selection["base"])
from diary_verifier.vlm_benchmark import gallery
DEV_PREDS=[EXPERIMENT/"development"/(name+".jsonl") for name in ["pretrained","plain","relation"]]
gallery(DATA/"dev.jsonl",DEV_PREDS,EXPERIMENT/"development-examples.html")
display(HTML((EXPERIMENT/"development-examples.html").read_text(encoding="utf-8")))
'''),
        md("""## 최종 시험 · 튜닝을 마친 뒤 실행

처음 Run All에서는 실행하지 않습니다. 개발셋으로 모델과 설정을 결정한 뒤 RUN_FINAL_TEST=True로 바꾸고 **이 셀만** 실행하세요.

개발 단계에서 저장한 가중치·자료·계획 지문을 검사한 뒤 같은 시험 자료로 A/B/C를 평가합니다. 시험 후 결과를 보고 설정을 바꾸면 그 시험셋은 더 이상 독립 최종 평가용이 아닙니다. 성능표에는 Macro-F1·오류 검출률·오류 정상 통과율·오경보·보류 비율과 사건 묶음 단위 비교 신뢰구간이 나옵니다."""),
        code('''if RUN_FINAL_TEST:
    run("diary_verifier.vlm_benchmark","test","--plan",PLAN)
    display(HTML((EXPERIMENT/"final-test-comparison.html").read_text(encoding="utf-8")))
    TEST_PREDS=[EXPERIMENT/"final-test"/(name+".jsonl") for name in ["pretrained","plain","relation"]]
    gallery(DATA/"test.jsonl",TEST_PREDS,EXPERIMENT/"final-test-examples.html")
    display(HTML((EXPERIMENT/"final-test-examples.html").read_text(encoding="utf-8")))
else:
    print("최종 시험은 보류했습니다. 튜닝을 마친 뒤 RUN_FINAL_TEST=True로 바꾸고 이 셀만 실행하세요.")
'''),
        md("""## 보관

ZIP에는 계획·선택 기록·LoRA 가중치·예측·HTML/CSV 성능표를 넣습니다. 사전학습 모델 캐시는 제외합니다. 입력 자료가 Kaggle input에 있으면 그 자료 버전도 따로 보관하세요.

합성 도식 모델은 실제 앱의 기본 판정 서버에서 거부합니다. 사람 검토 SDXL 자료로 학습한 모델도 실제 앱 그림에서 별도 검증해야 합니다. LoRA가 일반 파인튜닝보다 항상 정확하거나, C가 B보다 항상 좋다고 가정하지 않습니다."""),
        code('''RESULT=WORK_ROOT/(RUN.name+"-results.zip")
with zipfile.ZipFile(RESULT,"w",zipfile.ZIP_DEFLATED) as archive:
    for path in RUN.rglob("*"):
        if path.is_file():archive.write(path,path.relative_to(RUN))
print("저장할 결과:",RESULT)
'''),
    ]


def build(cells, kind):
    for index, cell in enumerate(cells):
        cell["id"] = f"{kind}-{index:02d}"
    return {"cells": cells,
            "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                         "language_info": {"name": "python", "version": "3.12"},
                         "memory_connect": {"version": "0.16.0", "self_contained": True,
                                            "contains_predictions": False, "kind": kind}},
            "nbformat": 4, "nbformat_minor": 5}


if __name__ == "__main__":
    for name, cells, kind in [
        ("memory_connect_free_diary_data_kaggle.ipynb", generation(), "free-sdxl"),
        ("memory_connect_pretrained_lora_kaggle.ipynb", benchmark(), "matched-vlm"),
    ]:
        path = ROOT / "notebooks" / name
        path.write_text(json.dumps(build(cells, kind), ensure_ascii=False, indent=2), encoding="utf-8")
        print(path)
