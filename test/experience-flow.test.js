import test from 'node:test';
import assert from 'node:assert/strict';
import {localExperienceEvents,createExperienceBundle,chooseExperience,collectionQuestion,applyCollectionAnswer,composeExperienceScene} from '../public/experience-flow.js';
import {MEMORABLE_OPENING,DAILY_FALLBACK,localReply} from '../public/conversation.js';
import {validateSceneRecord,sceneFacts} from '../public/diary-record.js';
import {compileScenePlan,sceneCandidates} from '../scene-pipeline.js';
import {newSession,makeEntry,currentImage,conversationTranscript,restorable} from '../public/state.js';
import {createApp} from '../server.js';

const date='2026-11-20';
const story='오전에 병원에서 진료를 받았어요. 오후에는 공원에서 손녀와 자전거를 탔어요.';
function session(){return {date,turns:[{question:MEMORABLE_OPENING,answer:story}],photos:[]};}
function complete(record){
 let r=record;
 for(let i=0;i<20;i++){
  const q=collectionQuestion(r);if(!q)break;
  const answer=q.field==='people'?'혼자 있었어요.':q.field==='memoryCue'?'손녀가 처음 혼자 탄 날이에요.':q.field==='emotion'?'기쁘고 뿌듯했어요.':q.field==='objects'?'없어요.':q.field==='time'?'오후였어요.':q.field.startsWith('action:')?(q.field.endsWith('person-self')?'벤치에 앉아 응원했어요.':'자전거를 탔어요.'):'공원에서 보낸 시간';
  r=applyCollectionAnswer(r,q.field,answer);
 }
 return r;
}

test('첫 질문은 중요한 경험이며 특별한 일이 없을 때만 일상으로 넓힌다',()=>{
 assert.equal(localReply({turns:[]}).question,MEMORABLE_OPENING);
 const reply=localReply({turns:[{question:MEMORABLE_OPENING,answer:'특별히 기억에 남는 일은 없어요.'}]});
 assert.equal(reply.question,DAILY_FALLBACK);assert.equal(reply.ready,false);
 const next=localReply({turns:[{question:MEMORABLE_OPENING,answer:'딱히 없어요.'},{question:DAILY_FALLBACK,answer:'공원에서 산책했어요.'}]});
 assert.notEqual(next.question,MEMORABLE_OPENING);assert.notEqual(next.question,DAILY_FALLBACK);
 assert.equal(localReply({turns:[{question:MEMORABLE_OPENING,answer:'없어요.'},{question:DAILY_FALLBACK,answer:'잘 모르겠어요.'}]}).rest,true);
});

test('한 답변의 다른 배경은 사건별로 보관하며 선택 전에는 한 장면을 확정하지 않는다',()=>{
 const events=localExperienceEvents(session());assert.equal(events.length,2);
 assert.equal(events[0].place.type,'hospital');assert.equal(events[1].place.type,'park');
 const bundle=createExperienceBundle(events,story);assert.equal(bundle.selectedEventId,null);
 const chosen=chooseExperience(bundle,events[1].id);assert.equal(chosen.id,events[1].id);
 assert.equal(bundle.events[0].confirmed,false);assert.match(bundle.events[0].scene,/진료/);
 assert.doesNotMatch(chosen.scene,/병원/);assert.equal(bundle.importance.status,'not_asked');
});

test('선택한 사건의 부족한 필드만 묻고 답변·질문·명시적인 모름을 보관한다',()=>{
 let record=localExperienceEvents(session())[1];const first=collectionQuestion(record);
 assert.equal(first.field,'action:person-self');assert.doesNotMatch(first.question,/어디|누구/);
 record=applyCollectionAnswer(record,first.field,'벤치에 앉아 응원했어요.');
 assert.equal(record.sourceEvidence.answers[0].question,first.question);
 assert.notEqual(collectionQuestion(record).field,first.field);
 const unknown=collectionQuestion(record);record=applyCollectionAnswer(record,unknown.field,'잘 모르겠어요.');
 assert.equal(record.collectionStatus[unknown.field],'unknown');assert.notEqual(collectionQuestion(record)?.field,unknown.field);
 record=complete(record);assert.equal(collectionQuestion(record),null);assert.equal(record.memoryCueStatus,'provided');assert.match(record.memoryCue,/처음 혼자/);
 const confirmed=validateSceneRecord({...record,confirmed:true});
 assert.ok(!sceneFacts(confirmed).some(f=>f.subjectIds?.includes(unknown.field.slice(7))&&f.kind==='actor_action'));
 assert.deepEqual(confirmed,validateSceneRecord(confirmed));
});

