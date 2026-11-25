"""Bundle a no-upload, no-API-key synthetic verifier lab in one Kaggle notebook."""
import hashlib
import json
from pathlib import Path
ROOT=Path(__file__).parent
MODULES=['__init__','common','prepare','shared_encoder','losses','fusion_features','fusion_train','fusion_model','fusion_predict','evaluate','experiment','synthetic']

def md(text):return {'cell_type':'markdown','metadata':{},'source':text.splitlines(True)}
def code(text):return {'cell_type':'code','execution_count':None,'metadata':{},'outputs':[],'source':text.splitlines(True)}

def build_notebook():
    sources={'diary_verifier/'+name+'.py':(ROOT/'diary_verifier'/(name+'.py')).read_text(encoding='utf-8') for name in MODULES}
    digest=hashlib.sha256(json.dumps(sources,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    cells=[md('''# 기억잇다 · 자료 없이 시작하는 Kaggle 합성 실험

**Dataset 업로드, 앱 실행, API 키 없이 이 노트북 하나로 실행합니다.** Kaggle에서 GPU와 Internet을 켜고 위에서부터 실행하세요. Internet은 패키지·공개 사전학습 모델 다운로드에 사용합니다.

1. 코드로 도식형 그림을 생성합니다. 정상·역할 교환·누락·추가·수량·배경·좌우·색상·가림의 11종입니다.
2. 그림 구성·가림 규칙에서 사실별 정답을 계산합니다. 모델이 정답을 생성하지 않습니다.
3. 같은 사건의 모든 변형을 같은 묶음에 넣어 학습/검증/시험을 분리합니다.
4. 실제 BGE-M3·SigLIP2 특징으로 단순 결합 / 어텐션 / 관계 대조 판정 모듈을 학습하고 비교합니다.
5. 그림·규칙 정답·실제 예측을 나란히 보며 틀린 유형을 확인합니다.

**이 결과는 합성 도식 장면의 성능입니다. 실제 AI 그림일기 판정 성능, Sunburst 등의 생성 오류율, 인지 개선 효과로 해석하지 않습니다.** 학습 가중치도 합성 실험용으로 표시하며 실제 앱 판정 서버에는 바로 연결하지 않습니다.
'''),code('''from pathlib import Path
import os,sys,json,subprocess,zipfile
WORK_ROOT=Path("/kaggle/working/memory-synthetic")
WORK_ROOT.mkdir(parents=True,exist_ok=True)
RUN_TAG="synthetic-v1"
N_EVENTS=30              # 사건 30개 × 변형 11종 = 그림 330장, 사실 2640개
DATA_SEED=42
EPOCHS=6                 # 빠른 연결 확인은 2
BATCH_SIZE=16
SEEDS=[42]               # 반복 비교 예: [42,43,44]
TEXT_MODE="sentence"
BALANCED=True            # 학습 자료의 클래스 가중치를 세 모델에 동일 적용
if "custom_verifier" in globals():
    del custom_verifier
    import gc
    gc.collect()
    if "torch" in globals() and torch.cuda.is_available():torch.cuda.empty_cache()
for module_name in list(sys.modules):
    if module_name=="diary_verifier" or module_name.startswith("diary_verifier."):sys.modules.pop(module_name,None)
RUN=WORK_ROOT/RUN_TAG
suffix=2
while RUN.exists():
    RUN=WORK_ROOT/(RUN_TAG+f"-{suffix:02d}");suffix+=1
RUN.mkdir()
DATA=RUN/"data"
FEATURES=WORK_ROOT/"features-bge-siglip-v1"
OUT=RUN/"models"
PROJECT=WORK_ROOT/"bundled-code"
os.environ["PYTHONPATH"]=str(PROJECT)
os.environ["HF_HOME"]=str(WORK_ROOT/"hf-cache")
sys.path.insert(0,str(PROJECT))
def run(*args):subprocess.run([sys.executable,"-m",*map(str,args)],check=True,env=os.environ.copy())
print("이번 실행:",RUN)
'''),md('''## 코드 준비

이 셀에는 판정기·합성 생성기 소스가 들어 있습니다. 별도 ZIP이나 GitHub 다운로드가 필요하지 않습니다. 이 노트북 전용 작업 폴더를 사용하며 이전 실행은 새 번호로 보존합니다.
'''),code('BUNDLED_SOURCES = '+repr(sources)+'\nBUNDLE_SHA256 = '+repr(digest)+'''
import hashlib
assert hashlib.sha256(json.dumps(BUNDLED_SOURCES,ensure_ascii=False,sort_keys=True).encode()).hexdigest()==BUNDLE_SHA256
for name,source in BUNDLED_SOURCES.items():
    target=PROJECT/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(source,encoding="utf-8")
print("소스 준비:",len(BUNDLED_SOURCES),"개 파일",BUNDLE_SHA256[:16])
'''),code('''subprocess.run([sys.executable,"-m","pip","install","torch>=2.6,<3","torchvision>=0.21,<1","transformers==5.23.0","Pillow>=10,<13"],check=True)
import torch
DEVICE="cuda" if torch.cuda.is_available() else "cpu"
print("PyTorch:",torch.__version__,"장치:",DEVICE)
if DEVICE=="cuda":print(torch.cuda.get_device_name(0))
else:print("CPU도 가능하지만 특징 추출은 느릴 수 있습니다. GPU 설정을 권장합니다.")
'''),md('''## 합성 그림과 정답 생성

정상, 행동 주체 교환, 인물 누락, 인물 추가, 사물 누락, 사과 수량, 배경, 좌우 위치, 사과 색, 인물 가림, 사물 가림을 만듭니다. A/B의 옷 색·행동·위치·크기는 사건별로 바뀌고 같은 사건의 변형에서는 필요한 요소만 바꿉니다. 이미지 안에는 정답·케이스 이름·글자를 넣지 않습니다.

신원·가족관계·날짜·기분은 판정하지 않습니다. 구성한 시각적 사실을 검사합니다. 아래 미리보기는 규칙 정답만 표시하며 아직 모델 예측은 없습니다.
'''),code('''run("diary_verifier.synthetic","--out",DATA,"--events",str(N_EVENTS),"--seed",str(DATA_SEED))
from IPython.display import display,HTML
info=json.loads((DATA/"dataset-info.json").read_text(encoding="utf-8"))
print(json.dumps(info["splits"],ensure_ascii=False,indent=2))
display(HTML((DATA/"cases-preview.html").read_text(encoding="utf-8")))
'''),md('''## 실제 사전학습 특징 추출

한국어 문장은 BGE-M3, 그림은 SigLIP2 Base-384를 사용합니다. 두 인코더는 동결합니다. 첫 실행은 모델 다운로드가 있으며 이후 같은 모델·그림·문장의 캐시를 재사용합니다. 정답·오류 종류·장면 그래프는 인코더 입력에서 제외합니다.
'''),code('''run("diary_verifier.fusion_features","--manifests",DATA/"train.jsonl",DATA/"dev.jsonl",DATA/"test.jsonl","--cache",FEATURES,"--device",DEVICE)
print((FEATURES/"encoders.json").read_text(encoding="utf-8"))
'''),md('''## 세 모델 학습·비교

- pooled: 이미지 패치 평균과 문장 특징을 결합한 분류기.
- plain: 문장과 이미지 패치의 교차 어텐션 + 3분류 학습.
- relation: plain과 같은 구조·배치·시드 + 같은 사실의 정상/오류 그림 쌍 대조 손실.

세 모델에 동일한 클래스 가중치 설정을 적용합니다. 검증 자료 loss로 체크포인트를 고르고 시험 자료는 선택에 사용하지 않습니다. Macro-F1·오류 검출률·오류 정상 통과율·보류 비율을 함께 확인하세요. 아래 시간은 캐시 특징과 판정 모듈 범위입니다.
'''),code('''args=["--data",DATA,"--cache",FEATURES,"--out",OUT,"--device",DEVICE,"--epochs",str(EPOCHS),"--batch-size",str(BATCH_SIZE),"--seeds",*map(str,SEEDS),"--text-mode",TEXT_MODE,"--synthetic"]
if BALANCED:args.append("--balanced")
run("diary_verifier.experiment",*args)
for path in sorted(OUT.glob("comparison-seed*.html")):
    display(HTML(path.read_text(encoding="utf-8")))
print((OUT/"seed-summary.csv").read_text(encoding="utf-8-sig"))
'''),md('''## 유형별 결과와 실제 예측 보기

각 유형의 정답과 예측을 나란히 표시합니다. 살펴보기에서는 **오분류가 많은 사례를 우선 표시**합니다. 전체 성능은 모든 시험 자료로 계산합니다. 정답을 예측으로 복사하지 않습니다. 항상 '일치'라고 답하는 단순 기준선도 추가하여 겉보기 정확도와 오류 검출 성능을 함께 비교합니다.
'''),code('''from diary_verifier.synthetic import case_report
predictions=sorted(OUT.glob("*.jsonl"))
from diary_verifier.synthetic import always_supported_baseline
from diary_verifier.evaluate import compare_runs
control=OUT/"always-supported.jsonl"
always_supported_baseline(DATA/"test.jsonl",control)
predictions=[control]+[path for path in predictions if path!=control]
compare_runs(DATA/"test.jsonl",predictions,OUT/"comparison-with-control.json")
display(HTML((OUT/"comparison-with-control.html").read_text(encoding="utf-8")))
galleries=case_report(DATA/"test.jsonl",predictions,OUT/"case-comparison.json")
SHOW_METHOD="relation"      # pooled / plain / relation
chosen=[Path(path) for path in galleries if Path(path).name.startswith(SHOW_METHOD+"-seed"+str(SEEDS[0])+"-")]
if not chosen:raise RuntimeError("표시할 모델의 예측이 없습니다. 학습 결과를 확인하세요.")
display(HTML(chosen[0].read_text(encoding="utf-8")))
print("유형별 성능:",OUT/"case-comparison.csv")
'''),md('''## 새 인공 사례 직접 시험

학습 후 이 셀의 CASE를 바꾸어 여러 경우를 시도하세요. 판정은 학습 가중치로 계산하고 정답은 구성 규칙으로 계산합니다. 단일 사례 점검이며 전체 정확도는 아닙니다.
'''),code('''from diary_verifier.synthetic import CASE_LABELS,make_example,write_gallery
print(json.dumps(CASE_LABELS,ensure_ascii=False,indent=2))
CASE="role_swap"            # correct / missing_person / missing_object / wrong_count / ...
NEW_EVENT_SEED=900001
NEW_DATA=RUN/"custom";NEW_DATA.mkdir(exist_ok=True)
example=make_example(NEW_EVENT_SEED,CASE,NEW_DATA/"images")
# 합성 실험용 체크포인트만 이 셀에서 명시적으로 허용합니다.
from diary_verifier.fusion_model import FusionVerifier
from PIL import Image
chosen_checkpoint=OUT/(SHOW_METHOD+"-seed"+str(SEEDS[0]))
if "custom_verifier" not in globals() or CUSTOM_VERIFIER_PATH!=str(chosen_checkpoint):
    if "custom_verifier" in globals():
        del custom_verifier
        import gc
        gc.collect()
        if torch.cuda.is_available():torch.cuda.empty_cache()
    custom_verifier=FusionVerifier(chosen_checkpoint,device=DEVICE,allow_synthetic=True)
    CUSTOM_VERIFIER_PATH=str(chosen_checkpoint)
with Image.open(NEW_DATA/example["image"]) as raw:
    predicted=custom_verifier.verify_image(raw.convert("RGB"),example["scene"],example["characters"],example["facts"])
lookup={(example["id"],item["factId"]):item["label"] for item in predicted}
custom_html=NEW_DATA/(CASE+"-prediction.html")
write_gallery([example],NEW_DATA,custom_html,lookup,"새 합성 사례 · "+CASE_LABELS[CASE])
display(HTML(custom_html.read_text(encoding="utf-8")))
'''),md('''## 결과 저장

ZIP에는 합성 그림·규칙 정답·학습 가중치·예측·HTML/CSV 성능표를 담습니다. 큰 사전학습 모델·특징 캐시는 제외합니다. 합성 가중치는 사람 검토 그림일기로 학습한 모델로 표시하지 않습니다. 실제 자료에서는 별도 자료 버전과 시험 세트로 재검증해야 합니다.
'''),code('''RESULT=WORK_ROOT/(RUN.name+"-results.zip")
with zipfile.ZipFile(RESULT,"w",zipfile.ZIP_DEFLATED) as archive:
    for path in RUN.rglob("*"):
        if path.is_file():archive.write(path,path.relative_to(RUN))
print("내려받을 결과:",RESULT)
''')]
    for index,cell in enumerate(cells):cell['id']=f'synthetic-{index:02d}'
    return {'cells':cells,'metadata':{'kernelspec':{'display_name':'Python 3','language':'python','name':'python3'},'language_info':{'name':'python','version':'3.12'},'memory_connect':{'version':'0.15.0','data_purpose':'synthetic_controlled','contains_predictions':False,'self_contained':True,'bundle_sha256':digest}},'nbformat':4,'nbformat_minor':5}

if __name__=='__main__':
    path=ROOT/'notebooks/memory_connect_synthetic_kaggle.ipynb'
    path.write_text(json.dumps(build_notebook(),ensure_ascii=False,indent=2),encoding='utf-8')
    print(path)
