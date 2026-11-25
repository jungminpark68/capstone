import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiaryEventsExport,validateDiaryEventsExport,diaryEventsFileName} from '../public/diary-export.js';
import {localExperienceEvents,createExperienceBundle,chooseExperience,collectionQuestion,applyCollectionAnswer,selectedDiaryText} from '../public/experience-flow.js';
import {validateSceneRecord} from '../public/diary-record.js';
import {makeEntry,newSession} from '../public/state.js';
import {createApp} from '../server.js';

function fixture(){
 const selected={id:'swim-event',confirmed:true,eventDate:'2026-11-25',dateStatus:'known',
  scene:'아들과 수영장에서 물에 뜨는 연습을 했다.',activity:'수영',place:{type:'other',name:'수영장'},
  people:[{id:'self',name:'나',action:'물에 뜨는 연습',visual:'임의 보라색 옷'},{id:'son',name:'아들',action:'손을 잡아 줌',visual:'임의 초록색 옷'}],
  objects:[{name:'수영 보조용품',count:1}],emotion:{text:'처음에는 무서웠지만 성공해서 뿌듯했어요.',labels:['happy'],status:'provided'},
  collectionStatus:{activity:'provided',place:'provided',people:'provided',objects:'provided','action:self':'provided','action:son':'provided'},
  importanceRating:2,importanceStatus:'provided'};
 const other={id:'walk-event',scene:'오전에 딸과 공원에서 산책했다.',activity:'산책',place:{name:'공원',type:'park'},people:[{id:'daughter',name:'딸'}],objects:[],emotion:{status:'not_asked',text:'',labels:[]},collectionStatus:{objects:'none'}};
 return {id:'diary-001',date:'2026-11-26',body:'아들과 수영장에서 물에 뜨는 연습을 했다. 아들이 손을 잡아줘서 뿌듯했다.',sceneRecord:selected,
  experiences:{selectedEventId:selected.id,events:[other,selected],importance:{eventId:selected.id,value:5,status:'provided'}},
  image:'',conversation:{turns:[{answer:'내일 병원 예약'}]}};
}

