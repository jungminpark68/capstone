"""Build the primary small-verifier Kaggle/Colab notebooks without outputs or secrets."""
import json
from pathlib import Path

ROOT=Path(__file__).parent

def md(text):return {'cell_type':'markdown','metadata':{},'source':text.splitlines(True)}
def code(text):return {'cell_type':'code','execution_count':None,'metadata':{},'outputs':[],'source':text.splitlines(True)}

def notebook(platform):
    kaggle=platform=='kaggle'
    run='/kaggle/working/memory-connect' if kaggle else '/content/memory-connect'
    upload='/kaggle/input' if kaggle else '/content'
    cells=[md(f'''# 기억잇다 · {platform.title()} 한국어 임베딩 판정기

BGE-M3와 SigLIP2는 **고정**하고, 사실–그림 연결·어텐션·3분류 모듈만 직접 학습합니다.

- 입력: 확인된 장면·인물 정보·사실 하나와 그림.
- 출력: 일치 / 불일치 / 판단 불가.
- 준비물: 코드 ZIP, 앱 `/verification`에서 내보낸 **실제 그림·사람 판정 JSON**.
- 현재 연구용 학습 가중치와 정확도 결과는 없습니다. 예시 자료로 성능을 만들지 않습니다.

GPU를 켜고 첫 모델 다운로드 시 인터넷을 허용합니다. Kaggle에서는 비공개 데이터셋으로 파일을 연결하세요. Colab에서는 `/content`에 파일을 올리거나 `EXPORT_DIR`를 Drive 경로로 바꿉니다. 캐시 특징 학습은 CPU도 가능하지만 특징 추출에는 GPU가 유리합니다.
'''),code(f'''from pathlib import Path
import sys, os, json, subprocess, zipfile
RUN_ROOT=Path({run!r})
RUN_ROOT.mkdir(parents=True,exist_ok=True)
INPUT_ROOT=Path({upload!r})
PROJECT_ZIP=""  # 자동 탐색에 실패할 때 코드 ZIP 경로 지정
EXPORT_DIR=INPUT_ROOT  # 실제 그림·사람 판정 JSON을 담은 폴더
PROJECT=None
if not PROJECT_ZIP:
    archives=sorted(INPUT_ROOT.rglob("memory-connect-v0.13.zip"))
    if archives:
        PROJECT_ZIP=str(archives[0])
    else:
        roots=[path.parent.parent for path in INPUT_ROOT.rglob("requirements-fusion.txt") if (path.parent/"diary_verifier/fusion_train.py").exists()]
        if roots: PROJECT=roots[0]
        else: raise RuntimeError("코드 ZIP 또는 압축 해제된 코드 데이터셋을 연결하세요.")
if PROJECT is None:
    parent=RUN_ROOT/"project"
    parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(PROJECT_ZIP) as archive:
        if any(not (parent/name).resolve().is_relative_to(parent.resolve()) for name in archive.namelist()):
            raise RuntimeError("안전하지 않은 ZIP 경로입니다.")
        archive.extractall(parent)
    roots=[path.parent.parent for path in parent.rglob("requirements-fusion.txt") if (path.parent/"diary_verifier/fusion_train.py").exists()]
    assert len(roots)==1, "코드 ZIP 안에 프로젝트가 하나 있어야 합니다."
    PROJECT=roots[0]
assert (PROJECT/"ml/diary_verifier/fusion_train.py").exists()
os.environ["PYTHONPATH"]=str(PROJECT/"ml")
os.environ["HF_HOME"]=str(RUN_ROOT/"hf-cache")
def run(*arguments):
    subprocess.run([sys.executable,"-m",*map(str,arguments)],check=True,env=os.environ.copy())
print("작업 경로:",RUN_ROOT)
'''),code('''subprocess.run([sys.executable,"-m","pip","install","-r",str(PROJECT/"ml/requirements-fusion.txt")],check=True)
import torch
print("PyTorch:",torch.__version__,"CUDA:",torch.cuda.is_available())
DEVICE="cuda" if torch.cuda.is_available() else "cpu"
if torch.cuda.is_available():
    gpu=torch.cuda.get_device_properties(0)
    print(gpu.name,round(gpu.total_memory/1024**3,1),"GiB")
else:
    print("CPU로도 실행하지만 실제 인코더의 특징 추출은 느릴 수 있습니다.")
'''),md('''## 1. 검토 자료 준비

같은 사건·같은 그림·원본/변형본을 연결한 그룹으로 train/dev/test를 나눕니다. 사람 정답은 인코더 입력에 넣지 않습니다. 같은 이미지의 중복 저장으로 표본 수를 늘리지 않습니다. 코드의 최소 그룹 수는 충분한 연구 표본 수를 뜻하지 않습니다.

**정상·오류·판단 불가가 모두 필요**합니다. 관계 대조 학습에는 동일한 사실이 맞게/틀리게 그려진 사람 판정 쌍이 추가로 필요합니다. 실제 자료가 없으면 수집부터 진행하며 다음 셀은 중단됩니다.
'''),code('''exports=[]
for path in EXPORT_DIR.rglob("*.json"):
    try:
        value=json.loads(path.read_text())
        if isinstance(value,dict) and value.get("records"): exports.append(path)
    except (ValueError,UnicodeError,OSError):
        pass
if not exports:
    raise RuntimeError("검토 JSON이 없습니다. 앱에서 실제 그림의 모든 사실을 사람이 판정한 뒤 내보내세요.")
DATA=RUN_ROOT/"data-v1"
if not (DATA/"dataset-info.json").exists():
    run("diary_verifier.prepare",*exports,"--out",DATA)
print((DATA/"dataset-info.json").read_text())
'''),md('''## 2. 고정 인코더로 특징 추출

BGE-M3: 한국어 사실별 문장 1024차원. SigLIP2 Base-384: 그림 패치 576개. 두 인코더는 학습하지 않습니다. 첫 다운로드에는 디스크와 인터넷이 필요합니다.

모델 버전·전처리·입력 파일 해시를 저장하므로 이후 같은 캐시를 재사용할 수 있습니다. 인코더가 바뀌면 새 캐시와 새 판정 모듈 학습이 필요합니다. 매칭팀 모델도 같은 규약으로 교체할 수 있습니다.
'''),code('''FEATURES=RUN_ROOT/"features-v1"
run("diary_verifier.fusion_features",
    "--manifests",DATA/"train.jsonl",DATA/"dev.jsonl",DATA/"test.jsonl",
    "--cache",FEATURES,"--device",DEVICE)
print((FEATURES/"encoders.json").read_text())
'''),md('''## 3. 자체 판정 모듈 학습

기본은 문장 벡터 하나로 그림 패치를 살펴보는 `sentence` 방식입니다. 원래 토큰 특징을 제공할 수 있으면 `tokens` 방식으로 별도 실험합니다. 두 방식은 입력 정보가 다르므로 같은 것으로 취급하지 않습니다.

일반 판정기와 관계 대조 판정기는 같은 자료·구조·시드·배치를 사용하고 추가 손실만 바꿉니다. 대조 손실은 같은 사실의 정상/오류 쌍만 비교하며 판단 불가는 쌍으로 강제하지 않습니다. dev loss로 체크포인트를 선택하고 test는 사용하지 않습니다.
'''),code('''TEXT_MODE="sentence"
SEED=42
PLAIN=RUN_ROOT/("plain-"+TEXT_MODE)
RELATION=RUN_ROOT/("relation-"+TEXT_MODE)
common=["--data",DATA,"--cache",FEATURES,"--text-mode",TEXT_MODE,"--device",DEVICE,
        "--seed",str(SEED),"--epochs","15","--batch-size","8"]
if not (PLAIN/"fusion_config.json").exists():
    run("diary_verifier.fusion_train",*common,"--out",PLAIN,"--pair-weight","0")
# train에 같은 사실의 supported/contradicted 쌍이 있을 때만 대조 학습.
sys.path.insert(0,str(PROJECT/"ml"))
from diary_verifier.losses import claim_key
claims={}
for line in (DATA/"train.jsonl").read_text().splitlines():
    example=json.loads(line)
    for fact in example["facts"]:
        claims.setdefault(claim_key(example,fact),set()).add(fact["label"])
HAVE_PAIRS=any({"supported","contradicted"}<=labels for labels in claims.values())
if HAVE_PAIRS:
    if not (RELATION/"fusion_config.json").exists():
        run("diary_verifier.fusion_train",*common,"--out",RELATION,"--pair-weight","0.25")
else:
    print("대조 쌍이 없어 일반 판정기만 학습했습니다. 관계 대조 방법의 성능으로 보고하지 마세요.")
'''),md('''## 4. 고정 시험 자료 평가

아래 예측은 저장된 특징을 사용합니다. **표시되는 시간에는 인코더 처리 시간이 제외**됩니다. API와 전체 처리 시간을 비교할 경우 `--cache ...` 대신 `--from-images`를 사용하세요. 어떤 모델이 더 좋은지는 실제 시험 결과로 확인합니다.
'''),code('''TEST=DATA/"test.jsonl"
PRED=RUN_ROOT/"predictions"
PRED.mkdir(exist_ok=True)
RUNS=[("plain",PLAIN)]+([("relation",RELATION)] if HAVE_PAIRS else [])
predictions=[]
for name,checkpoint in RUNS:
    target=PRED/(name+"-"+TEXT_MODE+".jsonl")
    if not target.exists():
        run("diary_verifier.fusion_predict","--manifest",TEST,"--cache",FEATURES,
            "--checkpoint",checkpoint,"--out",target,"--device",DEVICE)
    predictions.append(target)
run("diary_verifier.evaluate","--manifest",TEST,"--predictions",*predictions,
    "--out",RUN_ROOT/("local-comparison-"+TEXT_MODE+".json"))
'''),md('''## 5. 범용 API 비교 — 선택할 때만 비용 발생

같은 그림·문맥을 강한 비교 모델에 제공합니다. 모델/스냅샷은 계정에서 사용할 수 있는 것으로 지정하세요. 정답은 입력에서 제외합니다. dry-run은 호출 수만 확인합니다. 실제 실행은 아래 옵션을 직접 바꿀 때만 진행합니다. 키는 비공개 입력으로 받아 런타임에만 보관합니다.
'''),code('''API_MODEL=""
RUN_PAID_API=False
if API_MODEL:
    run("diary_verifier.api_baseline","--manifest",TEST,"--model",API_MODEL,
        "--out",PRED/"api.jsonl","--dry-run")
if RUN_PAID_API:
    assert API_MODEL, "비교할 API 모델을 지정하세요."
    import getpass
    os.environ["DIARY_API_KEY"]=getpass.getpass("API key: ")
    try:
        run("diary_verifier.api_baseline","--manifest",TEST,"--model",API_MODEL,"--out",PRED/"api.jsonl")
    finally:
        os.environ.pop("DIARY_API_KEY",None)
    run("diary_verifier.evaluate","--manifest",TEST,"--predictions",*predictions,PRED/"api.jsonl",
        "--out",RUN_ROOT/("api-comparison-"+TEXT_MODE+".json"))
'''),md('''## 6. 결과 저장과 앱 연결

ZIP에는 학습한 판정 모듈·설정·예측·평가를 담고, 대용량 인코더 캐시·API 키는 넣지 않습니다. 세션 종료 전에 Kaggle Output 저장 또는 Colab 다운로드를 진행하세요. 데이터 버전은 따로 보관합니다.

로컬에서 같은 코드와 환경을 준비한 뒤:

```bash
PYTHONPATH=ml python -m diary_verifier.fusion_serve --checkpoint <내려받은 학습 폴더> --port 8010
```

Node 앱 `.env`에 `DIARY_VERIFY_BACKEND=local`, `DIARY_VERIFIER_URL=http://127.0.0.1:8010`을 설정하고 `/verification`에서 자체 모델을 선택합니다. 실제 학습 가중치가 없으면 실행되지 않으며 예시/API 판정으로 대체하지 않습니다.
'''),code('''RESULT=RUN_ROOT/"memory-connect-fusion-results.zip"
with zipfile.ZipFile(RESULT,"w",zipfile.ZIP_DEFLATED) as archive:
    for folder in [PLAIN]+([RELATION] if HAVE_PAIRS else [])+[PRED]:
        if folder.exists():
            for path in folder.rglob("*"):
                if path.is_file():archive.write(path,path.relative_to(RUN_ROOT))
    for path in RUN_ROOT.glob("*comparison-*.json"):
        archive.write(path,path.name)
    archive.write(DATA/"dataset-info.json","dataset-info.json")
print("저장할 결과:",RESULT)
''')]
    for index,cell in enumerate(cells):cell['id']=f'fusion-{platform}-{index:02d}'
    return {'cells':cells,'metadata':{'kernelspec':{'display_name':'Python 3','language':'python','name':'python3'},'language_info':{'name':'python','version':'3.12'},'memory_connect':{'platform':platform,'contains_trained_results':False,'training_scope':'fusion_head_only_frozen_encoders'}},'nbformat':4,'nbformat_minor':5}

if __name__=='__main__':
    for platform in ('kaggle','colab'):
        path=ROOT/'notebooks'/f'memory_connect_fusion_{platform}.ipynb'
        path.write_text(json.dumps(notebook(platform),ensure_ascii=False,indent=2))
        print(path)
