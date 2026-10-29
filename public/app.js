import {localReply} from './conversation.js';
import {getDraft,putDraft,removeDraft,putEntry,listEntries,removeEntry} from './storage.js';
import {localDate,readableDate,newSession,currentImage,makeEntry,restorable} from './state.js';
const STANDALONE=false;
const $=id=>document.getElementById(id);
const screens=['home','photos','conversation','rest','review','result','done','history','detail'];
const writing=new Set(['photos','conversation','rest','review','result']);
let state=null,savedDraft=null,active='home',busy=false,retryAction=null,selectedEntry=null;
let saveTimer,saveQueue=Promise.resolve(),generation=0,recognition=null,recording=false;
$('todayLabel').textContent=readableDate(localDate());$('date').value=localDate();
function notify(message,error=false,detail=''){
 $('feedback').hidden=!message;$('feedback').classList.toggle('error',error);$('status').textContent=message;
 $('errorDetails').hidden=!detail;$('errorDetails').open=false;$('errorText').textContent=detail;
 $('retry').hidden=!error||!retryAction;
}
function stopVoice(){try{recognition?.stop();}catch{}window.speechSynthesis?.cancel();}
function view(screen,{focus=true}={}){
 stopVoice();active=screen;for(const name of screens)$(name).hidden=name!==screen;
 if(state&&writing.has(screen)){state.stage=screen;scheduleSave();}
 const step=['conversation','photos','rest'].includes(screen)?0:screen==='review'?1:['result','done'].includes(screen)?2:-1;
 $('steps').hidden=step<0;[...$('steps').children].forEach((li,i)=>{if(i===step)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
 if(screen==='home')renderResume();
 if(focus){const heading=$(screen).querySelector('h1,h2');requestAnimationFrame(()=>{heading?.focus({preventScroll:true});$('main').scrollIntoView({block:'start',behavior:'instant'});});}
}
function renderResume(){
 const draft=state||savedDraft;$('resumeCard').hidden=!draft;
 if(draft)$('resumeDescription').textContent=`${readableDate(draft.date)} · ${draft.draft?.title||draft.turns.find(t=>t.answer)?.answer?.slice(0,48)||'사진과 이야기가 기다리고 있어요.'}`;
}
function snapshot(){if(!state)return null;state.updatedAt=new Date().toISOString();return structuredClone(state);}
function scheduleSave(){if(!state)return;clearTimeout(saveTimer);$('autosaveStatus').textContent='작성한 이야기를 임시 저장하고 있어요…';saveTimer=setTimeout(()=>persist(),500);}
async function persist(){
 clearTimeout(saveTimer);const copy=snapshot(),epoch=generation;if(!copy)return;
 savedDraft=copy;saveQueue=saveQueue.catch(()=>{}).then(async()=>{if(epoch!==generation)return;await putDraft(copy);if(epoch===generation)$('autosaveStatus').textContent='이 기기에 임시 저장했어요. 나중에 이어 쓸 수 있어요.';});
 try{await saveQueue;}catch{$('autosaveStatus').textContent='임시 저장이 어려워요. 화면을 닫기 전 파일로 보관해 주세요.';}
}
async function clearWorking(){clearTimeout(saveTimer);generation++;await saveQueue.catch(()=>{});await removeDraft();state=null;savedDraft=null;$('autosaveStatus').textContent='';renderResume();}
function ask(title,body,label='확인'){
 return new Promise(resolve=>{const dialog=$('confirmDialog');$('confirmTitle').textContent=title;$('confirmBody').textContent=body;$('confirmAction').textContent=label;dialog.returnValue='cancel';dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true});dialog.showModal();});
}
async function task(fn,message,{drawing=false}={}){
 if(busy)return;busy=true;stopVoice();retryAction=null;$('retry').hidden=true;notify(message);$('busySpinner').hidden=false;$('busyHint').hidden=!drawing;$('workspace').setAttribute('aria-busy','true');
 document.querySelectorAll('button,input,textarea').forEach(e=>{if(e.id!=='fontButton')e.disabled=true;});
 try{await fn();notify('');}catch(e){retryAction=()=>task(fn,message,{drawing});const detail=e.message||'알 수 없는 연결 오류';let friendly=detail;
  if(/HTTP|API |모델 |AI |fetch|network/i.test(detail))friendly=drawing?'지금은 그림을 만들기 어려워요. 이야기는 그대로 있으니 글로 먼저 저장해도 괜찮아요.':'이야기를 연결하는 데 잠시 어려움이 있어요. 입력한 내용은 그대로 두었어요.';
  notify(friendly,true,friendly!==detail?detail:'');$('feedback').scrollIntoView({block:'nearest',behavior:'instant'});await persist();
 }finally{busy=false;$('busySpinner').hidden=true;$('busyHint').hidden=true;$('workspace').removeAttribute('aria-busy');document.querySelectorAll('button,input,textarea').forEach(e=>e.disabled=false);syncSpeechUI();}
}
$('retry').onclick=()=>retryAction?.();
async function api(path,data){
 if(STANDALONE){if(path==='question')return localReply(data);if(path==='draft'){const answers=data.turns.map(t=>t.answer.trim()).filter(Boolean);return {title:'오늘의 소중한 기억',body:answers.join('\n'),scene:answers.join(' ').slice(0,3000),mode:'local'};}throw new Error('단독 체험 화면에서는 AI 그림을 만들 수 없어요. 서버 실행과 API 키 연결이 필요해요.');}
 const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(path==='illustration'?135000:55000)});
 let result;try{result=await response.json();}catch{throw new Error('서버의 응답을 읽지 못했어요. 서버가 실행 중인지 확인해 주세요.');}if(!response.ok)throw new Error(result.error||'AI 연결에 실패했어요.');return result;
}
function read(text){
 if(!('speechSynthesis'in window)){notify('이 브라우저에서는 읽어주기가 어려워요. 화면의 글로 확인해 주세요.');return;}
 window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='ko-KR';utterance.rate=.85;utterance.onerror=e=>{if(!['canceled','interrupted'].includes(e.error))notify('음성을 재생하지 못했어요. 화면의 글로 확인해 주세요.');};speechSynthesis.speak(utterance);
}
try{if(localStorage.getItem('memory-diary-large-type')==='true'){document.documentElement.classList.add('large-type');$('fontButton').setAttribute('aria-pressed','true');$('fontButton').innerHTML='가<span class="font-label"> 기본 글씨</span>';}}catch{}
$('fontButton').onclick=()=>{const large=document.documentElement.classList.toggle('large-type');$('fontButton').setAttribute('aria-pressed',String(large));$('fontButton').innerHTML=large?'가<span class="font-label"> 기본 글씨</span>':'가<span class="font-label"> 글씨 크게</span>';try{localStorage.setItem('memory-diary-large-type',String(large));}catch{}};
$('homeButton').onclick=()=>{notify('');view('home');};$('photosBack').onclick=()=>view('home');$('restHome').onclick=()=>view('home');$('doneHome').onclick=()=>view('home');
async function start(withPhotos){
 if(busy)return;
 if((state||savedDraft)&&!await ask('새 이야기를 시작할까요?','쓰던 이야기는 새 이야기로 바뀌어요. 계속 쓰려면 돌아가기를 눌러주세요.','새로 시작하기'))return;
 if(!$('date').value){notify('기록할 날짜를 선택해 주세요.',true);$('date').focus();return;}
 if(state||savedDraft){try{await clearWorking();}catch{notify('쓰던 이야기를 정리하지 못했어요. 다시 시도해 주세요.',true);return;}}
 state=newSession($('date').value);notify('');
 if(withPhotos){renderPhotos();view('photos');await persist();}else{state.stage='conversation';view('conversation');paintConversation();await initialQuestion();}
}
$('startPhotos').onclick=()=>start(true);$('startTalk').onclick=()=>start(false);
async function initialQuestion(){await task(async()=>{const response=await api('question',{turns:[],photos:state.photos});state.question=response.question;state.answer='';paintConversation();view('conversation');await persist();},'첫 이야기를 준비하고 있어요…');}
$('resumeDraft').onclick=()=>{state=state||structuredClone(savedDraft);if(!restorable(state)){notify('쓰던 이야기를 열지 못했어요. 새 이야기를 시작해 주세요.',true);return;}notify('');$('date').value=state.date;renderPhotos();paintConversation();if(state.draft)paintReview();if(currentImage(state))paintResult();const target=state.stage;if(target==='result'&&!currentImage(state))view('review');else view(target);if(target==='conversation'&&!state.question)initialQuestion();};
async function resize(file){const bitmap=await createImageBitmap(file);try{const scale=Math.min(1,900/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.7);}finally{bitmap.close();}}
function renderPhotos(){
 $('photoCount').textContent=state?.photos.length?`${state.photos.length}장을 골랐어요. 더 골라도 좋아요. (최대 5장)`:'JPG · PNG · WebP / 한 장당 8MB 이하';$('photoGrid').replaceChildren();$('conversationPhotos').replaceChildren();
 for(const [i,src] of (state?.photos||[]).entries()){
  const tile=document.createElement('div');tile.className='photo-tile';const img=document.createElement('img');img.src=src;img.alt=`고른 사진 ${i+1}`;const remove=document.createElement('button');remove.textContent=`${i+1}번 사진 빼기`;remove.onclick=()=>{state.photos.splice(i,1);renderPhotos();scheduleSave();};tile.append(img,remove);$('photoGrid').append(tile);
  const small=img.cloneNode();$('conversationPhotos').append(small);
 }
}
$('photoFiles').onchange=()=>{const files=[...$('photoFiles').files];task(async()=>{
 if(files.length+state.photos.length>5)throw new Error('사진은 다섯 장까지 골라주세요. 고른 사진을 빼고 다시 추가할 수도 있어요.');
 if(files.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>8*1024*1024))throw new Error('한 장당 8MB 이하의 JPG, PNG, WebP 사진을 골라주세요.');
 let images;try{images=await Promise.all(files.map(resize));}catch{throw new Error('사진을 읽지 못했어요. 다른 사진으로 다시 골라주세요.');}if(images.some(p=>p.length>1500000))throw new Error('사진이 너무 커요. 더 작은 사진을 골라주세요.');
 state.photos.push(...images);$('photoFiles').value='';renderPhotos();await persist();
 },'사진을 준비하고 있어요…');};