test('합의한 최상위 형식으로 선택 사건과 다른 사건을 분리하고 원본을 보존한다',()=>{
 const entry=fixture(),before=structuredClone(entry),v=createDiaryEventsExport(entry);
 assert.deepEqual(Object.keys(v),['schema','diaryId','experienceDate','selectedEvent','otherEvents']);
 assert.equal(v.schema,'memory-itda-diary-events-v1');assert.equal(v.experienceDate,'2026-11-25');
 assert.equal(v.selectedEvent.eventText,entry.body);assert.equal(v.selectedEvent.importance.rating,5);
 assert.equal(v.selectedEvent.importance.scale,'1-5');assert.equal(v.otherEvents[0].eventId,'walk-event');
 assert.deepEqual(v.selectedEvent.elements.place,['수영장']);assert.deepEqual(v.selectedEvent.elements.person,['나','아들']);
 assert.ok(v.selectedEvent.elements.activity.includes('아들: 손을 잡아 줌'));
 assert.deepEqual(v.selectedEvent.elements.object,['수영 보조용품 1개']);
 assert.match(v.selectedEvent.elements.emotion[0],/무서웠지만.*뿌듯/);
 assert.ok(!('importance' in v.otherEvents[0]));assert.deepEqual(v.otherEvents[0].elements.emotion,[]);
 for(const text of ['candidate','crossEncoderScore','rerankerRank','임의 보라색','임의 초록색','내일 병원','conversation','image'])assert.ok(!JSON.stringify(v).includes(text));
 assert.deepEqual(entry,before);
 assert.deepEqual(createDiaryEventsExport(entry),v);
});
test('별점 건너뛰기와 모름·없음·거절은 오래된 값보다 우선한다',()=>{
 const e=fixture(),r=e.sceneRecord;e.experiences.importance={eventId:r.id,status:'skipped',value:null};
 r.dateStatus='unknown';r.collectionStatus={activity:'unknown',place:'declined',people:'unknown',objects:'none'};r.emotion.status='declined';
 const v=createDiaryEventsExport(e);assert.equal(v.experienceDate,null);assert.equal(v.selectedEvent.importance.rating,null);
 for(const values of Object.values(v.selectedEvent.elements))assert.deepEqual(values,[]);
 e.experiences.events=[r];assert.deepEqual(createDiaryEventsExport(e).otherEvents,[]);
});
test('다른 사건 별점은 선택 사건으로 복사하지 않는다',()=>{
 const e=fixture();e.experiences.importance.eventId='walk-event';e.sceneRecord.importanceStatus='not_asked';
 assert.equal(createDiaryEventsExport(e).selectedEvent.importance.rating,null);
});
test('선택 기록 없는 과거 일기와 잘못 연결한 장면·그림은 합성하지 않는다',()=>{
 assert.throws(()=>createDiaryEventsExport({id:'old',body:'옛 일기'}),/선택한 사건/);
 const e=fixture();e.sceneRecord.confirmed=false;assert.throws(()=>createDiaryEventsExport(e),/확인/);
 e.sceneRecord.confirmed=true;e.experiences.selectedEventId='walk-event';assert.throws(()=>createDiaryEventsExport(e),/달라/);
 e.experiences.selectedEventId=e.sceneRecord.id;e.image='data:image/jpeg;base64,YQ==';e.generation={usedInformation:{selectedEventId:'other'}};
 assert.throws(()=>createDiaryEventsExport(e),/생성 당시/);
});
test('이전 구조화 일기는 생성 스냅샷의 선택 사건 ID로 내보낼 수 있다',()=>{
 const e=fixture(),record=e.sceneRecord;delete e.sceneRecord;delete e.experiences;e.generation={recordAtGeneration:record};
 assert.equal(createDiaryEventsExport(e).selectedEvent.eventId,record.id);
});
test('전달 JSON 검사기가 누락·추가 필드·중복 ID·배열 오류·잘못된 별점과 날짜를 거부한다',()=>{
 const valid=createDiaryEventsExport(fixture());
 const mutations=[
  v=>{v.candidate={};},v=>{v.selectedEvent.crossEncoderScore=2.31;},v=>{v.experienceDate='2026-02-30';},
  v=>{v.otherEvents[0].eventId=v.selectedEvent.eventId;},v=>{v.otherEvents[0].importance={rating:2,scale:'1-5'};},
  v=>{v.selectedEvent.elements.person='아들';},v=>{delete v.selectedEvent.elements.emotion;},
  v=>{v.selectedEvent.elements.object=[''];},v=>{v.selectedEvent.elements.place=['수영장','수영장'];},
  v=>{v.selectedEvent.importance.rating=0;},v=>{v.selectedEvent.importance.rating=3.5;},v=>{v.selectedEvent.importance.rating='5';}
 ];
 for(const mutate of mutations){const value=structuredClone(valid);mutate(value);assert.throws(()=>validateDiaryEventsExport(value));}
 assert.equal(validateDiaryEventsExport(valid),valid);
 assert.ok(!diaryEventsFileName({...valid,diaryId:'../bad/name'}).includes('/'));
});
test('키 없는 수영·공원 대화에서 다섯 요소 확인 질문을 거쳐 실제 저장 결과를 내보낸다',()=>{
 const state=newSession('2026-11-25');
 const story='오전에 딸과 공원에서 산책했어요. 오후에는 아들과 스포츠센터에서 수영을 배웠어요.';
 state.turns=[{question:'기억에 남은 일이 있나요?',answer:story}];
 const events=localExperienceEvents(state);
 assert.equal(events.length,2);assert.equal(events[1].place.name,'스포츠센터');assert.equal(events[1].activity,'수영');
 state.experienceBundle=createExperienceBundle(events,story);let selected=chooseExperience(state.experienceBundle,events[1].id);
 const asked=[];
 for(let i=0;i<20;i++){
  const q=collectionQuestion(selected);if(!q)break;asked.push(q.field);
  const answer=q.field==='emotion'?'처음에는 무서웠지만 성공해서 뿌듯했어요.':q.field==='objects'?'수영 보조용품':q.field==='memoryCue'?'아들이 손을 잡아줘서 함께 웃었어요.':q.field.startsWith('action:')?'물에 뜨는 연습을 했어요.':'잘 모르겠어요.';
  selected=applyCollectionAnswer(selected,q.field,answer);
 }
 assert.equal(collectionQuestion(selected),null);assert.ok(asked.includes('emotion'));assert.ok(asked.includes('objects'));
 state.sceneRecord=validateSceneRecord({...selected,confirmed:true});state.experienceBundle.events=state.experienceBundle.events.map(e=>e.id===selected.id?state.sceneRecord:e);
 state.draft={title:'아들과 수영',body:selectedDiaryText(selected),scene:selected.scene};state.imageSkippedForTest=true;
 state.experienceBundle.importance={eventId:selected.id,value:4,status:'provided'};
 const entry=makeEntry(state,'stable-diary'),v=createDiaryEventsExport(entry);
 assert.equal(entry.image,'');assert.equal(entry.imageGenerationSkippedForTest,true);
 assert.equal(v.diaryId,'stable-diary');assert.equal(v.selectedEvent.importance.rating,4);
 assert.match(v.selectedEvent.elements.emotion[0],/뿌듯/);assert.deepEqual(v.selectedEvent.elements.object,['수영 보조용품']);
 assert.match(v.otherEvents[0].eventText,/딸.*공원/);assert.doesNotMatch(v.selectedEvent.eventText,/딸|공원/);
});


test('산책·책상·정책을 책 사물로 오인하지 않고 실제 책은 추출한다',()=>{
 for(const answer of ['공원에서 산책했어요.','도서관에서 책상 옆에 앉았어요.','복지관에서 정책 이야기를 했어요.']){
  const events=localExperienceEvents({date:'2026-11-25',turns:[{question:'오늘 이야기',answer}]});
  assert.ok(events.every(event=>!event.objects.some(object=>object.name==='책')));
 }
 const events=localExperienceEvents({date:'2026-11-25',turns:[{question:'오늘 이야기',answer:'도서관에서 책을 읽었어요.'}]});
 assert.ok(events.some(event=>event.objects.some(object=>object.name==='책')));
});
test('행동 답변의 주어는 구조화 행동과 일기 본문에 두 번 붙이지 않는다',()=>{
 const state={date:'2026-11-25',turns:[{question:'오늘 이야기',answer:'아들과 수영장에서 수영을 했어요.'}]};
 let record=localExperienceEvents(state)[0];
 record=applyCollectionAnswer(record,'action:person-self','나는 물에 뜨는 연습을 했어요.');
 assert.equal(record.people[0].action,'물에 뜨는 연습을 했어요');
 assert.doesNotMatch(selectedDiaryText(record),/나는 나는/);
});
test('HTTP 내보내기는 API 키 없이 작동하고 외부 모델을 호출하지 않는다',async t=>{
 let calls=0;const server=createApp({env:{},fetcher:async()=>{calls++;throw new Error('unexpected paid request');}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const response=await fetch(base+'/api/diary-events-export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fixture())});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),createDiaryEventsExport(fixture()));assert.equal(calls,0);
 const bad=await fetch(base+'/api/diary-events-export',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(bad.status,400);
 assert.equal((await fetch(base+'/diary-export.js')).status,200);
});
