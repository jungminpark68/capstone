// Events are kept separately; only the user's selected event becomes an image.
import {PLACE_TYPES} from './diary-record.js';
import {experienceTurns} from './calendar.js';

export const FLOW_STATUSES=['provided','none','unknown','declined','not_asked'];
export const EMOTION_LABELS={happy:'즐거움',calm:'편안함',sad:'슬픔',worried:'걱정',angry:'화남',tired:'피곤함',other:'다른 감정'};
const flowId=prefix=>`${prefix}-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const flowText=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const flowClone=value=>JSON.parse(JSON.stringify(value));
const flowSubject=name=>{const last=name.codePointAt(name.length-1);return name+(last>=44032&&last<=55203?(last-44032)%28?'은':'는':'은(는)');};
const flowPlaceTypes={공원:'park',집:'home',식당:'restaurant',레스토랑:'restaurant',카페:'restaurant',병원:'hospital',치과:'hospital',의원:'hospital',시장:'market',마트:'market',거리:'street',은행:'other',복지관:'other',도서관:'other'};
const flowKinPattern=/손녀|손자|며느리|사위|남편|아내|친구|딸|아들|의사\s*선생님/g;
const flowPlacePattern=/(?:[가-힣A-Za-z0-9·-]{0,14})?(?:공원|병원|치과|의원|시장|마트|식당|레스토랑|카페|은행|복지관|도서관|집)(?=에서|에(?:는|서|도|\s)|을|를|이요|이에요|$)/g;
function flowPlace(text){const name=[...text.matchAll(flowPlacePattern)][0]?.[0]||'';return {id:'',name,type:Object.entries(flowPlaceTypes).find(([suffix])=>name.endsWith(suffix))?.[1]||'unknown'};}
function flowTime(text){return /오전|아침/.test(text)?'morning':/오후|점심|낮/.test(text)?'afternoon':/저녁/.test(text)?'evening':/밤/.test(text)?'night':'unknown';}
function flowEmotion(text){const labels=[];for(const [key,pattern] of [['happy',/좋았|좋아|즐거|기뻤|기쁘|행복|뿌듯|고마|감사|재밌/],['calm',/편안|평온|차분/],['sad',/슬펐|슬프|우울|속상/],['worried',/걱정|불안|무거웠/],['angry',/화났|화가|짜증/],['tired',/피곤|힘들/]])if(pattern.test(text))labels.push(key);return labels;}
function flowRefusal(answer){
 if(/^(?:잘\s*)?(?:모르|기억(?:이|나지|은)?\s*(?:안|않)|생각(?:이)?\s*안)/.test(answer))return 'unknown';
 if(/넘어|건너|말하고\s*싶지|답하.*싫|그만|지금.*불편|이(?:야기|질문).*불편/.test(answer))return 'declined';
 if(/^아니요[.!。]?$/.test(answer)||answer.length<80&&/없어요|없었어요|없습니다|딱히.*없|특별.*없/.test(answer)&&!flowActivity(answer))return 'none';
 return null;
}
function flowActivity(text){
 for(const [pattern,name] of [[/자전거/,'자전거 타기'],[/산책/,'산책하기'],[/진료|검진|진찰/,'진료받기'],[/장(?:을|을\s*)?\s*봤|장보기/,'장보기'],[/밥|식사|먹었/,'식사하기']])if(pattern.test(text))return name;
 return '';
}

function flowEventScore(text,event){
 let score=0;
 if(event.place?.name&&text.includes(event.place.name))score+=5;
 const activity=flowActivity(text);if(activity&&activity===event.activity)score+=4;
 for(const person of event.people||[])if(person.name!=='나'&&text.includes(person.name))score+=2;
 return score;
}
function flowUniqueEvent(text,events){
 const ranked=events.map(event=>({event,score:flowEventScore(text,event)})).sort((a,b)=>b.score-a.score);
 return ranked[0]?.score>0&&ranked[0].score!==(ranked[1]?.score||0)?ranked[0].event:null;
}
export function preferredExperience(events,turns){
 for(const [index,turn] of [...turns.entries()].reverse()){
  const text=turn.answer||'';
  if(/그리지\s*마|남기지\s*마|다른\s*(?:이야기|사건|장면)(?:로|으로)\s*(?:바꿀|바꾸|할래)/.test(text))return null;
  if(!/남기고\s*싶|남길래|남겨\s*주|그려\s*주|그림일기로\s*(?:만들|할래)|(?:이야기|사건|장면)(?:을|를|으로|로)\s*선택/.test(text))continue;
  if(/남기고\s*싶지|남기기\s*싫|둘\s*다|모두/.test(text))return null;
  const event=flowUniqueEvent(text,events);return event?{eventId:event.id,question:turn.question,answer:text,turnIndex:index}:null;
 }
 return null;
}

export function experienceQuestionField(question,record){
 if(/그림일기로.*남기고\s*싶은|오늘.*어떤\s*일|다른.*(?:이야기|들려)/.test(question))return null;
 if(/기분|감정|어떤\s*마음|마음(?:이|은|는)?.*(?:어떠|어땠|어떤)|어떤\s*느낌|어떻게\s*느끼|어떻게\s*느꼈/.test(question))return 'emotion';
 if(/언제|시간대|아침.*오후|몇\s*시/.test(question))return 'time';
 if(/누구|함께한\s*분|혼자.*함께/.test(question))return 'people';
 if(/어디|어느\s*장소/.test(question))return 'place';
 if(/기억.*(?:순간|것이|일이)|특별.*순간/.test(question))return 'memoryCue';
 if(/물건|어떤\s*음식|사물/.test(question))return 'objects';
 if(/무엇|뭘|무슨\s*일|어떤\s*일/.test(question)){
  const person=record?.people.find(p=>p.name!=='나'&&question.includes(p.name));
  if(person)return `action:${person.id}`;
  if(/그때.*(?:하|하고)|무엇을\s*하고/.test(question))return 'action:person-self';
 }
 return null;
}

function flowPersonActions(text,people){
 const result=new Map();
 // A named subject is required: accompanying someone does not prove who rode.
 const subjects=[...text.matchAll(/(?:^|[\s.!?。])(?:(나|저)(?:는|가|도)|제가|나는|내가|저는|(손녀|손자|며느리|사위|남편|아내|친구|딸|아들|의사\s*선생님)(?:은|는|이|가|도))\s*/g)];
 for(const [index,subject] of subjects.entries()){
  const name=subject[2]||'나';if(!people.some(person=>person.name===name))continue;
  const action=text.slice(subject.index+subject[0].length,subjects[index+1]?.index??text.length).split(/[.!?。\n]/)[0].trim();
  if(!/탔|타고|타는|탄\s|타면서|걸었|걷|산책|앉|응원|손뼉|박수|먹었|먹고|마셨|마시|진료|검진|읽었|읽고|뛰|달렸|놀았|놀고|이야기했|대화했|요리|만들었|장보기/.test(action))continue;
  if(/않|못했|안\s*(?:탔|타|먹|갔|했)/.test(action))continue;
  result.set(name,flowText(action,200));
 }
 return result;
}

// The input here is a scoped user utterance, never an AI scene or question.
// Fill other explicit facts in the same answer as well as the requested field.
export function supplementExperience(value,answer,{question=''}={}){
 const r=prepareExperience(value),text=flowText(answer,2000),s=r.collectionStatus;
 const fillable=field=>s[field]==='not_asked';
 const names=[...new Set(text.match(flowKinPattern)||[])];
 for(const name of names)if(!r.people.some(person=>person.name===name)&&r.people.length<6&&!['none','unknown','declined'].includes(s.people)){
  const index=r.people.length,person={id:flowId('person'),alias:String.fromCharCode(65+index),name,action:'',visual:`${['파란색','노란색','초록색','보라색','주황색','분홍색'][index]} 상의 (그림 구별용 설정)`};
  r.people.push(person);s[`action:${person.id}`]='not_asked';
 }
 if(fillable('people')&&(/혼자/.test(text)&&!names.length||names.length))s.people='provided';
 const activity=flowActivity(text);if(fillable('activity')&&activity){r.activity=activity;s.activity='provided';}
 const place=flowPlace(text);if(fillable('place')&&place.type!=='unknown'){r.place=place;s.place='provided';}
 const time=flowTime(text);if(fillable('time')&&time!=='unknown'){r.timeOfDay=time;s.time='provided';}
 const actions=flowPersonActions(text,r.people);
 for(const person of r.people)if(fillable(`action:${person.id}`)&&actions.has(person.name)){person.action=actions.get(person.name);s[`action:${person.id}`]='provided';}
 if(r.people.length===1&&activity&&fillable('action:person-self')){r.people[0].action=activity;s['action:person-self']='provided';}
 const objects=[...new Set(text.match(/자전거|벤치|안전모|헬멧|케이크|꽃|책|커피|국수|사과|빵/g)||[])];
 if(!['none','unknown','declined'].includes(s.objects)&&objects.length){
  for(const name of objects)if(!r.objects.some(object=>object.name===name)&&r.objects.length<6)r.objects.push({id:`object-${r.objects.length+1}`,name,count:null});
  s.objects='provided';
 }
 const labels=flowEmotion(text);
 if(fillable('emotion')&&labels.length){const feelingText=text.split(/(?<=[.!?。])\s*|\n/).filter(part=>flowEmotion(part).length).join(' ');r.emotion={text:feelingText||text,labels,status:'provided'};s.emotion='provided';}
 const cue=text.split(/(?<=[.!?。])\s*/).find(part=>/처음|가장\s*기억|특히\s*기억|인상\s*깊/.test(part)&&!flowRefusal(part));
 if(fillable('memoryCue')&&cue){r.memoryCue=flowText(cue,300);r.memoryCueStatus='provided';s.memoryCue='provided';}
 if(fillable('topic')&&r.activity){r.topic=r.activity;r.topicSource='derived_from_activity';s.topic='provided';}
 const field=experienceQuestionField(question,r),refusal=flowRefusal(text);
 if(field&&fillable(field)&&text&&!/^(?:네|예|맞아요|그래요)[.!。]?$/.test(text)){
  if(refusal){
   const status=refusal==='none'&&!['objects','people','memoryCue'].includes(field)?'unknown':refusal;
   s[field]=status;
   if(field==='emotion')r.emotion={text:'',labels:[],status};
   if(field==='memoryCue'){r.memoryCue='';r.memoryCueStatus=status;}
  }else if(field==='emotion'){r.emotion={text,labels,status:'provided'};s.emotion='provided';}
  else if(field==='memoryCue'){r.memoryCue=flowText(text,300);r.memoryCueStatus='provided';s.memoryCue='provided';}
  else if(field.startsWith('action:')&&!actions.size){const person=r.people.find(p=>p.id===field.slice(7));if(person){person.action=flowText(text,200);s[field]='provided';}}
 }
 if(text&&!r.sourceEvidence.quotes.includes(text)&&r.sourceEvidence.quotes.length<80)r.sourceEvidence.quotes.push(text);
 return r;
}

export function prepareExperience(value){
 const r=flowClone(value),statuses={...(r.collectionStatus||{})};
 r.people=Array.isArray(r.people)&&r.people.length?r.people:[{id:'person-self',alias:'A',name:'나',action:'',visual:'파란색 상의 (그림 구별용 설정)'}];
 r.objects=Array.isArray(r.objects)?r.objects:[];r.place=r.place||{id:'',name:'',type:'unknown'};
 r.topic=flowText(r.topic||r.activity,200);r.topicSource=r.topicSource||(r.topic?'derived_from_activity':'not_collected');
 r.emotion=r.emotion||{text:'',labels:[],status:'not_asked'};
 const defaults={activity:r.activity?'provided':'not_asked',place:r.place.type!=='unknown'?'provided':'not_asked',people:r.people.length>1?'provided':'not_asked',time:['morning','afternoon','evening','night'].includes(r.timeOfDay)?'provided':'not_asked',objects:r.objects.length?'provided':'not_asked',topic:r.topic?'provided':'not_asked',emotion:r.emotion.status||'not_asked',memoryCue:r.memoryCueStatus||'not_asked'};
 for(const [key,status] of Object.entries(defaults))if(!FLOW_STATUSES.includes(statuses[key])||statuses[key]==='not_asked'&&status==='provided')statuses[key]=status;
 for(const person of r.people){const key=`action:${person.id}`;if(!FLOW_STATUSES.includes(statuses[key])||statuses[key]==='not_asked'&&person.action)statuses[key]=person.action?'provided':'not_asked';}
 r.collectionStatus=statuses;r.sourceEvidence=r.sourceEvidence||{quotes:[]};r.sourceEvidence.quotes=Array.isArray(r.sourceEvidence.quotes)?r.sourceEvidence.quotes:[];r.sourceEvidence.answers=r.sourceEvidence.answers||[];
 r.importanceRating=r.importanceRating??null;r.importanceStatus=r.importanceStatus||'not_asked';
 return r;
}

export function localExperienceEvents(session){
 const turns=experienceTurns(session.turns||[]),events=[];let focusedId=null;
 for(const [turnIndex,turn] of turns.entries()){
  const text=turn.answer.trim();if(!text)continue;
  const marks=[...text.matchAll(flowPlacePattern)],pieces=[];
  let start=0;
  for(let i=1;i<marks.length;i++){
   if(marks[i][0]===marks[i-1][0])continue;
   const previousEnd=marks[i-1].index+marks[i-1][0].length;
   const between=text.slice(previousEnd,marks[i].index);
   // Keep "오후에는 손녀와" with the park, rather than the preceding hospital.
   const sentence=[...between.matchAll(/[.!?。\n]\s*/g)].at(-1);
   const time=[...between.matchAll(/(?:오늘\s*)?(?:오전|오후|아침|점심|저녁|밤)(?:에는?|에|은|는)?\s*/g)].at(-1);
   const join=[...between.matchAll(/(?:그리고|그다음에|그다음|갔다가|다녀와서|다녀왔고|갔고|[,，;])\s*/g)].at(-1);
   const offset=sentence?sentence.index+sentence[0].length:time?time.index:join?join.index+join[0].length:between.length;
   const boundary=previousEnd+offset;
   pieces.push(text.slice(start,boundary));start=boundary;
  }
  pieces.push(text.slice(start));
  const touched=new Set();let withinTurnId=null;
  for(let part of pieces){
   part=part.trim().replace(/^(?:그리고|그다음에|그다음|또)\s*/,'').replace(/(?:그리고|그다음에)\s*$/,'').trim();if(!part)continue;
   const place=flowPlace(part),activity=flowActivity(part);
   if(place.type!=='unknown'&&/(?:취소|안\s*갔|가지\s*않|못\s*갔)/.test(part)&&!activity)continue;
   let target;
   if(place.type!=='unknown'){
    const same=events.filter(event=>event.place.name===place.name&&(!activity||!event.activity||event.activity===activity)&&(flowTime(part)==='unknown'||event.timeOfDay==='unknown'||flowTime(part)===event.timeOfDay));
    if(same.length===1)target=same[0];
   }else{
    target=flowUniqueEvent(part,events)||flowUniqueEvent(turn.question,events)||events.find(event=>event.id===(withinTurnId||focusedId));
    if(!target&&events.length)continue; // An ambiguous reply stays in the transcript.
    if(!target&&flowRefusal(part)&&!activity)continue;
   }
   if(!target){
    target=prepareExperience({schemaVersion:3,id:flowId('event'),title:[place.name,activity||'이야기'].filter(Boolean).join(' · '),scene:'',activity:'',eventDate:session.date||null,dateStatus:session.date?'known':'unknown',timeOfDay:'unknown',place:{id:'',name:'',type:'unknown'},people:[],objects:[],memoryCue:'',memoryCueStatus:'not_asked',confirmed:false,extractionSource:'rule_based_candidate',sourceEvidence:{quotes:[],turnIndices:[],answers:[]}});
    events.push(target);
   }
   const index=events.indexOf(target),updated=supplementExperience(target,part,{question:turn.question});
   updated.scene=[target.scene,part].filter(Boolean).join(' ').slice(0,1800);
   updated.title=[updated.place.name,updated.activity||'이야기'].filter(Boolean).join(' · ').slice(0,120);
   updated.sourceEvidence.turnIndices=[...new Set([...(updated.sourceEvidence.turnIndices||[]),turnIndex])];
   events[index]=updated;touched.add(updated.id);withinTurnId=updated.id;
  }
  focusedId=touched.size===1?[...touched][0]:null;
 }
 return events.slice(0,8);
}

export function collectionQuestion(value){
 const r=prepareExperience(value),s=r.collectionStatus;
 const options=[['activity','그곳에서 어떤 일을 하셨나요?'],['place','그 이야기는 어디에서 있었던 일인가요?'],['people','그때 혼자 계셨나요, 함께한 분이 있었나요?'],...r.people.map(person=>[`action:${person.id}`,person.name==='나'?'그때 무엇을 하고 계셨나요?':`${flowSubject(person.name)} 그때 무엇을 하고 있었나요?`]),['time','그 일은 아침, 오후, 저녁 중 언제 있었나요?'],['objects','그때 기억에 남는 물건이나 음식이 있었나요? 없으면 없다고 해주셔도 돼요.'],['topic','이 이야기를 어떤 일로 기억하고 싶으세요? 산책이나 가족모임처럼 짧게 말씀해 주세요.'],['emotion','그때 기분은 어떠셨어요?'],['memoryCue','그날 특히 기억에 남는 순간이 있었나요?']];
 const next=options.find(([field])=>s[field]==='not_asked');
 return next?{field:next[0],question:next[1]}:null;
}

export function applyCollectionAnswer(value,field,answer){
 const r=prepareExperience(value),text=flowText(answer,1000);
 if(!text)throw new Error('짧게 말씀해 주시거나 기억나지 않음을 선택해 주세요.');
 if(!Object.hasOwn(r.collectionStatus,field))throw new Error('확인할 항목이 올바르지 않아요.');
 const asked=collectionQuestion(r);
 const alone=field==='people'&&/혼자|저만|나만/.test(text)&&!/혼자.{0,8}(?:아니|않|말고)/.test(text);
 const refusal=alone?'none':flowRefusal(text),status=refusal==='none'&&field==='people'?'provided':refusal==='none'&&field==='activity'?'unknown':refusal||'provided';
 r.collectionStatus[field]=status;
 r.sourceEvidence.answers.push({field,question:asked?.field===field?asked.question:'선택한 경험의 추가 정보 확인',quote:text,status,answeredAt:new Date().toISOString()});
 if(field==='memoryCue'){r.memoryCueStatus=status;r.memoryCue=status==='provided'?text:'';}
 else if(field==='emotion'){r.emotion={text:status==='provided'?text:'',labels:status==='provided'?flowEmotion(text):[],status};}
 else if(status==='provided'){
  if(field==='activity'){r.activity=flowText(text,200);r.topic=r.topic||flowText(text,200);r.topicSource=r.topicSource==='not_collected'?'derived_from_activity':r.topicSource;r.collectionStatus.topic='provided';if(r.people.length===1&&!r.people[0].action){r.people[0].action=text;r.collectionStatus[`action:${r.people[0].id}`]='provided';}}
  if(field==='place'){const place=flowPlace(text);r.place={...place,name:place.name||text,type:place.type==='unknown'?'other':place.type};}
  if(field==='time'){r.timeOfDay=flowTime(text);if(r.timeOfDay==='unknown')r.collectionStatus.time='unknown';}
  if(field==='topic'){r.topic=flowText(text,200);r.topicSource='user_answer';}
  if(field==='people'){
   if(refusal!=='none'){
    const kin=[...new Set(text.match(/손녀|손자|며느리|사위|남편|아내|친구|딸|아들|의사\s*선생님/g)||[])];
    const names=kin.length?kin:text.replace(/(?:함께|같이|있었어요|갔어요|다녀왔어요|왔어요|예요|이에요|이요|요)[.!。]?/g,'').split(/[,、]|그리고|이랑|하고|(?:와|과)\s/).map(name=>name.trim()).filter(Boolean);
    for(const name of names.slice(0,5))if(!r.people.some(p=>p.name===name)){const person={id:flowId('person'),alias:String.fromCharCode(65+r.people.length),name:flowText(name,80),action:'',visual:`인물 ${String.fromCharCode(65+r.people.length)}, ${['파란색','노란색','초록색','보라색','주황색','분홍색'][r.people.length]} 상의 (그림 구별용 설정)`};r.people.push(person);r.collectionStatus[`action:${person.id}`]='not_asked';}
   }
  }
  if(field==='objects')r.objects=text.split(/[,、]|그리고|이랑|하고|(?:와|과)\s/).map((name,index)=>({id:`object-${index+1}`,name:flowText(name,80),count:null})).filter(o=>o.name).slice(0,6);
  if(field.startsWith('action:')){const person=r.people.find(p=>p.id===field.slice(7));if(!person)throw new Error('이 장면의 인물이 아니에요.');person.action=flowText(text,200);}
 }
 r.confirmed=false;
 return supplementExperience(r,text);
}

export function createExperienceBundle(events,diaryNarrative,{turns=[]}={}){
 if(!Array.isArray(events)||!events.length||events.length>8)throw new Error('오늘 이야기의 사건을 1~8개로 준비해 주세요.');
 const prepared=events.map(prepareExperience);if(new Set(prepared.map(e=>e.id)).size!==prepared.length)throw new Error('사건 ID가 중복되어 있어요.');
 const bundle={schemaVersion:1,id:flowId('story'),diaryNarrative:flowText(diaryNarrative,8000),events:prepared,selectedEventId:prepared.length===1?prepared[0].id:null,selectionSource:prepared.length===1?'single_event_pending_confirmation':null,selections:[],importance:{eventId:null,value:null,status:'not_asked'}};
 return applyExperiencePreference(bundle,turns);
}

export function applyExperiencePreference(bundle,turns){
 if(bundle.selectedEventId&&bundle.selectionSource!=='single_event_pending_confirmation')return bundle;
 const preference=preferredExperience(bundle.events,turns);
 if(preference){bundle.selectedEventId=preference.eventId;bundle.selectionSource='explicit_conversation_preference';bundle.selections=bundle.selections||[];bundle.selections.push({...preference,source:'explicit_conversation_preference'});bundle.importance={eventId:preference.eventId,value:null,status:'not_asked'};}
 return bundle;
}

export function chooseExperience(bundle,id){
 if(!bundle.events.some(event=>event.id===id))throw new Error('그림으로 남길 이야기를 골라주세요.');
 const changed=bundle.selectedEventId!==id;
 if(changed||bundle.selectionSource==='single_event_pending_confirmation'){bundle.selections=bundle.selections||[];bundle.selections.push({eventId:id,question:'어떤 내용을 그림일기로 만들고 싶으세요?',answer:bundle.events.find(e=>e.id===id).title,answeredAt:new Date().toISOString()});}
 bundle.selectedEventId=id;if(changed||bundle.selectionSource==='single_event_pending_confirmation')bundle.selectionSource='user_selection';
 if(changed){const event=bundle.events.find(e=>e.id===id);bundle.importance={eventId:id,value:event.importanceRating??null,status:event.importanceStatus||'not_asked'};}
 return bundle.events.find(event=>event.id===id);
}

export function experienceMatching(bundle){
 return {schemaVersion:1,selectedEventId:bundle.selectedEventId,events:bundle.events.map(event=>({eventId:event.id,selectedForImage:event.id===bundle.selectedEventId,confirmationStatus:event.confirmed?'user_confirmed':'unreviewed_candidate',activity:event.activity,topic:event.topic||null,emotion:event.emotion,place:event.place,timeOfDay:event.timeOfDay,eventDate:event.eventDate,people:event.people.map(({id,name,action})=>({personId:id,label:name,action})),objects:event.objects,memoryCue:event.memoryCue||null,collectionStatus:event.collectionStatus,importance:event.id===bundle.importance.eventId?bundle.importance:{eventId:event.id,value:event.importanceRating??null,status:event.importanceStatus||'not_asked'},description:event.scene,sourceEvidence:event.sourceEvidence}))};
}

export function composeExperienceScene(record){
 const time={morning:'아침에',afternoon:'오후에',evening:'저녁에',night:'밤에'}[record.timeOfDay]||'';
 return [time,record.place.name?`${record.place.name}에서 있었던 일.`:'',record.activity?`기억에 남길 일: ${record.activity}.`:'',...record.people.filter(p=>p.action).map(p=>`${p.name}: ${p.action.replace(/[.。]+$/,'')}.`),record.objects.length?`함께 나온 사물: ${record.objects.map(o=>o.name).join(', ')}.`:''].filter(Boolean).join(' ').slice(0,1800)||record.scene;
}

export function selectedDiaryText(record){
 const time={morning:'아침에',afternoon:'오후에',evening:'저녁에',night:'밤에'}[record.timeOfDay]||'';
 const place=record.place.name||'';
 const lines=[place?`${time?time+' ':''}${place}에서 시간을 보냈다.`:''];
 for(const person of record.people)if(person.action){const label=person.name==='나'?'나는':flowSubject(person.name);lines.push(`${label} ${person.action.replace(/[.。]+$/,'')}.`);}
 if(!record.people.some(p=>p.action)&&record.activity)lines.push(record.activity.replace(/[.。]+$/,'')+'.');
 if(record.emotion?.status==='provided'&&record.emotion.text)lines.push(record.emotion.text.replace(/[.。]+$/,'')+'.');
 if(record.memoryCueStatus==='provided'&&record.memoryCue)lines.push(record.memoryCue.replace(/[.。]+$/,'')+'.');
 const seen=new Set();
 return lines.filter(Boolean).filter(line=>{
  let key=line;
  for(const person of record.people)for(const particle of ['은','는','이','가'])if(key.startsWith(person.name+particle))key=person.name+key.slice(person.name.length+particle.length);
  key=key.replace(/[\s.!?。]/g,'');if(seen.has(key))return false;seen.add(key);return true;
 }).join(' ');
}

export function mergeObservedExperience(value,observed){
 const r=prepareExperience(value),s=r.collectionStatus;
 const fill=(field,update)=>{if(s[field]==='not_asked'&&observed.collectionStatus[field]!==undefined&&observed.collectionStatus[field]!=='not_asked'){update();s[field]=observed.collectionStatus[field];}};
 fill('activity',()=>{r.activity=observed.activity;});
 fill('place',()=>{r.place=structuredClone(observed.place);});
 fill('time',()=>{r.timeOfDay=observed.timeOfDay;});
 fill('topic',()=>{r.topic=observed.topic;r.topicSource=observed.topicSource;});
 fill('emotion',()=>{r.emotion=structuredClone(observed.emotion);});
 fill('memoryCue',()=>{r.memoryCue=observed.memoryCue;r.memoryCueStatus=observed.memoryCueStatus;});
 if(!['none','unknown','declined'].includes(s.people))for(const person of observed.people){
  let existing=r.people.find(p=>p.name===person.name);
  if(!existing&&r.people.length<6){existing={...person,alias:String.fromCharCode(65+r.people.length)};r.people.push(existing);s[`action:${existing.id}`]=observed.collectionStatus[`action:${person.id}`]||'not_asked';}
  if(existing&&s[`action:${existing.id}`]==='not_asked'&&observed.collectionStatus[`action:${person.id}`]!=='not_asked'){existing.action=person.action;s[`action:${existing.id}`]=observed.collectionStatus[`action:${person.id}`];}
 }
 fill('people',()=>{});
 if(!['none','unknown','declined'].includes(s.objects)){
  for(const object of observed.objects)if(!r.objects.some(o=>o.name===object.name)&&r.objects.length<6)r.objects.push({...object,id:`object-${r.objects.length+1}`});
  fill('objects',()=>{});
 }
 r.sourceEvidence.quotes=[...new Set([...r.sourceEvidence.quotes,...observed.sourceEvidence.quotes])].slice(0,80);
 return prepareExperience(r);
}

export function reconcileExperienceContext(value,observedEvents){
 const candidate=prepareExperience(value);
 const ranked=observedEvents.map(event=>{
  if(candidate.place.name&&event.place.name&&candidate.place.name!==event.place.name)return {event,score:0};
  if(candidate.timeOfDay!=='unknown'&&event.timeOfDay!=='unknown'&&candidate.timeOfDay!==event.timeOfDay)return {event,score:0};
  let score=candidate.place.name&&candidate.place.name===event.place.name?5:0;
  if(candidate.activity&&candidate.activity===event.activity)score+=4;
  if(candidate.sourceEvidence.quotes.some(a=>event.sourceEvidence.quotes.some(b=>a.includes(b)||b.includes(a))))score+=3;
  return {event,score};
 }).sort((a,b)=>b.score-a.score);
 return ranked[0]?.score>=3&&ranked[0].score!==(ranked[1]?.score||0)?mergeObservedExperience(candidate,ranked[0].event):candidate;
}
