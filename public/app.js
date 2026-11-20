import {calendarEvent,nextDate,localPlans,experienceTurns,validDate,monthDays,shiftMonth,planCandidate,futurePlanText} from './calendar.js';
import {localReply} from './conversation.js';
import {getDraft,putDraft,removeDraft,putEntry,listEntries,removeEntry,listEvents,putEvent,putEvents,removeEvent,updateEvent,resetAppData} from './storage.js';
import {localDate,readableDate,newSession,currentImage,makeEntry,restorable,conversationTranscript} from './state.js';
import {mountSceneForm} from './scene-form.js';
import {localExperienceEvents,createExperienceBundle,chooseExperience,prepareExperience,collectionQuestion,applyCollectionAnswer,composeExperienceScene,selectedDiaryText} from './experience-flow.js';
const STANDALONE=false;
if(STANDALONE)document.querySelectorAll('a[href="/verification"]').forEach(link=>link.href='verification-demo.html');
const $=id=>document.getElementById(id);
const screens=['home','photos','conversation','rest','tomorrow','review','result','done','history','detail','calendar'];
const writing=new Set(['photos','conversation','rest','tomorrow','review','result']);
let state=null,savedDraft=null,active='home',busy=false,retryAction=null,selectedEntry=null;
let calendarReturn='home',editingEventId=null,editingExisting=false;
let saveTimer,saveQueue=Promise.resolve(),generation=0,recognition=null,recording=false;
let sceneForm=null;
resetHomeDate();
function notify(message,error=false,detail=''){
 $('feedback').hidden=!message;$('feedback').classList.toggle('error',error);$('status').textContent=message;
 $('errorDetails').hidden=!detail;$('errorDetails').open=false;$('errorText').textContent=detail;
 $('retry').hidden=!error||!retryAction;
}
function stopVoice(){try{recognition?.stop();}catch{}window.speechSynthesis?.cancel();}
function view(screen,{focus=true}={}){
 stopVoice();active=screen;document.querySelector('.topline').classList.toggle('home-topline',screen==='home');for(const name of screens)$(name).hidden=name!==screen;
 if(state&&writing.has(screen)){state.stage=screen;scheduleSave();}
 const step=['conversation','photos','rest'].includes(screen)?0:screen==='tomorrow'?1:screen==='review'?2:['result','done'].includes(screen)?3:-1;
 $('steps').hidden=step<0;[...$('steps').children].forEach((li,i)=>{if(i===step)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
 $('calendarButton').setAttribute('aria-current',screen==='calendar'?'page':'false');
 $('historyButton').setAttribute('aria-current',['history','detail'].includes(screen)?'page':'false');
 if(screen==='home'){resetHomeDate();renderResume();refreshHomeSchedule();}
 $('settingsMenu').open=false;
 if(focus){const heading=$(screen).querySelector('h1,h2');requestAnimationFrame(()=>{heading?.focus({preventScroll:true});$('main').scrollIntoView({block:'start',behavior:'instant'});});}
}
function renderResume(){
 const draft=state||savedDraft;$('resumeCard').hidden=!draft;
 if(draft){$('resumeTitle').textContent=draft.date===localDate()?'오늘 쓰던 이야기가 있어요':`${readableDate(draft.date)}에 쓰던 이야기`; $('resumeDraft').textContent='쓰던 이야기 이어쓰기';}
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
 document.querySelectorAll('button,input,textarea,select').forEach(e=>{if(e.id!=='fontButton')e.disabled=true;});
 try{await fn();notify('');}catch(e){retryAction=()=>task(fn,message,{drawing});const detail=e.message||'알 수 없는 연결 오류';let friendly=detail;
  if(/HTTP|API |모델 |AI |fetch|network/i.test(detail))friendly=drawing?'지금은 그림을 만들기 어려워요. 이야기는 그대로 있으니 글로 먼저 저장해도 괜찮아요.':'이야기를 연결하는 데 잠시 어려움이 있어요. 입력한 내용은 그대로 두었어요.';
  notify(friendly,true,friendly!==detail?detail:'');$('feedback').scrollIntoView({block:'nearest',behavior:'instant'});await persist();
 }finally{busy=false;$('busySpinner').hidden=true;$('busyHint').hidden=true;$('workspace').removeAttribute('aria-busy');document.querySelectorAll('button,input,textarea,select').forEach(e=>e.disabled=false);syncSpeechUI();}
}
$('retry').onclick=()=>retryAction?.();
async function api(path,data){
 if(STANDALONE){if(path==='scene-text')return {body:selectedDiaryText(data),mode:'local'};if(path==='scene-draft'){const candidates=localExperienceEvents(data.session);return {candidates,candidate:candidates[0]};}if(path==='scene-answer'){const candidate=applyCollectionAnswer(data.candidate,data.field,data.answer);return {candidate,nextQuestion:collectionQuestion(candidate)};}if(path==='question')return localReply({...data,turns:experienceTurns(data.turns)});if(path==='plans')return {events:localPlans(data),mode:'local'};if(path==='draft'){const answers=experienceTurns(data.turns).map(t=>t.answer.trim()).filter(Boolean);if(!answers.length)throw new Error('오늘 실제로 하신 이야기를 한 가지만 들려주세요.');return {title:'오늘의 소중한 기억',body:answers.join('\n'),scene:answers.join(' ').slice(0,3000),mode:'local'};}throw new Error('단독 체험 화면에서는 AI 그림을 만들 수 없어요. 서버 실행과 API 키 연결이 필요해요.');}
 const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(['illustration','scene-illustration'].includes(path)?135000:55000)});
 let result;try{result=await response.json();}catch{throw new Error('서버의 응답을 읽지 못했어요. 서버가 실행 중인지 확인해 주세요.');}if(!response.ok)throw new Error(result.error||'AI 연결에 실패했어요.');return result;
}
function read(text){
 if(!('speechSynthesis'in window)){notify('이 브라우저에서는 읽어주기가 어려워요. 화면의 글로 확인해 주세요.');return;}
 window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='ko-KR';utterance.rate=.85;utterance.onerror=e=>{if(!['canceled','interrupted'].includes(e.error))notify('음성을 재생하지 못했어요. 화면의 글로 확인해 주세요.');};speechSynthesis.speak(utterance);
}
try{if(localStorage.getItem('memory-diary-large-type')==='true'){document.documentElement.classList.add('large-type');$('fontButton').setAttribute('aria-pressed','true');$('fontButton').innerHTML='가<span class="font-label"> 기본 글씨</span>';}}catch{}
$('fontButton').onclick=()=>{const large=document.documentElement.classList.toggle('large-type');$('fontButton').setAttribute('aria-pressed',String(large));$('fontButton').innerHTML=large?'가<span class="font-label"> 기본 글씨</span>':'가<span class="font-label"> 글씨 크게</span>';try{localStorage.setItem('memory-diary-large-type',String(large));}catch{}};
$('homeButton').onclick=()=>{notify('');view('home');};$('photosBack').onclick=()=>view('home');$('restHome').onclick=()=>view('home');$('doneHome').onclick=()=>view('home');
async function start(withPhotos,{date=localDate()}={}){
 if(busy)return;
 if((state||savedDraft)&&!await ask('새 이야기를 시작할까요?','쓰던 이야기는 새 이야기로 바뀌어요. 계속 쓰려면 돌아가기를 눌러주세요.','새로 시작하기'))return;
 if(!validDate(date)){notify('기록할 날짜를 선택해 주세요.',true);$('date').focus();return;}
 let events;try{events=await listEvents();}catch{notify('캘린더를 읽지 못했어요. 새로고침 후 다시 시도해 주세요.',true);return;}
 if(state||savedDraft){try{await clearWorking();}catch{notify('쓰던 이야기를 정리하지 못했어요. 다시 시도해 주세요.',true);return;}}
 state=newSession(date);state.todayEvents=events.filter(e=>e.date===state.date).sort(eventOrder).slice(0,20);notify('');
 if(withPhotos){renderPhotos();view('photos');await persist();}else{state.stage='conversation';view('conversation');paintConversation();await initialQuestion();}
}
$('startPhotos').onclick=()=>start(true);$('startTalk').onclick=()=>start(false);
$('startOtherTalk').onclick=()=>start(false,{date:$('date').value});$('startOtherPhotos').onclick=()=>start(true,{date:$('date').value});
async function initialQuestion(){await task(async()=>{const response=await api('question',sessionInput([]));state.question=response.question;state.answer='';paintConversation();view('conversation');await persist();},'첫 이야기를 준비하고 있어요…');}
$('resumeDraft').onclick=()=>{state=state||structuredClone(savedDraft);state={...newSession(state.date),...state};if(!restorable(state)){notify('쓰던 이야기를 열지 못했어요. 새 이야기를 시작해 주세요.',true);return;}notify('');renderPhotos();paintConversation();if(state.stage==='tomorrow')paintTomorrow();if(state.draft)paintReview();if(currentImage(state))paintResult();const target=state.stage;if(target==='result'&&!currentImage(state))view('review');else view(target);if(target==='conversation'&&!state.question)initialQuestion();};
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
 $('writingDate').textContent=state?`${state.date===localDate()?'오늘 · ':''}${readableDate(state.date)}의 이야기`:'';
 $('scheduleContext').hidden=!state?.todayEvents?.length;if(state?.todayEvents?.length)$('scheduleContext').textContent=`${readableDate(state.date)}의 예정된 일정을 참고하고 있어요. 실제 경험이 다르면 편하게 알려주세요.`;
 $('question').textContent=state?.question||'첫 이야기를 준비하고 있어요.';$('answer').value=state?.answer||'';$('transcript').replaceChildren();
 for(const turn of state?.turns||[]){const p=document.createElement('p');p.textContent=`기억잇다: ${turn.question}\n나: ${turn.answer||'(이 질문은 쉬어갔어요)'}`;$('transcript').append(p);}renderPhotos();
}
$('answer').oninput=()=>{if(state){state.answer=$('answer').value;scheduleSave();}};
function sessionInput(turns=state.turns){return {turns,photos:state.photos,date:state.date,todayEvents:state.todayEvents||[]};}
async function makeDraft(turns){
 if(!turns.some(t=>t.answer.trim()))throw new Error('짧은 이야기 하나만 남겨주시면 일기로 정리할 수 있어요.');
 const response=await api('draft',sessionInput(turns));state.turns=turns;state.answer='';state.draft={title:response.title,body:response.body,scene:response.scene};state.dayNarrative=response.body;state.image='';state.imageScene='';state.imageEventId=null;state.sceneRecord=null;state.sceneCandidate=null;state.scenePreparationOpen=false;
 let candidates;
 try{const prepared=await api('scene-draft',{draft:state.draft,session:sessionInput(turns)});candidates=prepared.candidates||(prepared.candidate?[prepared.candidate]:[]);}catch{candidates=localExperienceEvents(sessionInput(turns));}
 if(candidates?.length){state.experienceBundle=createExperienceBundle(candidates,state.draft.body);state.experienceBundle.sourceUtterances=experienceTurns(turns).map(t=>t.answer);if(state.experienceBundle.selectedEventId)state.draft.scene=state.experienceBundle.events[0].scene;}
 else state.experienceBundle=null;
 $('draftNote').textContent=response.mode==='ai'?'내 이야기와 맞는지 편하게 읽어보세요.':'말씀해주신 이야기를 모았어요. 원하는 표현으로 고칠 수 있어요.';paintReview();view('review');await persist();
}
function advance({skip=false,finish=false}={}){
 if(busy)return;
 const answer=skip?'':state.answer.trim(),turns=[...state.turns,{question:state.question,answer,answeredAt:new Date().toISOString()}];
 task(async()=>{
 if(!skip&&!finish&&!answer)throw new Error('짧게 적어도 좋아요. 답하기 어려우면 ‘다른 이야기 할래요’를 눌러주세요.');
 if(finish||turns.length>=6){await finishToday(turns);return;}
 const response=await api('question',sessionInput(turns));
 if(response.ready){await finishToday(turns);return;}
 state.turns=turns;state.answer='';state.question=response.question;paintConversation();view(response.rest?'rest':'conversation');await persist();
 },finish?'오늘 이야기를 정리하고 있어요…':'말씀해주신 이야기를 듣고 있어요…');
}
$('next').onclick=()=>advance();$('skip').onclick=()=>advance({skip:true});$('finish').onclick=()=>advance({finish:true});$('pause').onclick=()=>{notify('');view('rest');persist();};$('resume').onclick=()=>{view('conversation');if(!state.question)initialQuestion();};$('restFinish').onclick=()=>advance({finish:true});
$('readQuestion').onclick=()=>read(state.question);$('readDiary').onclick=()=>read(`${state.draft.title}. ${state.draft.body}`);
function paintReview(){
 if(!state?.draft)return;
 $('reviewDate').textContent=readableDate(state.date);$('previewTitle').textContent=state.draft.title;$('previewBody').textContent=state.draft.body;$('previewScene').textContent=state.draft.scene;
 for(const id of ['title','body','scene'])$(id).value=state.draft[id];
 $('editPanel').hidden=true;$('editToggle').setAttribute('aria-expanded','false');$('scenePreparation').hidden=true;renderExperienceChoices();renderDialogue($('reviewDialogue'),conversationTranscript(state));
 if(state.scenePreparationOpen&&state.experienceBundle?.selectedEventId)paintScenePreparation();
 const stale=state.image&&!currentImage(state);$('imageNotice').hidden=!stale;$('imageNotice').textContent='그림 장면을 바꿨어요. 새 장면으로 다시 그리거나, 글로 먼저 저장할 수 있어요.';
 $('draw').textContent=currentImage(state)?'맞아요, 그림일기 확인하기':'맞아요, 그림으로 남겨주세요';
}
$('editToggle').onclick=()=>{const open=$('editPanel').hidden;$('editPanel').hidden=!open;$('editToggle').setAttribute('aria-expanded',String(open));if(open)$('title').focus();};
for(const id of ['title','body','scene'])$(id).oninput=()=>{state.draft[id]=$(id).value;if(id==='scene'){state.sceneRecord=null;state.sceneCandidate=null;state.image='';state.imageScene='';const selected=state.experienceBundle?.events.find(e=>e.id===state.experienceBundle.selectedEventId);if(selected){selected.scene=state.draft.scene;selected.confirmed=false;}}scheduleSave();};
$('applyEdits').onclick=()=>{if(!state.draft.title.trim()||!state.draft.body.trim()||!state.draft.scene.trim()){notify('제목과 이야기, 그림 장면이 비어 있지 않은지 확인해 주세요.',true);return;}paintReview();notify('수정한 이야기를 확인해 주세요.');persist();$('previewTitle').scrollIntoView({block:'start',behavior:'instant'});};
function selectedExperience(){return state?.experienceBundle?.events.find(event=>event.id===state.experienceBundle.selectedEventId);}
function renderExperienceChoices(){
 const bundle=state.experienceBundle;$('eventSelection').hidden=!bundle;if(!bundle)return;
 $('eventChoices').replaceChildren();$('fullDayStory').textContent=state.dayNarrative||bundle.diaryNarrative;
 for(const event of bundle.events){const button=document.createElement('button');button.type='button';button.className='event-choice';button.dataset.eventId=event.id;button.setAttribute('aria-pressed',String(bundle.selectedEventId===event.id));const heading=document.createElement('strong');heading.textContent=event.title;const summary=document.createElement('span');summary.textContent=event.scene.slice(0,180);button.append(heading,summary);button.onclick=()=>{if(bundle.selectedEventId===event.id)return;const selected=chooseExperience(bundle,event.id);state.sceneCandidate=selected;state.sceneRecord=null;state.image='';state.imageScene='';state.imageEventId=null;state.imageGeneration=null;state.scenePreparationOpen=false;state.sceneAnswer='';state.draft.title=selected.title;state.draft.body=selected.scene;state.draft.scene=selected.scene;paintReview();scheduleSave();};$('eventChoices').append(button);}
 $('eventSelectionTitle').textContent=bundle.events.length>1?'어떤 내용을 그림일기로 만들고 싶으세요?':'이 이야기를 그림으로 남겨요';
 $('eventSelectionNote').textContent=bundle.selectedEventId?'선택한 이야기의 부족한 내용만 함께 확인할게요.':'한 가지를 고르면 그 이야기로만 그림을 만들어요.';
 if(!bundle.selectedEventId)$('previewScene').textContent='아래에서 그림으로 남길 이야기를 하나 골라주세요.';
}
function renderDialogue(container,conversation){container.replaceChildren();for(const turn of conversation?.turns||[]){const item=document.createElement('article');item.className='dialogue-turn';const label=document.createElement('small');label.textContent={today_story:'오늘 이야기',selected_event_details:'선택한 사건의 추가 확인',event_selection:'그림으로 남길 사건 선택',future_plans:'앞으로의 일정 · 오늘 경험과 분리',importance:'선택한 경험의 중요도'}[turn.phase]||'대화 기록';const question=document.createElement('p');question.className='dialogue-question';question.textContent=`기억잇다: ${turn.question}`;const answer=document.createElement('p');answer.textContent=`나: ${turn.answer||'(이 질문은 건너뛰었어요)'}`;item.append(label,question,answer);container.append(item);}}
function putSelectedCandidate(candidate){
 const bundle=state.experienceBundle;if(!bundle||candidate.id!==bundle.selectedEventId)throw new Error('선택한 이야기가 바뀌었어요. 다시 확인해 주세요.');
 bundle.events=bundle.events.map(event=>event.id===candidate.id?candidate:event);state.sceneCandidate=candidate;state.sceneRecord=null;
}
function paintScenePreparation(){
 const candidate=prepareExperience(state.sceneCandidate||selectedExperience());putSelectedCandidate(candidate);renderDialogue($('reviewDialogue'),conversationTranscript(state));
 $('scenePreparation').hidden=false;state.scenePreparationOpen=true;
 $('selectedSceneLabel').textContent=`선택한 이야기: ${candidate.title}`;
 const next=collectionQuestion(candidate);$('sceneCollectionPanel').hidden=!next;$('sceneConfirmationPanel').hidden=!!next;$('confirmSceneDraw').hidden=!!next;
 if(next){$('sceneQuestion').textContent=next.question;$('sceneAnswer').value=state.sceneAnswer||'';state.collectionField=next.field;sceneForm=null;}
 else{
  candidate.diaryNarrative=state.dayNarrative||state.experienceBundle.diaryNarrative||state.draft.body;candidate.supportingContext=state.experienceBundle.events.filter(e=>e.id!==candidate.id).map(e=>e.scene.slice(0,400));candidate.supportingContextStatus=candidate.supportingContext.length?'provided':'none';candidate.unusedEventIds=state.experienceBundle.events.filter(e=>e.id!==candidate.id).map(e=>e.id);
  candidate.scene=composeExperienceScene(candidate);putSelectedCandidate(candidate);state.draft.scene=candidate.scene;state.draft.title=candidate.title;state.draft.body=selectedDiaryText(candidate);$('previewTitle').textContent=state.draft.title;$('previewBody').textContent=state.draft.body;
  $('previewScene').textContent=candidate.scene;$('sceneSummary').textContent=`${candidate.place.name||'장소 미확인'} · ${candidate.people.map(p=>p.name).join(', ')} · ${candidate.activity||'활동 미확인'}\n${candidate.scene}\n모르거나 건너뛴 내용은 그대로 남기고 그림에 새 사실로 추가하지 않아요.`;
  $('sceneConfirmed').checked=false;
  sceneForm=mountSceneForm($('sceneFields'),candidate,raw=>{putSelectedCandidate(raw);state.image='';state.imageScene='';$('sceneConfirmed').checked=false;scheduleSave();});
 }
}
async function draw(){
 if(!state.draft.title.trim()||!state.draft.body.trim()){notify('이야기 내용을 먼저 확인해 주세요.',true);return;}
 if(currentImage(state)){paintResult();view('result');return;}
 if(state.experienceBundle&&!state.experienceBundle.selectedEventId){notify('그림으로 남길 이야기를 하나 골라주세요.');$('eventSelectionTitle').focus();return;}
 await task(async()=>{
  if(!state.experienceBundle){const response=await api('scene-draft',{draft:state.draft,session:sessionInput(state.turns)});const candidates=response.candidates||(response.candidate?[response.candidate]:[]);state.experienceBundle=createExperienceBundle(candidates,state.draft.body);renderExperienceChoices();if(!state.experienceBundle.selectedEventId)return;}
  state.sceneCandidate=selectedExperience();paintScenePreparation();$('scenePreparationTitle').focus();await persist();
 },'그림으로 남길 이야기를 함께 확인해요…');
}
$('draw').onclick=draw;$('readEventSelection').onclick=()=>read($('eventSelectionTitle').textContent);
$('closeScenePreparation').onclick=()=>{$('scenePreparation').hidden=true;state.scenePreparationOpen=false;scheduleSave();};
$('sceneAnswer').oninput=()=>{state.sceneAnswer=$('sceneAnswer').value;scheduleSave();};
function submitSceneAnswer(override){
 if(busy)return;const candidate=structuredClone(state.sceneCandidate),next=collectionQuestion(candidate),answer=typeof override==='string'?override:$('sceneAnswer').value.trim();if(!next)return;
 if(!answer){notify('짧게 말씀해 주시거나 기억나지 않음을 선택해 주세요.');return;}
 task(async()=>{const response=await api('scene-answer',{candidate,field:next.field,answer});putSelectedCandidate(response.candidate);state.sceneAnswer='';paintScenePreparation();await persist();},'말씀하신 내용을 남기고 있어요…');
}
$('sceneReply').onclick=()=>submitSceneAnswer();$('sceneUnknown').onclick=()=>submitSceneAnswer('잘 모르겠어요.');$('sceneDecline').onclick=()=>submitSceneAnswer('이 질문은 건너뛸게요.');$('readSceneQuestion').onclick=()=>read($('sceneQuestion').textContent);
$('confirmSceneDraw').onclick=()=>task(async()=>{if(!sceneForm||!$('sceneConfirmed').checked)throw new Error('선택한 장면의 내용이 맞는지 확인해 주세요.');const record=sceneForm.confirm(true);chooseExperience(state.experienceBundle,record.id);state.sceneRecord=record;state.sceneCandidate=record;putSelectedCandidate(record);state.sceneRecord=record;state.draft.scene=record.scene;state.draft.title=record.title;try{const text=await api('scene-text',record);state.draft.body=text.body;}catch{state.draft.body=selectedDiaryText(record);}const response=await api('scene-illustration',record);state.image=response.image;state.imageScene=record.scene;state.imageEventId=record.id;state.imageGeneration=response.generation;state.scenePreparationOpen=false;paintResult();view('result');await persist();},'확인한 내용으로 그림을 그리고 있어요…',{drawing:true});
$('verifyImage').onclick=async()=>{
 if(!state?.draft||!currentImage(state)){notify('먼저 그림을 준비해 주세요.');return;}
 await persist();
 try{sessionStorage.setItem('memory-verification-handoff-v1',JSON.stringify({scene:state.draft.scene,image:currentImage(state),record:state.sceneRecord||null,generation:state.imageGeneration||null}));}
 catch{notify('그림이 커서 검증 화면으로 옮기지 못했어요. 그림을 파일로 보관한 뒤 체험 화면에서 직접 고를 수 있어요.',true);return;}
 location.href=STANDALONE?'verification-demo.html#custom':'/verification#custom';
};
function paintResult(){paintImportance();$('resultDate').textContent=readableDate(state.date);$('resultHeading').textContent=state.draft.title;$('resultBody').textContent=state.draft.body;$('illustration').src=currentImage(state);}
function paintImportance(){
 const bundle=state.experienceBundle;$('experienceRating').hidden=!bundle?.selectedEventId;if(!bundle?.selectedEventId)return;
 $('ratingStars').replaceChildren();const rating=bundle.importance;
 for(let value=1;value<=5;value++){const button=document.createElement('button');button.type='button';button.textContent='★';button.dataset.rating=String(value);button.setAttribute('aria-label',`${value}점`);button.setAttribute('aria-pressed',String(rating.status==='provided'&&rating.value===value));button.className=rating.status==='provided'&&value<=rating.value?'selected':'';button.onclick=()=>{setImportance(value);};$('ratingStars').append(button);}
 $('ratingStatus').textContent=rating.status==='provided'?`이 경험의 중요도를 ${rating.value}점으로 남겼어요.`:rating.status==='skipped'?'별점은 미평가로 남겨둘게요.':'별점을 골라주세요. 나중에 매겨도 괜찮아요.';
}
function setImportance(value){const bundle=state.experienceBundle,event=selectedExperience();if(!event)return;const status=value===null?'skipped':'provided';bundle.importance={eventId:event.id,value,status,answeredAt:new Date().toISOString()};event.importanceRating=value;event.importanceStatus=status;paintImportance();scheduleSave();}
$('skipRating').onclick=()=>setImportance(null);
$('resultEdit').onclick=()=>{paintReview();view('review');$('editToggle').click();};
$('redraw').onclick=async()=>{if(await ask('그림을 다시 그릴까요?','같은 이야기로 새로운 그림을 만들어요. 추가 API 비용이 발생해요.','다시 그리기')){const old=state.image;const oldScene=state.imageScene;await task(async()=>{const response=state.sceneRecord?await api('scene-illustration',state.sceneRecord):await api('illustration',state.draft);state.image=response.image;state.imageScene=state.draft.scene.trim();if(response.generation)state.imageGeneration=response.generation;if(state.sceneRecord)state.imageEventId=state.sceneRecord.id;paintResult();await persist();},'새로운 그림을 그리고 있어요…',{drawing:true});if(!state.image){state.image=old;state.imageScene=oldScene;}}};
$('backToTalk').onclick=backToToday;
async function saveEntry(textOnly=false){
 if(!textOnly&&state.experienceBundle?.importance.status==='not_asked'){notify('이 경험의 별점을 고르거나 나중에 매기기를 선택해 주세요.');$('experienceRating').scrollIntoView({block:'center'});return;}
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
 const body=document.createElement('p');body.className='diary-body';body.textContent=entry.body;$('detailCard').append(body);
 if(entry.conversation?.turns?.length){const details=document.createElement('details');details.className='disclosure';const summary=document.createElement('summary');summary.textContent='어떤 이야기를 나눴는지 보기';const content=document.createElement('div');renderDialogue(content,entry.conversation);details.append(summary,content);$('detailCard').append(details);}
 if(entry.experiences){const details=document.createElement('details');details.className='disclosure';const summary=document.createElement('summary');summary.textContent='그림으로 고른 이야기와 함께 보관한 이야기';details.append(summary);for(const event of entry.experiences.events){const p=document.createElement('p');p.textContent=`${event.id===entry.experiences.selectedEventId?'그림으로 남김':'함께 보관'} · ${event.title}: ${event.scene}`;details.append(p);}$('detailCard').append(details);}
 if(entry.generation?.usedInformation){const details=document.createElement('details');details.className='disclosure';const summary=document.createElement('summary');summary.textContent='그림에 실제로 사용한 정보 보기';const content=document.createElement('p');content.textContent=entry.generation.usedInformation.facts.map(f=>f.text).join('\n');details.append(summary,content);$('detailCard').append(details);}
 view('detail');}