$('beginPhotos').onclick=()=>{if(!state.photos.length){notify('사진을 고르거나 ‘사진 없이 시작할게요’를 눌러주세요.',true);return;}initialQuestion();};
$('withoutPhotos').onclick=()=>{state.photos=[];renderPhotos();initialQuestion();};
function paintConversation(){
 $('question').textContent=state?.question||'첫 이야기를 준비하고 있어요.';$('answer').value=state?.answer||'';$('transcript').replaceChildren();
 for(const turn of state?.turns||[]){const p=document.createElement('p');p.textContent=`기억잇다: ${turn.question}\n나: ${turn.answer||'(이 질문은 쉬어갔어요)'}`;$('transcript').append(p);}renderPhotos();
}
$('answer').oninput=()=>{if(state){state.answer=$('answer').value;scheduleSave();}};
function sessionInput(turns=state.turns){return {turns,photos:state.photos};}
async function makeDraft(turns){
 if(!turns.some(t=>t.answer.trim()))throw new Error('짧은 이야기 하나만 남겨주시면 일기로 정리할 수 있어요.');
 const response=await api('draft',sessionInput(turns));state.turns=turns;state.answer='';state.draft={title:response.title,body:response.body,scene:response.scene};state.image='';state.imageScene='';
 $('draftNote').textContent=response.mode==='ai'?'내 이야기와 맞는지 편하게 읽어보세요.':'말씀해주신 이야기를 모았어요. 원하는 표현으로 고칠 수 있어요.';paintReview();view('review');await persist();
}
function advance({skip=false,finish=false}={}){
 task(async()=>{
 const answer=skip?'':state.answer.trim();if(!skip&&!finish&&!answer)throw new Error('짧게 적어도 좋아요. 답하기 어려우면 ‘잘 모르겠어요’를 눌러주세요.');
 const turns=[...state.turns,{question:state.question,answer}];
 if(finish||turns.length>=6){await makeDraft(turns);return;}
 const response=await api('question',sessionInput(turns));
 if(response.ready){await makeDraft(turns);return;}
 state.turns=turns;state.answer='';state.question=response.question;paintConversation();view(response.rest?'rest':'conversation');await persist();
 },finish?'이야기를 일기로 정리하고 있어요…':'말씀해주신 이야기를 듣고 있어요…');
}
$('next').onclick=()=>advance();$('skip').onclick=()=>advance({skip:true});$('finish').onclick=()=>advance({finish:true});$('pause').onclick=()=>{notify('');view('rest');persist();};$('resume').onclick=()=>{view('conversation');if(!state.question)initialQuestion();};$('restFinish').onclick=()=>advance({finish:true});
$('readQuestion').onclick=()=>read(state.question);$('readDiary').onclick=()=>read(`${state.draft.title}. ${state.draft.body}`);
function paintReview(){
 if(!state?.draft)return;
 $('reviewDate').textContent=readableDate(state.date);$('previewTitle').textContent=state.draft.title;$('previewBody').textContent=state.draft.body;$('previewScene').textContent=state.draft.scene;
 for(const id of ['title','body','scene'])$(id).value=state.draft[id];
 $('editPanel').hidden=true;$('editToggle').setAttribute('aria-expanded','false');
 const stale=state.image&&!currentImage(state);$('imageNotice').hidden=!stale;$('imageNotice').textContent='그림 장면을 바꿨어요. 새 장면으로 다시 그리거나, 글로 먼저 저장할 수 있어요.';
 $('draw').textContent=currentImage(state)?'맞아요, 그림일기 확인하기':'맞아요, 그림으로 남겨주세요';
}
$('editToggle').onclick=()=>{const open=$('editPanel').hidden;$('editPanel').hidden=!open;$('editToggle').setAttribute('aria-expanded',String(open));if(open)$('title').focus();};
for(const id of ['title','body','scene'])$(id).oninput=()=>{state.draft[id]=$(id).value;scheduleSave();};
$('applyEdits').onclick=()=>{if(!state.draft.title.trim()||!state.draft.body.trim()||!state.draft.scene.trim()){notify('제목과 이야기, 그림 장면이 비어 있지 않은지 확인해 주세요.',true);return;}paintReview();notify('수정한 이야기를 확인해 주세요.');persist();$('previewTitle').scrollIntoView({block:'start',behavior:'instant'});};
async function draw(){
 if(!state.draft.title.trim()||!state.draft.body.trim()||!state.draft.scene.trim()){notify('이야기 내용을 먼저 확인해 주세요.',true);return;}
 if(currentImage(state)){paintResult();view('result');return;}
 await task(async()=>{const response=await api('illustration',state.draft);state.image=response.image;state.imageScene=state.draft.scene.trim();paintResult();view('result');await persist();},'이야기를 한 장의 그림으로 그리고 있어요…',{drawing:true});
}
$('draw').onclick=draw;
function paintResult(){$('resultDate').textContent=readableDate(state.date);$('resultHeading').textContent=state.draft.title;$('resultBody').textContent=state.draft.body;$('illustration').src=currentImage(state);}
$('resultEdit').onclick=()=>{paintReview();view('review');$('editToggle').click();};
$('redraw').onclick=async()=>{if(await ask('그림을 다시 그릴까요?','같은 이야기로 새로운 그림을 만들어요. 추가 API 비용이 발생해요.','다시 그리기')){const old=state.image;const oldScene=state.imageScene;await task(async()=>{const response=await api('illustration',state.draft);state.image=response.image;state.imageScene=state.draft.scene.trim();paintResult();await persist();},'새로운 그림을 그리고 있어요…',{drawing:true});if(!state.image){state.image=old;state.imageScene=oldScene;}}};
$('backToTalk').onclick=()=>{const last=state.turns.pop();if(last){state.question=last.question;state.answer=last.answer;}paintConversation();notify('');view('conversation');persist();};
async function saveEntry(textOnly=false){
 await task(async()=>{const entry=makeEntry(state,state.entryId||(state.entryId=crypto.randomUUID()));if(textOnly){entry.image='';entry.imageKind=null;}else if(!entry.image)throw new Error('저장할 그림이 없어요. 글로 먼저 저장할 수 있어요.');
 await putEntry(entry);selectedEntry=entry;await clearWorking();$('doneDescription').textContent=textOnly?'그림이 없어도 소중한 하루의 기록이에요. 내 일기장에서 다시 만날 수 있어요.':'나눈 이야기와 그림을 내 일기장에 담았어요. 언제든 다시 펼쳐보세요.';view('done');
 },'일기장에 소중히 담고 있어요…');
}
$('save').onclick=()=>saveEntry();$('saveText').onclick=()=>saveEntry(true);
function download(entry){const url=URL.createObjectURL(new Blob([JSON.stringify(entry,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`기억잇다-${entry.date}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('exportResult').onclick=()=>download(makeEntry(state,'export'));
$('exportReview').onclick=()=>{try{download(makeEntry(state,'export'));}catch(e){notify(e.message,true);}};
async function showHistory(){await task(async()=>{const entries=await listEntries();$('diaries').replaceChildren();
 if(!entries.length){const card=document.createElement('div');card.className='empty-state';const h=document.createElement('h2');h.textContent='첫 번째 이야기를 기다리고 있어요';const p=document.createElement('p');p.textContent='오늘 드신 음식이나 잠깐의 산책도 좋은 일기가 돼요.';const button=document.createElement('button');button.className='primary';button.textContent='이야기 시작하기';button.onclick=()=>view('home');card.append(h,p,button);$('diaries').append(card);}
 for(const entry of entries){const card=document.createElement('article');card.className='diary-card';
 if(typeof entry.image==='string'&&/^data:image\/jpeg;base64,/.test(entry.image)){const img=document.createElement('img');img.src=entry.image;img.alt='AI가 그린 일기 삽화';img.loading='lazy';card.append(img);}else{const cover=document.createElement('div');cover.className='text-cover';cover.textContent='오늘의 이야기';card.append(cover);}
 const content=document.createElement('div');content.className='diary-card-content';const date=document.createElement('time');date.dateTime=entry.date;date.textContent=readableDate(entry.date);const heading=document.createElement('h2');heading.textContent=entry.title;const excerpt=document.createElement('p');excerpt.textContent=entry.body;const button=document.createElement('button');button.className='secondary';button.textContent='일기 펼쳐보기';button.setAttribute('aria-label',`${entry.title} 일기 펼쳐보기`);button.onclick=()=>openEntry(entry);content.append(date,heading,excerpt,button);card.append(content);$('diaries').append(card);}
 view('history');
 },'일기장을 펼치고 있어요…');}
function openEntry(entry){selectedEntry=entry;$('detailCard').replaceChildren();const date=document.createElement('p');date.className='paper-date';date.textContent=readableDate(entry.date);const h=document.createElement('h1');h.id='detailTitle';h.tabIndex=-1;h.textContent=entry.title;$('detailCard').append(date,h);
 if(typeof entry.image==='string'&&/^data:image\/jpeg;base64,/.test(entry.image)){const figure=document.createElement('figure');const img=document.createElement('img');img.src=entry.image;img.alt='오늘 이야기로 AI가 그린 삽화';const caption=document.createElement('figcaption');caption.textContent='AI로 그린 그림 · 실제 사진이 아니에요.';figure.append(img,caption);$('detailCard').append(figure);}
 const body=document.createElement('p');body.className='diary-body';body.textContent=entry.body;$('detailCard').append(body);view('detail');}
$('historyButton').onclick=showHistory;$('doneHistory').onclick=showHistory;$('detailBack').onclick=showHistory;$('historyReturn').onclick=()=>{notify('');view(state?.stage||'home');};
$('readSaved').onclick=()=>read(`${selectedEntry.title}. ${selectedEntry.body}`);$('exportSaved').onclick=()=>download(selectedEntry);
$('deleteSaved').onclick=async()=>{if(!await ask('이 일기를 지울까요?','삭제한 일기는 다시 복구하기 어려워요. 보관하려면 먼저 파일로 내려받아 주세요.','일기 삭제하기'))return;await task(async()=>{await removeEntry(selectedEntry.id);selectedEntry=null;},'일기를 정리하고 있어요…');if(!selectedEntry)showHistory();};
$('clearDraft').onclick=async()=>{if(!state&&!savedDraft){notify('작성 중인 이야기가 없어요.');return;}if(await ask('쓰던 이야기를 지울까요?','저장한 일기는 남아 있어요. 작성 중인 사진과 대화만 지워져요.','쓰던 이야기 지우기'))await task(async()=>{await clearWorking();view('home');},'쓰던 이야기를 정리하고 있어요…');};
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
function syncSpeechUI(){
 $('microphone').hidden=!SpeechRecognition;$('microphone').classList.toggle('listening',recording);$('microphone').setAttribute('aria-pressed',String(recording));$('microphone').textContent=recording?'말하기 끝내기':'마이크로 말하기';
 if(!recording)$('speechHint').textContent=SpeechRecognition?'말한 내용은 입력창에서 고칠 수 있어요.':'이 브라우저에서는 글로 입력해 주세요. 스마트폰 키보드의 음성 입력도 좋아요.';
}
$('microphone').onclick=()=>{
 if(recording){recognition.stop();return;}
 if(!SpeechRecognition)return;
 stopVoice();recognition=new SpeechRecognition();recognition.lang='ko-KR';recognition.continuous=false;recognition.interimResults=true;const before=state.answer;
 recognition.onstart=()=>{recording=true;syncSpeechUI();$('speechHint').textContent='듣고 있어요. 편하게 말씀해 주세요.';};
 recognition.onresult=event=>{if(busy||active!=='conversation')return;let final='',interim='';for(let i=0;i<event.results.length;i++){if(event.results[i].isFinal)final+=event.results[i][0].transcript;else interim+=event.results[i][0].transcript;}
 if(final){state.answer=`${before}${before?' ':''}${final}`.slice(0,2000);$('answer').value=state.answer;scheduleSave();}$('speechHint').textContent=interim||'입력한 내용을 확인하고 이야기를 전해주세요.';};
 recognition.onerror=event=>{const messages={'not-allowed':'마이크 사용이 허용되지 않았어요. 주소창의 권한을 확인하거나 글로 입력해 주세요.','no-speech':'목소리를 듣지 못했어요. 다시 누르거나 글로 입력해 주세요.',network:'음성 인식에 연결하지 못했어요. 글로 입력해도 괜찮아요.','audio-capture':'마이크를 사용할 수 없어요. 연결 상태를 확인해 주세요.'};if(event.error!=='aborted')notify(messages[event.error]||'말소리를 입력하지 못했어요. 글로 입력해도 괜찮아요.');};
 recognition.onend=()=>{recording=false;syncSpeechUI();};try{recognition.start();}catch{recording=false;syncSpeechUI();notify('마이크를 시작하지 못했어요. 글로 입력해 주세요.');}
};
syncSpeechUI();
async function initialize(){
 if(STANDALONE){$('mode').textContent='체험으로 둘러보기';$('connectionInfo').textContent='이 파일은 체험용이에요. 실제 AI 대화와 그림 생성은 서버를 실행하고 API 키를 연결해야 해요.';}
 else try{const response=await fetch('/api/config');if(!response.ok)throw new Error();const config=await response.json();$('mode').textContent=config.aiEnabled?'오늘의 그림일기':'체험으로 둘러보기';$('connectionInfo').textContent=config.aiEnabled?'서버에 API 키가 설정돼 있어요. 실제 이용 가능 여부는 모델 권한과 결제 상태에 따라 달라요.':'현재는 규칙 기반 체험 모드예요. 실제 AI 사용에는 서버의 .env에 API 키 설정이 필요해요.';}catch{$('mode').textContent='연결 확인 필요';$('connectionInfo').textContent='서버 연결을 확인해 주세요.';}
 try{const stored=await getDraft();if(restorable(stored))savedDraft=stored;renderResume();}catch{$('autosaveStatus').textContent='이 브라우저에서는 임시 저장을 사용할 수 없어요.';}
}
initialize();
window.addEventListener('pagehide',()=>persist());
