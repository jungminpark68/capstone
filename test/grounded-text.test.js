import test from 'node:test';
import assert from 'node:assert/strict';
import {localExperienceEvents,collectionQuestion,applyCollectionAnswer,selectedDiaryText,composeExperienceScene,utteranceEmotion,createExperienceBundle,chooseExperience} from '../public/experience-flow.js';
import {sceneCandidates,enrichCollectionAnswer,sceneCandidate} from '../scene-pipeline.js';
import {createApp} from '../server.js';
import {validateSceneRecord} from '../public/diary-record.js';
import {createDiaryEventsExport} from '../public/diary-export.js';
import {newSession,makeEntry} from '../public/state.js';

const date='2026-11-26';
// Synthetic reproduction: achievement/encouragement is not an emotion report.
const hospital='오전에는 혼자 병원에서 진료를 받았어요.';
const park='오후에는 손녀와 호수공원에 갔어요. 손녀가 처음 혼자 자전거를 탔고, 나는 벤치에 앉아 손뼉을 치며 응원했어요. 손녀가 자전거 탄 일을 그림일기로 남기고 싶어요.';
const story=hospital+' '+park;
const session=()=>({date,photos:[],turns:[{question:'기억에 남는 일이 있었나요?',answer:story}]});
const selected=events=>events.find(event=>event.place.name==='호수공원');
function finish(record,emotion='잘 모르겠어요.'){
 for(let i=0;i<20;i++){
  const q=collectionQuestion(record);if(!q)return record;
  record=applyCollectionAnswer(record,q.field,q.field==='emotion'?emotion:'잘 모르겠어요.');
 }
 throw new Error('Collection did not finish');
}

test('제보 재현: 응원·첫 성공·그림으로 남기기 의사는 뿌듯함으로 바꾸지 않는다',()=>{
 const r=selected(localExperienceEvents(session()));
 assert.equal(r.emotion.status,'not_asked');assert.equal(r.emotion.text,'');
 assert.equal(collectionQuestion(r).field,'emotion');
 const done=finish(r),body=selectedDiaryText(done);
 assert.match(body,/손뼉을 치며 응원/);assert.match(body,/처음 혼자 자전거/);
 assert.doesNotMatch(done.people.find(person=>person.name==='손녀').action,/그림일기|남기고/);
 assert.doesNotMatch(body,/그림일기|남기고|탔고,\./);
 assert.equal((body.match(/손뼉을 치며 응원/g)||[]).length,1);
 assert.doesNotMatch(body,/뿌듯|행복|병원/);assert.equal(done.emotion.status,'unknown');
});

test('실제 원문을 인용해도 그 원문에 없는 감정·장면·행동 요약은 채우지 않는다',()=>{
 const draft={title:'하루',body:story,scene:story};
 const events=sceneCandidates(draft,session(),{events:[
  {scene:{value:'마음이 편안한 병원 방문',evidence:hospital},place:{name:'병원',type:'hospital',evidence:hospital}},
  {scene:{value:'손녀가 자전거를 타서 참 뿌듯하고 행복했다.',evidence:park},place:{name:'호수공원',type:'park',evidence:park},activity:{value:'자전거 타기',evidence:park},
   people:[{name:'손녀',action:'처음 자전거를 타며 행복해했어요',evidence:park}],emotion:{value:'뿌듯하고 행복했어요',labels:['happy'],evidence:park},cue:{value:'손녀를 보며 뿌듯했다',status:'provided',evidence:park}}
 ]});
 const r=selected(events);
 assert.equal(events.length,2);assert.equal(r.emotion.status,'not_asked');
 assert.ok(events.every(event=>!/(?:뿌듯|행복|편안)/.test(event.scene)));
 assert.doesNotMatch(r.people.find(person=>person.name==='손녀').action,/행복/);
 assert.doesNotMatch(selectedDiaryText(finish(r)),/뿌듯|행복/);
});

test('감정 추출의 모델 요약·라벨 대신 실제 표현과 부정을 그대로 보존한다',()=>{
 const answer='호수공원에서 손녀와 쉬었어요. 행복하지는 않았어요.';
 const events=sceneCandidates({title:'공원',body:answer,scene:answer},{date,turns:[{question:'오늘 이야기',answer}]},{events:[
  {scene:{value:'행복한 하루',evidence:answer},place:{name:'호수공원',type:'park',evidence:answer},emotion:{value:'행복했어요',labels:['happy'],evidence:'행복하지는 않았어요.'}}
 ]});
 assert.equal(events[0].emotion.text,'행복하지는 않았어요.');assert.deepEqual(events[0].emotion.labels,[]);
 assert.match(selectedDiaryText(events[0]),/행복하지는 않았어요/);
});