$('historyButton').onclick=showHistory;$('doneHistory').onclick=showHistory;$('detailBack').onclick=showHistory;$('historyReturn').onclick=()=>{notify('');view(state?.stage||'home');};
$('readSaved').onclick=()=>read(`${selectedEntry.title}. ${selectedEntry.body}`);$('exportSaved').onclick=()=>download(selectedEntry);
$('deleteSaved').onclick=async()=>{if(!await ask('이 일기를 지울까요?','삭제한 일기는 다시 복구하기 어려워요. 보관하려면 먼저 파일로 내려받아 주세요.','일기 삭제하기'))return;await task(async()=>{await removeEntry(selectedEntry.id);selectedEntry=null;},'일기를 정리하고 있어요…');if(!selectedEntry)showHistory();};
$('clearDraft').onclick=async()=>{if(!state&&!savedDraft){notify('작성 중인 이야기가 없어요.');return;}if(await ask('쓰던 이야기를 지울까요?','저장한 일기는 남아 있어요. 작성 중인 사진과 대화만 지워져요.','쓰던 이야기 지우기'))await task(async()=>{await clearWorking();view('home');},'쓰던 이야기를 정리하고 있어요…');};
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
$('sceneMicrophone').hidden=!SpeechRecognition;
$('sceneMicrophone').onclick=()=>{
 if(!SpeechRecognition)return;if(recording){stopVoice();return;}stopVoice();recognition=new SpeechRecognition();recognition.lang='ko-KR';recognition.continuous=false;recognition.interimResults=false;const before=$('sceneAnswer').value;
 recognition.onstart=()=>{recording=true;$('sceneMicrophone').textContent='말하기 끝내기';};
 recognition.onresult=event=>{if(busy||active!=='review'||$('sceneCollectionPanel').hidden)return;state.sceneAnswer=(before+(before?' ':'')+event.results[0][0].transcript).slice(0,1000);$('sceneAnswer').value=state.sceneAnswer;scheduleSave();};
 recognition.onend=()=>{recording=false;$('sceneMicrophone').textContent='마이크로 말하기';};recognition.onerror=()=>notify('음성 입력이 어려워요. 글로 입력하거나 휴대폰 키보드의 음성 입력을 사용할 수 있어요.');recognition.start();
};
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
initialize();refreshHomeSchedule();
window.addEventListener('pagehide',()=>persist());

