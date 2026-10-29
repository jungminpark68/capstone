# 🌸 기억잇다 — AI 그림일기 웹 MVP

오늘의 사진 0~5장 또는 대화만으로 시작 → 회상 대화 → 일기와 그림 장면 확인·수정 → AI 삽화 생성 → 저장합니다. 최종 모바일 앱에서도 같은 서버 API를 호출할 수 있습니다.

## 윈도우에서 시작하기

1. https://nodejs.org 에서 Node.js **24 LTS**를 설치합니다. VS Code를 종료했다가 다시 열어 PATH를 적용하세요.
2. ZIP의 **압축을 모두 풀기**를 선택합니다. VS Code에서 `package.json`과 `server.js`가 있는 `memory-diary` 폴더를 엽니다.
3. `.env.example` 파일을 복사해 `.env`로 이름을 바꿉니다. VS Code에서 새 파일 `.env`를 만들고 예제 내용을 복사해도 됩니다.
4. `.env`의 `DIARY_API_KEY=` 뒤에 본인의 실제 API 키를 붙여넣고 저장합니다. 키를 채팅·GitHub·브라우저 코드에 넣지 마세요. `.env`는 Git에서 제외합니다.
5. **터미널 → 새 터미널**을 열고 아래를 실행합니다.

```powershell
node --env-file-if-exists=.env server.js
```

또는 압축을 푼 폴더에서 `start-windows.cmd`를 더블클릭합니다. 실행 파일은 `.env`가 없을 경우 예제를 복사하며, 실제 키는 직접 입력해야 합니다. `.env`를 수정했다면 서버에서 `Ctrl+C`를 누른 후 다시 실행하세요.

6. Chrome 또는 Edge에서 **http://localhost:3000** 을 엽니다. 터미널은 켜둡니다. 종료는 `Ctrl+C`입니다. Node.js 22 이상이 필요하며 `npm install`은 필요하지 않습니다.

```dotenv
DIARY_API_KEY=본인의_실제_API_키
DIARY_MODEL=gpt-4o-mini
DIARY_IMAGE_MODEL=gpt-image-1
PORT=3000
```

API 키가 없으면 체험 모드로 작동합니다. 사진을 분석하지 않고, 이전 발언의 키워드와 질문 기록을 이용해 반복을 피합니다. 실제 AI가 생성한 그림인 것처럼 대체 이미지를 표시하지 않습니다. 단독 `demo.html`도 체험용이며, 키를 넣어도 이 파일만 열어서는 실제 AI를 호출하지 않습니다.

## 문제 해결

- `node`를 찾지 못함: Node.js 설치 후 VS Code를 완전히 종료하고 다시 열기.
- `--env-file-if-exists` 옵션 오류: Node.js 24 LTS로 업데이트.
- 체험 모드가 계속 표시됨: `.env.txt`가 아닌 `.env`인지, 파일이 `server.js`와 같은 폴더인지 확인하고 서버 재시작.
- 3000 포트 사용 중: 이전 서버를 종료하거나 `.env`의 PORT를 3001로 바꾼 뒤 해당 포트로 접속.
- AI 인증 오류: API 키 유효성 확인. ChatGPT 구독과 API 결제는 별개입니다.
- 이미지 권한 오류: 모델 접근 권한·조직 인증·API 결제 상태 확인.
- 저장 공간 부족: 작성 화면에서 JSON 파일로 보관. 파일 가져오기 기능은 아직 없습니다.

## AI 및 개인정보

회상 대화/글은 이미지 입력·JSON 출력을 지원하는 Chat Completions 모델을 사용합니다. 삽화는 Images Generations API에서 1024×1024, low quality, JPEG로 생성합니다. 기본값은 각각 `gpt-4o-mini`, `gpt-image-1`이며 계정에서 이용 가능한지 확인해야 합니다. 실제 AI 품질과 권한 검증에는 유효한 키가 필요합니다. 생성과 재생성에 API 비용이 발생합니다.

사진과 전체 대화는 질문·초안 생성 시 OpenAI로 전송합니다. 그림 생성에는 사용자가 확인한 제목·본문·장면만 전송합니다. 원본 얼굴을 복제하는 사진 편집 API는 사용하지 않습니다. `prompts.js`에서 역할별 프롬프트를 수정할 수 있습니다.

그림은 실제 사진과 다른 **AI 삽화**임을 표시합니다. 글과 장면을 바꾸면 재확인·재생성 후 저장해야 합니다. API 실패 시 작성 내용은 유지됩니다. 생성 결과는 사용자 확인이 필요합니다.

저장한 일기는 브라우저 localStorage에 보관되며, 원본 사진은 저장하지 않습니다. 계정·DB·기기 간 동기화·가족 음성 합성은 없습니다. 읽어주기는 브라우저 기본 TTS입니다. 새로고침하면 저장 전 대화가 사라집니다. 개발 서버는 이 컴퓨터에서만 접속할 수 있도록 127.0.0.1에 바인딩합니다. 공개 운영에는 인증·호출 제한·보관 정책이 별도로 필요합니다.

Flickr8k/30k는 사용 조건을 확인하고 사진 경로 시연에 활용하세요. 촬영 날짜·관계·감정을 캡션만으로 사용자 경험으로 해석하지 않습니다. 데이터셋 자동 다운로드나 학습은 포함하지 않습니다.

## API / 개발

- `GET /api/config`: 키 설정 여부. 실제 인증 성공을 뜻하지 않음.
- `POST /api/question`: `{turns:[{question,answer}],photos:[JPEG 데이터 URL]}` → `{question,ready,rest?,mode}`
- `POST /api/draft`: 같은 입력 → `{title,body,scene,mode}`
- `POST /api/illustration`: 확인한 `{title,body,scene}` → `{image: JPEG 데이터 URL,mode}`

사진 최대 5장(각 URL 150만 문자), 요청 전체 8MB, 답변당 2000자 제한. 브라우저에서 최대 900px JPEG로 축소합니다. 대화는 최대 6회이며 충분한 이야기가 모이면 일찍 정리합니다. 이전 답변·건너뛴 질문을 반복하지 않도록 설계합니다. 규칙 기반 체험은 복잡한 문맥을 완전히 이해하지는 못합니다.

```powershell
npm test
npm run build:demo
```

테스트는 입력 검증·반복 질문 방지·조기 종료·HTTP API·모의 AI 응답을 검증합니다. 실제 OpenAI 생성 검증과 구분하세요. `build:demo`는 스타일과 스크립트를 포함한 단일 `demo.html`을 재생성합니다.

HTTP 오류에는 민감한 원문 대신 오류 코드(code)와 문제 옵션(param)이 표시됩니다. 오류가 계속되면 이 식별자와 발생 단계를 알려주세요. API 키는 공유하지 마세요.