test('추가 정보 보완에서도 응원 행동을 감정으로 추정하지 않는다',()=>{
 const r=selected(localExperienceEvents(session())),answer='벤치에 앉아 손뼉을 치며 응원했어요.';
 const enriched=enrichCollectionAnswer(r,answer,{emotion:{value:'참 뿌듯했어요',labels:['happy'],evidence:answer}});
 assert.equal(enriched.emotion.status,'not_asked');assert.equal(enriched.emotion.text,'');
});

test('직접 말한 감정만 사용하며 모름·거절·중립 답변도 그대로 처리한다',()=>{
 const r=selected(localExperienceEvents(session()));
 assert.equal(finish(r,'정말 뿌듯하고 행복했어요.').emotion.text,'정말 뿌듯하고 행복했어요.');
 assert.equal(finish(r,'그냥 평소와 비슷했어요.').emotion.text,'그냥 평소와 비슷했어요.');
 assert.equal(finish(r,'잘 모르겠어요.').emotion.text,'');
 assert.equal(finish(r,'이 질문은 건너뛸게요.').emotion.status,'declined');
 assert.equal(utteranceEmotion('손녀가 처음 자전거를 탔어요. 나는 응원했어요.'),null);
});

test('다른 사건의 감정과 질문에만 나온 감정을 선택 사건에 복사하지 않는다',()=>{
 const s=session();s.turns[0].answer=hospital+' 진료가 걱정됐어요. '+park;
 const events=localExperienceEvents(s);assert.equal(selected(events).emotion.status,'not_asked');
 assert.equal(events.find(event=>event.place.name==='병원').emotion.status,'provided');
 const r=sceneCandidates({title:'하루',body:story,scene:park},session(),{events:[{scene:{value:park,evidence:park},place:{name:'호수공원',type:'park',evidence:park},emotion:{value:'뿌듯했어요',evidence:'기분이 뿌듯하셨나요?'}}]});
 assert.equal(selected(r).emotion.status,'not_asked');
});

test('원문에 없는 장소 고유명·행동·사물·수량을 원문 인용만으로 통과시키지 않는다',()=>{
 const answer='공원에서 손녀와 자전거를 봤어요.';
 const r=sceneCandidate({title:'공원',body:answer,scene:answer},{date,turns:[{question:'오늘 이야기',answer}]},{
  place:{name:'서울호수공원',type:'park',evidence:answer},people:[{name:'손녀',action:'뿌듯해했어요',evidence:answer}],objects:[{name:'자전거',count:3,evidence:answer},{name:'장미꽃',count:2,evidence:answer}]});
 assert.equal(r.place.name,'');assert.equal(r.people[0].action,'');assert.deepEqual(r.objects.map(o=>[o.name,o.count]),[['자전거',null]]);
});

test('감정 원문 없이 라벨만 있는 기록은 감정 배열을 만들어 내지 않는다',()=>{
 const s=newSession(date),events=localExperienceEvents(session()),r=finish(selected(events));
 r.emotion={text:'',labels:['happy'],status:'provided'};s.experienceBundle=createExperienceBundle(events,story);chooseExperience(s.experienceBundle,r.id);
 s.experienceBundle.importance={eventId:r.id,value:null,status:'skipped'};s.sceneRecord=validateSceneRecord({...r,scene:composeExperienceScene(r),confirmed:true});
 s.draft={title:r.title,body:selectedDiaryText(r),scene:s.sceneRecord.scene};s.imageSkippedForTest=true;
 const value=createDiaryEventsExport(makeEntry(s,'grounded-diary'));
 assert.deepEqual(value.selectedEvent.elements.emotion,[]);assert.doesNotMatch(value.selectedEvent.eventText,/즐거움|뿌듯|행복/);
});

async function requests(t,fetcher){
 const server=createApp({env:{DIARY_API_KEY:'test-only'},fetcher});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return async(path,body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
}
test('API 키가 있어도 초안·최종 본문을 외부 모델로 재작성하지 않는다',async t=>{
 let calls=0;const request=await requests(t,async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify({body:'손녀를 보며 뿌듯한 마음이 들었어요.'})}}]});});
 const draft=await request('draft',session());assert.equal(draft.body,story);assert.equal(draft.textSource,'user_utterances');
 const r=finish(selected(localExperienceEvents(session()))),record=validateSceneRecord({...r,scene:composeExperienceScene(r),confirmed:true});
 const text=await request('scene-text',record);assert.equal(text.body,selectedDiaryText(record));assert.equal(text.textSource,'confirmed_fields');
 assert.doesNotMatch(text.body,/뿌듯|행복|병원/);assert.equal(calls,0);
});