function eventOrder(a,b){return Number(a.completed===true)-Number(b.completed===true)||(a.time||'99:99').localeCompare(b.time||'99:99')||a.title.localeCompare(b.title);}
async function refreshHomeSchedule(){
 try{const date=localDate(),events=(await listEvents()).filter(e=>e.date===date).sort(eventOrder);
 $('homeSchedule').hidden=!events.length;
 $('homeSchedule').querySelector('strong').textContent=`${date===localDate()?'오늘':readableDate(date)}의 일정`;
 $('homeScheduleText').textContent=events.length?events.map(e=>`${e.completed?'✓ 완료 · ':''}${e.time||'시간 미정'} · ${e.title}`).join('\n'):'아직 적어둔 일정이 없어요. 일정이 없어도 편하게 이야기할 수 있어요.';
 }catch{$('homeScheduleText').textContent='이 브라우저에서 캘린더를 읽지 못했어요.';}
}

async function finishToday(turns){
 if(!experienceTurns(turns).some(t=>t.answer.trim()))throw new Error('오늘 실제로 하신 이야기를 한 가지만 들려주세요. 앞으로의 일정은 다음 단계에서 따로 챙길게요.');
 state.turns=turns;state.answer='';
 if(state.plansReviewed){await makeDraft(turns);return;}
 if(!state.tomorrowText)state.tomorrowText=futurePlanText(turns);
 paintTomorrow();view('tomorrow');await persist();
}
function paintTomorrow(){
 $('tomorrowDate').textContent=`기록 날짜는 ${readableDate(state.date)}이에요. 내일·모레 또는 원하는 날짜의 할 일을 적어주세요.`;
 $('tomorrowAnswer').value=state.tomorrowText||'';
 $('planNotice').hidden=!state.planNotice;$('planNotice').textContent=state.planNotice||'';$('planDiagnostics').hidden=!state.planDiagnostic;$('planDiagnosticText').textContent=state.planDiagnostic||'';
 const saved=state.plansSaved,review=Boolean(state.planCandidates?.length)&&!saved;
 $('planSavedNote').hidden=!saved;$('planInputPanel').hidden=saved||review;
 $('tomorrowTitle').textContent=saved?'다가오는 일정을 챙겼어요':review?'이 일정들, 이렇게 적을까요?':'앞으로 하실 일이 있으세요?';$('planReviewPanel').hidden=!review;
 $('skipPlans').textContent=saved?'오늘 일기 만들기':'일정 등록 없이 일기 만들기';
 $('confirmPlans').hidden=false;$('existingPlans').hidden=true;
 $('planCards').replaceChildren();
 for(const [i,event] of (state.planCandidates||[]).entries()){
  const card=document.createElement('fieldset');card.className='plan-card';const legend=document.createElement('legend');legend.textContent=`${i+1}번째 일정`;card.append(legend);
  if(!event.date){const dateNote=document.createElement('p');dateNote.className='inline-note';dateNote.textContent='날짜를 정확히 정하지 못했어요. 아래에서 날짜를 골라주세요.';card.append(dateNote);}
  if(event.inferredFromContext){const note=document.createElement('p');note.className='helper';note.textContent='앞서 나눈 이야기에서 장소를 연결했어요. 이 장소가 맞는지 확인해 주세요.';card.append(note);}
  for(const [key,label,type,max] of [['title','할 일','text',100],['date','날짜','date'],['time','시간 (모르면 비워두세요)','time'],['location','장소 (선택)','text',200]]){
   const id=`plan-${i}-${key}`,name=document.createElement('label'),input=document.createElement('input');name.htmlFor=id;name.textContent=label;input.id=id;input.type=type;input.value=event[key];if(max)input.maxLength=max;if(key==='date'){input.min=nextDate(state.date);}input.oninput=()=>{event[key]=input.value;if(key==='time')delete event.pendingTime;if(key==='time'||key==='date')renderPendingTimeChoices();scheduleSave();};card.append(name,input);
  }
  if(event.scheduleNote){const name=document.createElement('label'),note=document.createElement('textarea');name.htmlFor=`plan-${i}-note`;name.textContent='확인 메모 (고칠 수 있어요)';note.id=name.htmlFor;note.rows=3;note.maxLength=300;note.value=event.scheduleNote;note.oninput=()=>{event.scheduleNote=note.value;scheduleSave();};card.append(name,note);}
  const remove=document.createElement('button');remove.className='text-button danger';remove.textContent='이 일정은 빼기';remove.onclick=()=>{state.planCandidates.splice(i,1);paintTomorrow();scheduleSave();};card.append(remove);$('planCards').append(card);
 }
 renderPendingTimeChoices();
}
$('tomorrowAnswer').oninput=()=>{state.tomorrowText=$('tomorrowAnswer').value;state.planCandidates=[];$('planReviewPanel').hidden=true;scheduleSave();};
$('extractPlans').onclick=()=>task(async()=>{
 const result=await api('plans',{date:state.date,text:state.tomorrowText,turns:state.turns,todayEvents:state.todayEvents||[]});
 state.planCandidates=result.events.map(e=>({...planCandidate(e),inferredFromContext:e.inferredFromContext===true,id:crypto.randomUUID()}));state.planNotice=result.notice||'';state.planDiagnostic=result.diagnostic||'';
 paintTomorrow();await persist();
 if(!result.events.length){$('planReviewPanel').hidden=false;$('confirmPlans').hidden=true;$('existingPlans').hidden=false;$('existingPlans').textContent='일정 후보를 찾지 못했어요. 다시 적거나, 직접 일정 적기 또는 일정 등록 없이 일기 만들기를 선택해 주세요.';}
 else{ $('confirmPlans').hidden=false;const dates=new Set(state.planCandidates.map(e=>e.date));const existing=(await listEvents()).filter(e=>dates.has(e.date));$('existingPlans').hidden=!existing.length;$('existingPlans').textContent=existing.length?`이미 등록된 일정: ${existing.map(e=>`${readableDate(e.date)} ${e.time||'시간 미정'} ${e.title}`).join(', ')}. 같은 일정인지 확인해 주세요.`:'';}
 $('planReviewHeading').focus();
},'앞으로 할 일을 날짜별로 정리하고 있어요…');
$('manualPlan').onclick=()=>{if(state.plansSaved)return;if(state.planCandidates.length>=5){notify('일정은 한 번에 다섯 개까지 확인할 수 있어요. 나누어 등록해 주세요.',true);return;}state.planCandidates.push({id:crypto.randomUUID(),title:'',date:nextDate(state.date),time:'',location:''});paintTomorrow();$('confirmPlans').hidden=false;$('existingPlans').hidden=true;$(`plan-${state.planCandidates.length-1}-title`).focus();scheduleSave();};
$('revisePlans').onclick=()=>{state.planCandidates=[];paintTomorrow();$('tomorrowAnswer').focus();scheduleSave();};
$('confirmPlans').onclick=()=>task(async()=>{
 if(!state.planCandidates.length)throw new Error('확인할 일정이 없어요. 일정 없이 일기를 만들 수도 있어요.');
 if(state.planCandidates.some(e=>e.pendingTime))throw new Error('말씀하신 시간이 오전인지 오후인지 확인해 주세요. 아직 모르면 ‘시간은 아직 모르겠어요’를 선택할 수 있어요.');
 const events=state.planCandidates.map(e=>({...calendarEvent(e),id:e.id,source:'conversation',savedAt:new Date().toISOString()}));
 if(events.some(e=>e.date<=state.date))throw new Error('각 일정의 날짜를 기록 날짜 다음 날 이후로 확인해 주세요.');
 await putEvents(events);state.plansReviewed=true;state.plansSaved=true;paintTomorrow();await persist();await makeDraft(state.turns);
},'확인한 일정을 저장하고 오늘 일기를 만들고 있어요…');
$('skipPlans').onclick=()=>task(async()=>{state.plansReviewed=true;await persist();await makeDraft(state.turns);},'오늘 이야기를 일기로 정리하고 있어요…');
function backToToday(){const last=state.turns.pop();if(last){state.question=last.question;state.answer=last.answer;}paintConversation();notify('');view('conversation');persist();}
$('tomorrowBack').onclick=backToToday;
async function showCalendar(){
 const from=active;if(from!=='calendar')calendarReturn=from;
 await task(async()=>{if(state)await persist();$('calendarDate').value=localDate();$('eventForm').hidden=true;$('calendarOverview').hidden=false;await renderCalendar();view('calendar');},'캘린더를 펼치고 있어요…');
}
async function renderCalendar(){
 const date=$('calendarDate').value;if(!validDate(date))throw new Error('날짜를 선택해 주세요.');
 const all=await listEvents(),events=all.filter(e=>e.date===date).sort(eventOrder);
 paintMonth(date,all);$('calendarSelectedDate').textContent=`${date===localDate()?'오늘 · ':''}${readableDate(date)}`;$('calendarCount').textContent=events.length?`일정 ${events.length}개${events.some(e=>e.completed)?' · 완료 '+events.filter(e=>e.completed).length+'개':''}`:'';
 $('calendarEvents').replaceChildren();
 if(!events.length){const p=document.createElement('p');p.className='empty-state';p.textContent='아직 적어둔 일정이 없어요. 아래에서 새 일정을 적을 수 있어요.';$('calendarEvents').append(p);}
 for(const event of events){
  const card=document.createElement('article');card.className=event.completed?'event-card completed':'event-card';const h=document.createElement('h2');h.textContent=event.title;const p=document.createElement('p');p.textContent=`${event.time||'시간 미정'}${event.location?' · '+event.location:''}`;
  const completion=document.createElement('label');completion.className='event-completion';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id=`complete-${event.id}`;checkbox.checked=event.completed===true;checkbox.setAttribute('aria-label',`${event.title} 완료 표시`);
  const status=document.createElement('span');status.textContent=event.completed?'완료했어요':'완료로 표시';completion.append(checkbox,status);
  checkbox.onchange=async()=>{const completed=checkbox.checked;let updated=false;await task(async()=>{await updateEvent(event.id,{completed,completedAt:completed?new Date().toISOString():null},{requireExisting:true});updated=true;await renderCalendar();await refreshHomeSchedule();},completed?'완료로 표시하고 있어요…':'완료 표시를 해제하고 있어요…');if(!updated&&checkbox.isConnected)checkbox.checked=event.completed===true;document.getElementById(`complete-${event.id}`)?.focus({preventScroll:true});};
  const manage=document.createElement('details');manage.className='event-manage';const summary=document.createElement('summary');summary.textContent='고치기 · 삭제';manage.append(summary);
  const actions=document.createElement('div');actions.className='actions';const edit=document.createElement('button');edit.className='secondary';edit.textContent='일정 고치기';edit.onclick=()=>editEvent(event);
  const remove=document.createElement('button');remove.className='text-button danger';remove.textContent='일정 삭제';remove.onclick=async()=>{if(!await ask('이 일정을 지울까요?',`${event.title} 일정을 캘린더에서 삭제해요.`,'일정 삭제'))return;await task(async()=>{await removeEvent(event.id);await renderCalendar();await refreshHomeSchedule();},'일정을 정리하고 있어요…');};
  actions.append(edit,remove);manage.append(actions);card.append(h,p);if(event.scheduleNote){const note=document.createElement('p');note.className='helper';note.textContent=event.scheduleNote;card.append(note);}card.append(completion,manage);$('calendarEvents').append(card);
 }
}
function editEvent(event=null){
 editingEventId=event?.id||crypto.randomUUID();editingExisting=Boolean(event);$('calendarOverview').hidden=true;$('eventForm').hidden=false;$('eventFormHeading').textContent=event?'일정 고치기':'일정 적기';
 for(const [id,key] of [['eventTitle','title'],['eventDate','date'],['eventTime','time'],['eventLocation','location']])$(id).value=event?.[key]||(key==='date'?$('calendarDate').value:'');
 $('eventNote').value=event?.scheduleNote||'';$('eventNoteFields').hidden=!event?.scheduleNote;
 $('eventTitle').focus();
}
$('calendarButton').onclick=showCalendar;
$('calendarDate').onchange=()=>selectCalendarDate($('calendarDate').value);
for(const [id,days] of [['calendarPrev',-1],['calendarNext',1],['calendarToday',0]])$(id).onclick=()=>task(async()=>{$('calendarDate').value=days?shiftMonth($('calendarDate').value,days):localDate();$('eventForm').hidden=true;$('calendarOverview').hidden=false;await renderCalendar();},'일정을 살펴보고 있어요…');
$('addCalendarEvent').onclick=()=>editEvent();$('cancelEvent').onclick=()=>{$('eventForm').hidden=true;$('calendarOverview').hidden=false;$('addCalendarEvent').focus();};
$('eventForm').onsubmit=event=>{event.preventDefault();task(async()=>{
 const data=calendarEvent({title:$('eventTitle').value,date:$('eventDate').value,time:$('eventTime').value,location:$('eventLocation').value,scheduleNote:$('eventNote').value});
 await updateEvent(editingEventId,{...data,source:'manual',savedAt:new Date().toISOString()},{requireExisting:editingExisting});$('calendarDate').value=data.date;$('eventForm').hidden=true;$('calendarOverview').hidden=false;await renderCalendar();await refreshHomeSchedule();
},'일정을 저장하고 있어요…');};
$('calendarReturn').onclick=()=>{notify('');view(calendarReturn);};