test('생성에 쓰지 않은 사건은 보관하되 실제 요청문과 필수 사실에는 섞지 않는다',()=>{
 const events=localExperienceEvents(session()),record=complete(events[1]);
 const confirmed=validateSceneRecord({...record,scene:composeExperienceScene(record),confirmed:true,diaryNarrative:story,supportingContext:[events[0].scene],unusedEventIds:[events[0].id]});
 const plan=compileScenePlan(confirmed);
 assert.doesNotMatch(plan.prompt,/병원에서 진료/);assert.ok(plan.record.diaryNarrative.includes('병원'));
 assert.equal(plan.usedInformation.selectedEventId,record.id);assert.deepEqual(plan.usedInformation.excludedEventIds,[events[0].id]);
 assert.deepEqual(plan.usedInformation.facts,plan.facts);
});

test('완성 기록에 사건별 정보·대화·생성 입력·선택한 경험의 별점을 보존한다',()=>{
 const s=newSession(date);s.stage='result';s.turns=session().turns;s.draft={title:'오늘의 기억',body:story,scene:'선택한 장면'};
 const events=localExperienceEvents(session());s.experienceBundle=createExperienceBundle(events,story);chooseExperience(s.experienceBundle,events[1].id);
 const record=validateSceneRecord({...complete(events[1]),scene:s.draft.scene,confirmed:true});s.sceneRecord=record;
 s.experienceBundle.importance={eventId:record.id,value:5,status:'provided'};
 s.image='data:image/jpeg;base64,YQ==';s.imageScene=s.draft.scene;s.imageEventId=record.id;s.imageGeneration={usedInformation:compileScenePlan(record).usedInformation};
 s.experienceBundle.events=s.experienceBundle.events.map(e=>e.id===record.id?record:e);
 const entry=makeEntry(s,'saved');assert.equal(entry.matching.importance.rating,5);
 assert.equal(entry.matchingContext.events[0].importance.status,'not_asked');assert.equal(entry.matchingContext.events[0].confirmationStatus,'unreviewed_candidate');
 assert.equal(entry.conversation.turns[0].answer,story);assert.ok(entry.conversation.turns.some(t=>t.phase==='selected_event_details'));
 assert.equal(entry.generation.usedInformation.selectedEventId,record.id);assert.ok(restorable(s));
 chooseExperience(s.experienceBundle,events[0].id);assert.equal(currentImage(s),'');assert.equal(s.experienceBundle.importance.value,null);
});

test('AI가 두 배경을 하나로 누락해도 보수적인 사건 후보를 보존한다',()=>{
 const draft={title:'하루',body:story,scene:story};
 const events=sceneCandidates(draft,session(),{events:[{scene:{value:story,evidence:story},activity:{value:'산책',evidence:'없는 발언'}}]});
 assert.equal(events.length,2);assert.ok(events.every(e=>e.confirmed===false));
});

async function requestFor(t,options){const server=createApp(options);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));return async(path,body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/`+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};}

test('HTTP: 선택한 사건 추가 질문은 키 없이도 원문을 보존하고 다른 사건을 고치지 않는다',async t=>{
 const request=await requestFor(t,{env:{}}),draft={title:'하루',body:story,scene:story};
 const response=await request('scene-draft',{draft,session:session()});assert.equal(response.status,200);assert.equal(response.data.candidates.length,2);
 const candidate=response.data.candidates[1],field=collectionQuestion(candidate).field;
 const collected=await request('scene-answer',{candidate,field,answer:'벤치에서 응원했어요.'});assert.equal(collected.status,200);
 assert.equal(collected.data.candidate.id,candidate.id);assert.equal(collected.data.candidate.people[0].action,'벤치에서 응원했어요.');
 assert.equal(collected.data.candidate.sourceEvidence.answers[0].question,collectionQuestion(candidate).question);
 assert.equal((await request('scene-answer',{candidate,field:'not-a-question',answer:'값'})).status,400);
});

test('동행자 없음과 첫 혼자 자전거라는 긍정 단서를 혼동하지 않는다',()=>{
 const hospital=localExperienceEvents(session())[0];
 const solo=applyCollectionAnswer(hospital,'people','없어요.');assert.equal(solo.people.length,1);assert.equal(solo.collectionStatus.people,'provided');
 const park=complete(localExperienceEvents(session())[1]);assert.equal(park.memoryCueStatus,'provided');assert.match(park.memoryCue,/처음 혼자/);
 const noSpecial=localExperienceEvents({date,turns:[{question:MEMORABLE_OPENING,answer:'특별히 기억에 남는 일은 없어요.'},...session().turns]});assert.equal(noSpecial.length,2);
});

test('HTTP: 선택 사건 본문은 확인 필드로 조합하고 외부 모델로 다시 쓰지 않는다',async t=>{
 let calls=0;
 const request=await requestFor(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async()=>{calls++;throw new Error('unexpected rewrite');}});
 const record=complete(localExperienceEvents(session())[1]);record.scene=composeExperienceScene(record);
 const response=await request('scene-text',{...record,diaryNarrative:story,supportingContext:['병원에서 진료를 받았다.'],confirmed:true});
 assert.equal(response.status,200);assert.equal(response.data.textSource,'confirmed_fields');assert.equal(calls,0);
 assert.match(response.data.body,/벤치에 앉아 응원/);assert.doesNotMatch(response.data.body,/병원/);
});
