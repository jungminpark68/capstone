import {validDate,calendarEvent,planCandidate} from './calendar.js';
import {validateSceneRecord,matchingMetadata} from './diary-record.js';
import {experienceMatching} from './experience-flow.js';
import {savedDiaryCheck} from './diary-verification.js';
export function localDate(date=new Date()){
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function readableDate(value){const date=new Date(`${value}T12:00:00`);return Number.isNaN(date.getTime())?value:date.toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'short'});}
export function newSession(date=localDate()){
 return {version:1,date,stage:'conversation',photos:[],turns:[],question:'',answer:'',todayEvents:[],tomorrowText:'',planCandidates:[],planNotice:'',planDiagnostic:'',plansReviewed:false,plansSaved:false,draft:null,image:'',imageScene:'',updatedAt:new Date().toISOString()};
}
export function currentImage(state){return typeof state?.image==='string'&&/^data:image\/jpeg;base64,/.test(state.image)&&state.draft?.scene?.trim()===state.imageScene&&(!state.imageEventId||state.imageEventId===state.experienceBundle?.selectedEventId)?state.image:'';}
export function conversationTranscript(state){
 const bundle=state.experienceBundle;
 const turns=(state.turns||[]).map((turn,index)=>({id:`story-turn-${index+1}`,phase:'today_story',eventIds:bundle?.events.filter(event=>(event.sourceEvidence?.quotes||[]).some(quote=>turn.answer.includes(quote))).map(event=>event.id)||[],question:turn.question,answer:turn.answer,status:turn.answer.trim()?'answered':'skipped',answeredAt:turn.answeredAt||null}));
 if(state.tomorrowText?.trim())turns.push({id:'future-plans',phase:'future_plans',eventIds:[],question:'앞으로 하실 일이 있으세요?',answer:state.tomorrowText,status:'answered',answeredAt:null});
 for(const [index,selection] of (bundle?.selections||[]).entries()){
  if(selection.source==='explicit_conversation_preference'){
   const original=turns.find(turn=>turn.question===selection.question&&turn.answer.includes(selection.answer));
   if(original)original.diarySelection={eventId:selection.eventId,source:selection.source};
   continue; // This was already spoken, not an additional selection question.
  }
  turns.push({id:`event-selection-${index+1}`,phase:'event_selection',eventIds:[selection.eventId],question:selection.question,answer:selection.answer,status:'answered',answeredAt:selection.answeredAt||null});
 }
 for(const event of bundle?.events||[])for(const [index,answer] of (event.sourceEvidence?.answers||[]).entries())turns.push({id:`${event.id}-detail-${index+1}`,phase:'selected_event_details',eventIds:[event.id],field:answer.field,question:answer.question||'선택한 사건의 추가 정보 확인',answer:answer.quote,status:answer.status,answeredAt:answer.answeredAt||null});
 if(bundle?.importance?.status&&bundle.importance.status!=='not_asked')turns.push({id:'experience-importance',phase:'importance',eventIds:[bundle.importance.eventId],question:'이 경험은 얼마나 소중한가요?',answer:bundle.importance.status==='provided'?`${bundle.importance.value}점`:'별점은 나중에 매길게요.',status:bundle.importance.status,answeredAt:bundle.importance.answeredAt||null});
 return {schemaVersion:1,turns,futurePlans:state.tomorrowText?.trim()?{phase:'future_plans',question:'앞으로 하실 일이 있으세요?',answer:state.tomorrowText}:null,importance:bundle?.importance||null,note:'질문은 발언 근거가 아니다. 실제 경험·추가 확인·미래 계획·중요도 응답을 구분해 보관한다.'};
}
export function makeEntry(state,id){
 if(!state?.draft?.title?.trim()||!state.draft.body?.trim())throw new Error('일기의 제목과 내용을 확인해 주세요.');
 const image=currentImage(state);
 const entry={id,date:state.date,title:state.draft.title.trim(),body:state.draft.body.trim(),scene:state.draft.scene?.trim()||'',image,imageKind:image?'ai':null,savedAt:new Date().toISOString()};
 if(state.sceneRecord){const importance=state.experienceBundle?.importance;entry.sceneRecord=validateSceneRecord({...state.sceneRecord,diaryNarrative:state.dayNarrative||state.experienceBundle?.diaryNarrative||state.draft.body,...(importance?.eventId===state.sceneRecord.id?{importanceRating:importance.value,importanceStatus:importance.status}:{})});entry.matching=matchingMetadata(entry.sceneRecord);}
 if(state.experienceBundle){entry.experiences=structuredClone(state.experienceBundle);entry.experiences.diaryNarrative=state.dayNarrative||state.experienceBundle.diaryNarrative||state.draft.body;if(entry.sceneRecord)entry.experiences.events=entry.experiences.events.map(event=>event.id===entry.sceneRecord.id?entry.sceneRecord:event);entry.matchingContext=experienceMatching(entry.experiences);}
 if(image&&state.imageGeneration)entry.generation=state.imageGeneration;
 if(image&&state.imageId){entry.imageId=state.imageId;const check=savedDiaryCheck(state);if(check)entry.verification=check;}
 entry.conversation=conversationTranscript(state);
 return entry;
}
export function restorable(value){
 return value?.version===1&&validDate(value.date)&&(!value.todayEvents||validEvents(value.todayEvents))&&(!value.planCandidates||validCandidates(value.planCandidates))&&(value.tomorrowText===undefined||typeof value.tomorrowText==='string'&&value.tomorrowText.length<=2000)&&typeof value.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.date)&&['photos','conversation','rest','tomorrow','review','result'].includes(value.stage)&&Array.isArray(value.turns)&&value.turns.length<=8&&value.turns.every(t=>typeof t?.answer==='string'&&typeof t?.question==='string')&&Array.isArray(value.photos)&&value.photos.every(p=>typeof p==='string'&&p.startsWith('data:image/jpeg;base64,'))&&typeof value.question==='string'&&typeof value.answer==='string'&&(!['review','result'].includes(value.stage)||value.draft&&typeof value.draft.title==='string'&&typeof value.draft.body==='string'&&typeof value.draft.scene==='string');
}

function validEvents(events){try{return Array.isArray(events)&&events.length<=20&&events.every(e=>Boolean(calendarEvent(e)));}catch{return false;}}

function validCandidates(events){try{return Array.isArray(events)&&events.length<=5&&events.every(e=>e&&typeof e.id==='string'&&['title','date','time','location'].every(key=>typeof e[key]==='string')&&e.title.length<=100&&Boolean(planCandidate({...e,title:e.title.trim()||'확인 필요'})));}catch{return false;}}