function resetHomeDate(){
 const today=localDate();$('date').value=today;$('homeDate').dataset.date=today;$('todayLabel').textContent=readableDate(today);$('homeDate').textContent=`${readableDate(today)} · 오늘의 일기`;$('otherDateOptions').open=false;
}
function paintMonth(selected,events){
 const [year,month]=selected.split('-');$('calendarMonth').textContent=`${year}년 ${Number(month)}월`;
 const byDate=new Map();for(const event of [...events].sort(eventOrder)){if(!byDate.has(event.date))byDate.set(event.date,[]);byDate.get(event.date).push(event);}
 const days=monthDays(selected);$('calendarGrid').replaceChildren();
 for(let week=0;week<days.length;week+=7){
  const row=document.createElement('tr');
  for(const date of days.slice(week,week+7)){
   const cell=document.createElement('td');if(!date){cell.className='empty-day';row.append(cell);continue;}
   const items=byDate.get(date)||[],today=date===localDate(),button=document.createElement('button');button.className='calendar-day';button.dataset.date=date;button.tabIndex=date===selected?0:-1;
   button.setAttribute('aria-pressed',String(date===selected));if(today)button.setAttribute('aria-current','date');
   button.setAttribute('aria-label',`${readableDate(date)}${today?' 오늘':''}, ${items.length?`일정 ${items.length}개, 완료 ${items.filter(e=>e.completed).length}개: ${items.map(e=>`${readableDate(e.date)} ${e.time||'시간 미정'} ${e.title}`).join(', ')}`:'일정 없음'}`);
   const number=document.createElement('span');number.className='day-number';number.textContent=String(Number(date.slice(-2)));button.append(number);
   if(today){const mark=document.createElement('span');mark.className='today-mark';mark.textContent='오늘';button.append(mark);}
   if(items.length){const count=document.createElement('span');count.className='day-count';count.textContent=items.every(e=>e.completed)?'✓ 완료':`● ${items.filter(e=>!e.completed).length}개`;const preview=document.createElement('span');preview.className='day-preview';preview.textContent=items[0].title;button.append(count,preview);}
   button.onclick=()=>selectCalendarDate(date);button.onkeydown=event=>{
    const step={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];let target;
    if(step!==undefined)target=nextDate(date,step);
    else if(event.key==='Home')target=nextDate(date,-new Date(`${date}T12:00:00`).getDay());
    else if(event.key==='End')target=nextDate(date,6-new Date(`${date}T12:00:00`).getDay());
    else if(event.key==='PageUp'||event.key==='PageDown')target=shiftMonth(date,event.key==='PageUp'?-1:1);
    if(target){event.preventDefault();selectCalendarDate(target,{focus:true});}
   };
   cell.append(button);row.append(cell);
  }
  $('calendarGrid').append(row);
 }
}
async function selectCalendarDate(date,{focus=false}={}){
 if(busy)return;
 await task(async()=>{if(!validDate(date))throw new Error('날짜를 확인해 주세요.');$('calendarDate').value=date;await renderCalendar();},'이 날의 일정을 살펴보고 있어요…');
 if(focus)document.querySelector(`.calendar-day[data-date="${date}"]`)?.focus();
}
function refreshToday(){if(active==='home'&&$('homeDate').dataset.date!==localDate()){resetHomeDate();refreshHomeSchedule();}else $('todayLabel').textContent=readableDate(localDate());}
window.addEventListener('focus',refreshToday);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshToday();});

