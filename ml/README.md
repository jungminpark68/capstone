# 기억잇다 · 한국어 문장–이미지 판정기

자료가 없으면 **`notebooks/memory_connect_synthetic_kaggle.ipynb`**를 사용합니다. 소스·도식형 그림 생성·규칙 정답·학습·성능 비교를 한 노트북에 포함합니다. 별도 파일 업로드와 API 키가 필요 없습니다. [합성 실험 안내](../docs/kaggle-synthetic-guide.md). 합성 학습 가중치는 실제 사람 검토 모델로 표시하거나 앱의 기본 판정 서버에 연결하지 않습니다.

v0.14에서는 **`notebooks/memory_connect_verifier_kaggle.ipynb`**를 사용합니다. 학습·평가, 기존 가중치 평가, 앱의 그림 일괄 판정 세 가지 방식이 있습니다. 독립 코드 ZIP의 README와 [통합 사용 안내](../docs/kaggle-verifier-guide.md)를 참고하세요. `diary_verifier.experiment`는 pooled/plain/relation을 비교하고 HTML·CSV·JSON 성능표와 시드별 요약을 저장합니다. 앱과는 HTTP 서버 또는 그림·사실 지문이 연결된 JSON 파일로 연동합니다.

주 경로는 **BGE-M3 한국어 문장 특징 + SigLIP2 그림 패치 특징 + 직접 학습하는 연결·분류 모듈**이다. 일치(`supported`)·불일치(`contradicted`)·판단 불가(`uncertain`)로 분류한다. 두 인코더는 고정하고 판정 모듈만 학습한다. 인코더 파인튜닝을 완료했다는 의미는 아니다.

실행 코드와 노트북을 제공한다. 실제 생성 그림·사람 정답 데이터와 연구용 학습 완료 가중치, 정확도 결과는 아직 없다. 실제 사전학습 인코더의 한국어·이미지 입력은 CPU에서 확인했다. 소프트웨어 테스트의 임의 특징·가중치는 성능 증거가 아니며 실제 모델 서버에서 거부한다.

## 구조

```text
확인된 장면 + 인물 구별 정보 + 확인할 사실 하나
  → BGE-M3 (고정) → 한국어 문장 벡터 1024차원 ─┐
                                               ├→ 연결·어텐션·분류 학습 → 3가지 판정
그림 → SigLIP2 Base-384 (고정) → 576개 패치 ────┘
```

서로 다른 인코더의 벡터를 직접 코사인 비교하지 않고 연결부를 정답 자료로 학습한다. 기본 `sentence` 모드는 사실별 문장 벡터 하나를 질의로 사용한다. 원래 토큰 특징이 있을 때만 `tokens` 모드를 별도로 학습·비교한다.

## Kaggle에서 실행

주 노트북: [memory_connect_fusion_kaggle.ipynb](notebooks/memory_connect_fusion_kaggle.ipynb). Colab용은 같은 이름의 `colab` 파일이다. 코드 ZIP과 검토 JSON을 연결하고 위에서부터 실행한다. 첫 모델 다운로드 때 인터넷이 필요하다. 데이터와 키를 비공개로 관리하고 모델 사용 조건을 확인한다.

GPU는 특징 추출을 빠르게 한다. 판정 모듈 학습은 캐시된 특징만 읽으므로 CPU에서도 실행할 수 있다. RTX 4050은 실제 VRAM·텍스트 길이·입력 크기를 확인하며 사용한다. 특정 VRAM에서 실행을 보장하지 않는다.

## 1. 실제 그림과 사람 판정 수집

`npm start` → `http://localhost:3000/verification`에서 실제 생성 그림을 만들거나 업로드한다. 장면·사실을 확인하고 사람이 모든 사실을 판정한 뒤 JSON을 내려받는다. 예시 주석은 학습에 넣지 않는다.

- 정상·오류·판단 불가를 모두 모은다. 가려진 사실을 억지로 정상/오류로 정하지 않는다.
- ‘손녀가 자전거를 탄다’라는 **동일 사실**이 맞게/틀리게 그려진 사람 판정 쌍을 모으면 관계 대조 학습에 활용한다.
- 원래 생성 분포와 의도적으로 오류를 많이 모은 스트레스 자료를 구분한다.
- 생성 모델·화풍·품질·방식·프롬프트를 보관한다. 생성 알고리즘 비교 때는 다른 조건을 고정한다.
- 선택 장면 밖의 다른 사건은 그림에 없다고 누락 오류를 주지 않는다.
- 고정 시험 세트는 복수 검토자가 독립 판정한 뒤 불일치를 조정하는 것을 권장한다. 현재 앱은 단일 검토 기록이다.

```bash
python -m pip install -r ml/requirements-fusion.txt
PYTHONPATH=ml python -m diary_verifier.prepare reviewed-exports/*.json --out data/diary-v1
```

CUDA에 맞는 PyTorch를 사용한다. 예시·출처 미확인·불완전 판정을 거부하며 같은 사건·그림·원본/수정본·명시된 prompt family를 연결해 train/dev/test로 나눈다. 최소 3개 그룹은 빈 분할 방지 조건이지 충분한 표본 수가 아니다. 자료가 바뀌면 새 데이터 버전을 만든다.

## 2. 임베딩과 그림 특징 저장

```bash
PYTHONPATH=ml python -m diary_verifier.fusion_features --manifests data/diary-v1/train.jsonl data/diary-v1/dev.jsonl data/diary-v1/test.jsonl --cache features/diary-v1 --device cuda
```

