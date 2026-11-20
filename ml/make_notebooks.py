import json
from pathlib import Path

ROOT=Path(__file__).parent

def md(text):return {'cell_type':'markdown','metadata':{},'source':text.splitlines(True)}
def code(text):return {'cell_type':'code','execution_count':None,'metadata':{},'outputs':[],'source':text.splitlines(True)}

def notebook(platform):
 kaggle=platform=='kaggle'
 run='/kaggle/working/memory-connect' if kaggle else '/content/memory-connect'
 upload='/kaggle/input' if kaggle else '/content'
 cells=[md(f'''# 기억잇다 · {platform.title()} VLM LoRA 비교 경로

실제 검토 자료가 필요한 실행 노트북입니다. 사전 계산한 성능이나 학습 완료 모델을 포함하지 않습니다.

1. 코드 ZIP과 브라우저에서 내려받은 **실제 AI 생성 그림·사람 검토 JSON**을 준비합니다.
2. GPU를 활성화하고, 처음 모델을 내려받을 때 인터넷을 허용합니다. 모델의 사용 조건도 확인합니다.
3. 같은 사건의 원본·변형이 다른 데이터 분할에 들어가지 않게 준비합니다.
4. 학습 전 모델, 일반 LoRA, 관계 대조 학습 모델, 선택한 범용 API를 같은 시험 세트로 비교합니다.

Kaggle: 비공개 데이터셋으로 파일을 연결하고 `/kaggle/working`의 결과를 저장합니다. Colab: 파일 또는 Drive를 연결합니다. 데이터와 키를 노트북 출력에 공개하지 않습니다.

사전학습모델은 아직 미확정입니다. 이 노트북은 VLM 후보의 4-bit LoRA 경로이며, 기본 인코더 판정기는 이름에 fusion이 들어간 노트북으로 실행하며, 이 VLM 비교 실험은 체크포인트를 직접 지정합니다. GPU 메모리를 확인하며 시작하세요. GPU가 두 개여도 자동으로 메모리가 합쳐지지는 않습니다. 노트북 4050은 추론·연동 확인에 먼저 활용하세요.
'''),code(f'''from pathlib import Path
import sys, os, glob, json, subprocess, zipfile
RUN_ROOT=Path({run!r})
RUN_ROOT.mkdir(parents=True,exist_ok=True)
# 자동으로 찾지 못하면 아래 두 경로를 직접 지정합니다.
PROJECT_ZIP=""
EXPORT_DIR=Path({upload!r})
USE_4BIT=True
BASE_MODEL=""  # 후보 검토 후 VLM 체크포인트 지정; 기본 인코더 판정기는 fusion 노트북 사용
PROJECT=None
if not PROJECT_ZIP:
    matches=list(Path({upload!r}).rglob("memory-connect-v0.13.zip"))
    if matches:
        PROJECT_ZIP=str(matches[0])
    else:
        # Kaggle datasets can automatically unpack uploaded ZIPs.
        roots=[path.parent.parent for path in Path({upload!r}).rglob("requirements.txt") if path.parent.name=="ml" and (path.parent/"diary_verifier").is_dir()]
        if roots: PROJECT=roots[0]
        else: raise RuntimeError("코드 ZIP 또는 압축 해제된 코드 데이터셋을 연결하세요.")
if PROJECT is None:
    PROJECT_PARENT=RUN_ROOT/"project"
    PROJECT_PARENT.mkdir(exist_ok=True)
    with zipfile.ZipFile(PROJECT_ZIP) as archive:
        if any(not (PROJECT_PARENT/name).resolve().is_relative_to(PROJECT_PARENT.resolve()) for name in archive.namelist()):
            raise RuntimeError("안전하지 않은 ZIP 경로입니다.")
        archive.extractall(PROJECT_PARENT)
    PROJECT=PROJECT_PARENT/"memory-connect-v0.13"
assert (PROJECT/"ml/requirements.txt").exists(), "올바른 버전의 코드 ZIP인지 확인하세요."
os.environ["PYTHONPATH"]=str(PROJECT/"ml")
os.environ["HF_HOME"]=str(RUN_ROOT/"hf-cache")
print("작업 경로:",RUN_ROOT)
'''),code('''import torch
print("PyTorch:",torch.__version__)
print("CUDA:",torch.cuda.is_available())
if torch.cuda.is_available():
    for index in range(torch.cuda.device_count()):
        device=torch.cuda.get_device_properties(index)
        print(index,device.name,round(device.total_memory/1024**3,1),"GiB")
else:
    print("데이터 준비는 가능하지만 VLM 학습은 GPU 런타임에서 실행해야 합니다.")
assert tuple(map(int,torch.__version__.split('+')[0].split('.')[:2])) >= (2,6), "현재 CUDA에 맞는 PyTorch 2.6 이상이 필요합니다."
subprocess.run([sys.executable,"-m","pip","install","-r",str(PROJECT/"ml/requirements.txt")],check=True)
if USE_4BIT:
    subprocess.run([sys.executable,"-m","pip","install","bitsandbytes>=0.45,<1"],check=True)
'''),code('''def run(*arguments):
    subprocess.run([sys.executable,"-m",*map(str,arguments)],check=True,env=os.environ.copy())
exports=[]
for path in EXPORT_DIR.rglob("*.json"):
    try:
        value=json.loads(path.read_text())
        if isinstance(value,dict) and value.get("records"):
            exports.append(path)
    except (ValueError,UnicodeError,OSError):
        pass
if not exports:
    raise RuntimeError("아직 학습 자료가 없습니다. 앱에서 실제 AI 그림을 생성/업로드하고, 사람이 모든 사실을 판정한 JSON을 연결하세요. 예시 주석 자료는 학습에 넣지 않습니다.")
DATA=RUN_ROOT/"data-v1"
if not (DATA/"dataset-info.json").exists():
    run("diary_verifier.prepare",*exports,"--out",DATA)
print((DATA/"dataset-info.json").read_text())
'''),md('''## 모델 학습

데이터에는 일치·불일치·판단 불가가 모두 필요합니다. 관계 대조 학습에는 **같은 확인 사실**이 맞게 그려진 그림과 틀리게 그려진 그림의 사람 판정 쌍이 있어야 합니다. 없는 쌍을 임의로 정답 처리하지 않습니다.

일반 LoRA와 제안 방법은 같은 데이터·시드·배치 구성·기반 모델을 사용하며 대조 손실 가중치만 바꿉니다. 시험 세트로 설정을 조정하지 않습니다.
'''),code('''assert torch.cuda.is_available(), "GPU를 활성화하세요."
assert BASE_MODEL, "공통 인코더 후보 검토 후 VLM 실험 모델을 지정하세요."
PLAIN=RUN_ROOT/"plain-lora"
RELATION=RUN_ROOT/"relation-lora"
common=["--data",DATA,"--base-model",BASE_MODEL,"--batch-size","2","--accumulation","4","--epochs","3","--seed","42"]
if USE_4BIT: common += ["--four-bit"]
if not (PLAIN/"verifier_config.json").exists():
    run("diary_verifier.train",*common,"--out",PLAIN,"--pair-weight","0")
if not (RELATION/"verifier_config.json").exists():
    run("diary_verifier.train",*common,"--out",RELATION,"--pair-weight","0.25")
'''),md('''## 고정 시험 세트 평가

먼저 소규모 개발 자료에서 메모리·입력 처리를 확인한 뒤 실행하세요. 화풍·품질은 개발 자료에서 선택하고, 최종 시험 세트는 고정합니다. 아래 예측은 사람 정답을 모델 입력에 넣지 않습니다.
'''),code('''PRED=RUN_ROOT/"predictions"
PRED.mkdir(exist_ok=True)
TEST=DATA/"test.jsonl"
for name,adapter in [("pretrained",None),("plain",PLAIN),("relation",RELATION)]:
    target=PRED/(name+".jsonl")
    if target.exists():
        print("기존 예측 유지:",target)
        continue
    arguments=["diary_verifier.predict","--manifest",TEST,"--base-model",BASE_MODEL,"--out",target]
    if adapter: arguments += ["--adapter",adapter]
    if USE_4BIT: arguments += ["--four-bit"]
    run(*arguments)
run("diary_verifier.evaluate","--manifest",TEST,"--predictions",PRED/"pretrained.jsonl",PRED/"plain.jsonl",PRED/"relation.jsonl","--out",RUN_ROOT/"local-comparison.json")
'''),md('''## 범용 API 비교 — 명시적으로 실행할 때만 비용 발생

사용 가능한 강한 API 모델/스냅샷을 직접 지정합니다. 먼저 dry-run으로 호출 수를 확인합니다. 키는 Secrets 또는 비공개 입력으로 런타임에만 넣으며 파일·출력에 저장하지 않습니다. API 오류를 정상/불일치로 바꾸지 않고, 실패·누락 응답이 있는 비교는 중단합니다.
'''),code('''API_MODEL=""  # 계정에서 사용할 수 있는 비교 모델 또는 스냅샷 ID
RUN_PAID_API=False
if API_MODEL:
    run("diary_verifier.api_baseline","--manifest",TEST,"--model",API_MODEL,"--out",PRED/"api.jsonl","--dry-run")
if RUN_PAID_API:
    assert API_MODEL, "비교할 API 모델을 지정하세요."
    import getpass
    os.environ["DIARY_API_KEY"]=getpass.getpass("API key (런타임에만 보관): ")
    try:
        run("diary_verifier.api_baseline","--manifest",TEST,"--model",API_MODEL,"--out",PRED/"api.jsonl")
    finally:
        os.environ.pop("DIARY_API_KEY",None)
    run("diary_verifier.evaluate","--manifest",TEST,"--predictions",PRED/"api.jsonl",PRED/"pretrained.jsonl",PRED/"plain.jsonl",PRED/"relation.jsonl","--out",RUN_ROOT/"api-comparison.json")
'''),md('''## 결과 보관

아래 ZIP에는 LoRA 가중치·프로세서·학습 설정·예측·평가 보고서만 넣습니다. 대용량 기반 모델 캐시와 API 키를 포함하지 않습니다. 데이터 버전은 별도로 보관하세요. Kaggle 세션 종료 전 Output 저장, Colab 종료 전 다운로드/Drive 복사가 필요합니다.

이 노트북은 실제 학습을 실행하는 도구이며 결과를 미리 포함하지 않습니다. 작은 표본이나 한 명의 판정만으로 성능 우월성·모델 전체 오류율·SCD 개선 효과를 주장하지 않습니다.
'''),code('''import zipfile
RESULT=RUN_ROOT/"memory-connect-model-results.zip"
with zipfile.ZipFile(RESULT,"w",zipfile.ZIP_DEFLATED) as archive:
    for folder in [PLAIN,RELATION,PRED]:
        if folder.exists():
            for path in folder.rglob("*"):
                if path.is_file(): archive.write(path,path.relative_to(RUN_ROOT))
    for path in RUN_ROOT.glob("*comparison.json"):
        archive.write(path,path.name)
print("저장할 결과:",RESULT)
''')]
 return {'cells':cells,'metadata':{'kernelspec':{'display_name':'Python 3','language':'python','name':'python3'},'language_info':{'name':'python','version':'3.12'},'memory_connect':{'platform':platform,'contains_trained_results':False}},'nbformat':4,'nbformat_minor':5}

for platform in ['kaggle','colab']:
 path=ROOT/'notebooks'/f'memory_connect_{platform}.ipynb'
 content=notebook(platform)
 for i,cell in enumerate(content['cells']):cell['id']=f'{platform}-cell-{i:02d}'
 path.write_text(json.dumps(content,ensure_ascii=False,indent=2))
 print(path)