document.addEventListener('click',event=>{if(!event.composedPath().includes($('settingsMenu')))$('settingsMenu').open=false;});
$('settingsMenu').addEventListener('keydown',event=>{if(event.key==='Escape'){$('settingsMenu').open=false;$('settingsMenu').querySelector('summary').focus();}});

$('resetAllData').onclick=async()=>{
 if(busy||!await ask('모든 기록을 초기화할까요?','저장한 일기, 작성 중인 사진과 대화, 캘린더 일정과 글씨 설정이 모두 지워져요. 되돌릴 수 없으니 필요한 일기는 먼저 파일로 보관해 주세요. 다른 기억잇다 창은 닫고 진행해 주세요. 서버의 .env와 API 키는 지워지지 않아요.','모든 기록 지우기'))return;
 let reset=false;
 await task(async()=>{
  clearTimeout(saveTimer);generation++;await saveQueue.catch(()=>{});await resetAppData();state=null;savedDraft=null;selectedEntry=null;saveQueue=Promise.resolve();$('autosaveStatus').textContent='';
  document.documentElement.classList.remove('large-type');$('fontButton').setAttribute('aria-pressed','false');$('fontButton').innerHTML='가<span class="font-label"> 글씨 크게</span>';
  for(const id of ['diaries','calendarEvents','detailCard','transcript','photoGrid','conversationPhotos','planCards','pendingTimeChoices'])$(id).replaceChildren();
  for(const id of ['answer','tomorrowAnswer','title','body','scene','photoFiles'])$(id).value='';
  for(const id of ['previewTitle','previewBody','previewScene','resultHeading','resultBody','question','planNotice','planDiagnosticText'])$(id).textContent='';
  $('illustration').removeAttribute('src');$('eventForm').reset();$('eventForm').hidden=true;view('home');await refreshHomeSchedule();reset=true;
 },'이 기기의 기록을 초기화하고 있어요…');
 if(reset)notify('기록을 모두 지웠어요. 오늘의 새 이야기를 시작할 수 있어요.');
};