CPU에서는 `--device cpu`를 사용한다. 기본 모델은 `BAAI/bge-m3`, `google/siglip2-base-patch16-384`다. 모델 commit·pooling·차원·이미지 전처리 설정을 고정한다. 사람 정답은 인코더 입력에서 제외한다. 너무 긴 입력은 메인/보조 사건으로 나누며 임의로 자르지 않는다.

## 3. 판정기 학습

```bash
PYTHONPATH=ml python -m diary_verifier.fusion_train --data data/diary-v1 --cache features/diary-v1 --out runs/plain --pair-weight 0
PYTHONPATH=ml python -m diary_verifier.fusion_train --data data/diary-v1 --cache features/diary-v1 --out runs/relation --pair-weight 0.25
```

두 실험은 같은 자료·시드·배치·구조를 사용하고 추가 손실만 바꾼다. 같은 확인 사실의 정상/오류 쌍이 없으면 두 번째 실험은 중단한다. dev loss로 가중치를 선택하며 test는 선택에 사용하지 않는다. 결과는 `fusion_head.pt`, `fusion_config.json`, `history.json`이다.

## 4. 같은 시험 자료로 API와 비교

```bash
PYTHONPATH=ml python -m diary_verifier.fusion_predict --manifest data/diary-v1/test.jsonl --cache features/diary-v1 --checkpoint runs/plain --out runs/plain.jsonl
PYTHONPATH=ml python -m diary_verifier.fusion_predict --manifest data/diary-v1/test.jsonl --cache features/diary-v1 --checkpoint runs/relation --out runs/relation.jsonl
PYTHONPATH=ml python -m diary_verifier.api_baseline --manifest data/diary-v1/test.jsonl --model YOUR_AVAILABLE_MODEL --out runs/api.jsonl --dry-run
```

강한 비교 API 모델/스냅샷을 지정한다. 실제 호출은 키를 비공개 환경 변수로 설정한 뒤 `--dry-run`을 제거할 때 실행되며 비용이 발생한다. 두 방식에 같은 그림·whitelist 문맥을 제공하고 사람 정답은 제외한다.

```bash
PYTHONPATH=ml python -m diary_verifier.evaluate --manifest data/diary-v1/test.jsonl --predictions runs/plain.jsonl runs/relation.jsonl runs/api.jsonl --out runs/comparison.json
```

3분류 F1, 오류 유형별 재현율, 잘못된 정상 통과율, 정상 그림 오경보율, 보류 비율을 계산한다. 누락·중복·다른 시험 파일의 예측을 거부하며 사건/그림 family 단위 paired bootstrap을 제공한다. 분류 확률은 보정된 확신도가 아니다.

**캐시 추론 시간은 연결 모듈만의 시간**이다. API와 전체 추론 시간을 비교할 때는 `fusion_predict`에서 `--cache ...` 대신 `--from-images`를 사용한다. 초기 가중치 로딩 시간·GPU 환경·API usage는 별도 기록한다. 생성기 오류율, 판정기 검출 성능, SCD 회상 효과는 서로 다른 평가다.

## 5. 앱 연결

실제 사람 판정으로 학습한 체크포인트를 내려받아 실행한다.

```bash
PYTHONPATH=ml python -m diary_verifier.fusion_serve --checkpoint runs/relation --port 8010
```

서버 `.env`에 다음을 설정한 뒤 Node 서버를 실행한다.

```dotenv
DIARY_VERIFY_BACKEND=local
DIARY_VERIFIER_URL=http://127.0.0.1:8010
```

검증 화면에서 **자체 학습 모델**을 선택한다. 판정 연결에는 API 키가 필요 없다. 학습 가중치가 없으면 서비스가 시작되지 않으며 API·예시 판정으로 자동 대체하지 않는다. API 그림 생성의 키와 비용은 별개다.

## 매칭팀 임베딩으로 교체

`shared_encoder.py`의 `TextEncoder` 규약을 구현하면 `FusionVerifier(..., text_encoder=...)`에 연결한다. 특징이 이미 있으면 `predict_features(EncodedText(...), image_patches)`로 직접 전달할 수 있다.

필요한 것은 **확인 사실별 임베딩**이다. 하루 일기의 압축 벡터 하나를 모든 사실에 똑같이 쓰지 않는다. `EncoderSpec`에 모델 버전·차원·pooling·최대 길이를 기록한다. 문장만 제공하는 모델은 `supports_tokens=False`로 선언하며 기본 `sentence` 방식으로 학습할 수 있다.

인코더가 바뀌면 차원이 같아도 의미 공간이 달라질 수 있어 **특징 재생성과 판정 모듈 재학습·평가**가 필요하다. 매칭 점수와 회상 중요도는 사실 판정 정답으로 복사하지 않는다. 시험 사건은 매칭팀 인코더 학습에서도 분리하거나 평가 조건을 명시한다.

## 별도 VLM 비교 경로와 확인 명령

기존 `train.py`·`predict.py`·`serve.py`와 `memory_connect_kaggle.ipynb`는 VLM LoRA 비교 실험으로 남긴다. 이 경로는 `--base-model`을 직접 지정하고 `ml/requirements.txt`를 설치한다. 주 노트북은 이름에 `fusion`이 들어간 파일이다.

```bash
PYTHONPATH=ml python -m unittest discover -s ml/tests -v
npm test
```

독립 판정기 ZIP에서는 Python 명령을 사용합니다. `npm test`와 앱 JavaScript 연동 시험은 전체 웹앱 패키지에서 실행합니다.

테스트는 캐시·학습 gradient·가중치 저장/재로딩·교체 규약·자료 누출 방지·API 연결을 확인한다. 실제 판정 성능 검증을 대신하지 않는다.