function renderPendingTimeChoices(){
 const groups=new Map();for(const [index,event] of (state?.planCandidates||[]).entries())if(event.pendingTime){const key=event.pendingTime.group;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({index,event});}
 $('pendingTimeChoices').replaceChildren();$('pendingTimeChoices').hidden=!groups.size;
 for(const items of groups.values()){
  const {hour,minute}=items[0].event.pendingTime,label=`${hour}시${minute?' '+minute+'분':''}`;
  const box=document.createElement('fieldset');box.className='shared-time-confirmation';const legend=document.createElement('legend');legend.textContent=`${items.length>1?items.length+'개 일정의 ':''}‘${label}’는 오전인가요, 오후인가요?`;
  const dates=document.createElement('p');dates.className='helper';dates.textContent=items.map(({event})=>event.date?readableDate(event.date):'날짜 확인 중').join(' · ');
  const actions=document.createElement('div');actions.className='actions';
  for(const [period,text] of [['am','오전 '+label],['pm','오후 '+label],['unknown','시간은 아직 모르겠어요']]){
   const button=document.createElement('button');button.className=period==='unknown'?'text-button':'secondary';button.textContent=text;button.dataset.period=period;
   button.onclick=()=>{const time=period==='unknown'?'':`${String(hour%12+(period==='pm'?12:0)).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
    for(const {index,event} of items){event.time=time;delete event.pendingTime;const input=$(`plan-${index}-time`);if(input)input.value=time;}
    renderPendingTimeChoices();scheduleSave();notify(period==='unknown'?'시간 미정으로 두었어요. 나중에 달력에서 고칠 수 있어요.':`${items.length}개 일정의 시간을 ${text}로 설정했어요.`);$(`plan-${items[0].index}-time`)?.focus({preventScroll:true});
   };actions.append(button);
  }
  box.append(legend,dates,actions);$('pendingTimeChoices').append(box);
 }
}
