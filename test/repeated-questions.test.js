import test from 'node:test';
import assert from 'node:assert/strict';
import {localExperienceEvents,createExperienceBundle,collectionQuestion,applyCollectionAnswer,chooseExperience,reconcileExperienceContext,selectedDiaryText} from '../public/experience-flow.js';
import {localReply,filterFollowup,MEMORABLE_OPENING} from '../public/conversation.js';
import {conversationTranscript,newSession} from '../public/state.js';
import {sceneCandidates} from '../scene-pipeline.js';
import {createApp} from '../server.js';

const date='2026-11-20';
const originalStory='오전에 병원에 다녀왔고, 오후에는 손녀와 호수공원에 갔어요. 손녀가 처음 보조바퀴 없이 혼자 자전거를 탔어요.';
const reportedTurns=[
 {question:MEMORABLE_OPENING,answer:originalStory},
 {question:'걸으면서 무엇이 가장 눈에 들어오셨나요?',answer:''},
 {question:'괜찮아요. 그 이야기는 여기까지 해도 돼요. 오늘 다른 일 중 편하게 들려주고 싶은 것이 있나요?',answer:'손녀가 자전거를 탄 일을 남기고 싶어요'},
 {question:'그 시간을 보내고 나니 기분이 어떠셨어요?',answer:'정말 뿌듯하고 행복했어요.'}
];
const session=()=>({date,turns:structuredClone(reportedTurns)});
const park=events=>events.find(event=>event.place.name==='호수공원');

test('사용자 제보 재현: 앞 대화의 오후·손녀 행동·기분·첫 성공 단서를 모두 이어받는다',()=>{
 const events=localExperienceEvents(session()),r=park(events);
 assert.equal(events.length,2);assert.equal(events[0].timeOfDay,'morning');assert.equal(r.timeOfDay,'afternoon');
 assert.equal(events[0].people.length,1);assert.doesNotMatch(events[0].scene,/손녀|오후/);
 assert.match(r.people.find(p=>p.name==='손녀').action,/보조바퀴 없이 혼자 자전거/);
 assert.equal(r.emotion.text,'정말 뿌듯하고 행복했어요.');assert.match(r.memoryCue,/처음 보조바퀴/);
 assert.equal(collectionQuestion(r).field,'action:person-self');
 const complete=applyCollectionAnswer(r,'action:person-self','벤치에 앉아 손뼉을 치며 응원했어요.');
 assert.equal(collectionQuestion(complete),null);
 assert.ok(complete.objects.some(object=>object.name==='벤치'));
 assert.equal((selectedDiaryText(complete).match(/처음 보조바퀴 없이/g)||[]).length,1);
});

test('이미 말한 선택 의사는 다시 묻지 않고 원래 발언에 선택 근거를 표시한다',()=>{
 const s=session(),bundle=createExperienceBundle(localExperienceEvents(s),originalStory,{turns:s.turns});
 assert.equal(bundle.selectedEventId,park(bundle.events).id);
 assert.equal(bundle.selectionSource,'explicit_conversation_preference');
 chooseExperience(bundle,bundle.selectedEventId);
 assert.equal(bundle.selectionSource,'explicit_conversation_preference');assert.equal(bundle.selections.length,1);
 const state={...newSession(date),turns:s.turns,experienceBundle:bundle};
 const transcript=conversationTranscript(state);
 assert.equal(transcript.turns.length,reportedTurns.length);
 assert.equal(transcript.turns[2].diarySelection.eventId,bundle.selectedEventId);
 assert.equal(transcript.turns.filter(turn=>turn.answer===reportedTurns[2].answer).length,1);
});

test('애매하거나 부정한 선택 의사는 자동 선택하지 않는다',()=>{
 for(const answer of ['둘 다 남기고 싶어요.','손녀가 자전거 탄 일은 남기고 싶지 않아요.','그 일을 남기고 싶어요.']){
  const s=session(),turns=[s.turns[0],{question:'오늘은요?',answer}];
  const bundle=createExperienceBundle(localExperienceEvents({date,turns}),originalStory,{turns});
  assert.equal(bundle.selectedEventId,null,answer);
 }
 const s=session(),turns=[...s.turns,{question:'내용을 확인할까요?',answer:'손녀가 자전거 탄 일은 남기고 싶지 않아요.'}];
 assert.equal(createExperienceBundle(localExperienceEvents({date,turns}),originalStory,{turns}).selectedEventId,null);
});

test('같은 사건의 짧은 후속 답변에서도 시간·인물 행동·감정을 구조화한다',()=>{
 const turns=[{question:MEMORABLE_OPENING,answer:'손녀와 호수공원에 갔어요.'},{question:'어떤 일이 있었나요?',answer:'오후였어요. 손녀가 자전거를 탔어요. 정말 행복했어요.'}];
 const r=park(localExperienceEvents({date,turns}));
 assert.equal(r.timeOfDay,'afternoon');assert.equal(r.activity,'자전거 타기');
 assert.equal(r.emotion.status,'provided');assert.match(r.people.find(p=>p.name==='손녀').action,/자전거/);
});

test('다른 사건의 감정을 복사하지 않고 모호한 답변은 원문에만 남긴다',()=>{
 const first={question:MEMORABLE_OPENING,answer:'오전에 병원에서 검진을 받았어요. 오후에는 손녀와 호수공원에 갔어요. 손녀가 자전거를 탔어요.'};
 const ambiguous=localExperienceEvents({date,turns:[first,{question:'그때 기분은요?',answer:'슬펐어요.'}]});
 assert.ok(ambiguous.every(event=>event.emotion.status==='not_asked'));
 const scoped=localExperienceEvents({date,turns:[first,{question:'병원에서는 어떠셨어요?',answer:'조금 걱정됐어요.'}]});
 assert.equal(scoped[0].emotion.status,'provided');assert.equal(park(scoped).emotion.status,'not_asked');
});

test('앞 대화에서 기억나지 않는다고 답한 항목을 마지막에 다시 묻지 않는다',()=>{
 const turns=[{question:MEMORABLE_OPENING,answer:'혼자 호수공원에서 산책했어요.'},{question:'그때 기분은 어떠셨어요?',answer:'잘 모르겠어요.'}];
 const r=park(localExperienceEvents({date,turns}));
 assert.equal(r.emotion.status,'unknown');assert.equal(r.collectionStatus.emotion,'unknown');
 let next=r;
 for(let i=0;i<10;i++){const q=collectionQuestion(next);if(!q)break;assert.notEqual(q.field,'emotion');next=applyCollectionAnswer(next,q.field,'없어요.');}
});

test('추가 확인 답변 하나에 함께 말한 시간·감정·사물도 받아 다음 질문을 줄인다',()=>{
 const events=localExperienceEvents({date,turns:[{question:MEMORABLE_OPENING,answer:'손녀와 호수공원에 갔어요. 손녀가 자전거를 탔어요.'}]});
 const r=applyCollectionAnswer(park(events),'action:person-self','오후에 벤치에 앉아 응원했어요. 정말 뿌듯하고 행복했어요.');
 assert.equal(r.collectionStatus.time,'provided');assert.equal(r.collectionStatus.emotion,'provided');
 assert.ok(r.objects.some(object=>object.name==='벤치'));assert.equal(collectionQuestion(r).field,'memoryCue');
 assert.equal(r.sourceEvidence.answers.length,1);
});

test('여러 사건은 공통 질문을 늘리지 않고 선택 단계로 넘기며 공원을 산책으로 가정하지 않는다',()=>{
 const reply=localReply({turns:[reportedTurns[0]]});assert.equal(reply.ready,true);assert.equal(reply.selectionReady,true);
 const single=localReply({turns:[{question:MEMORABLE_OPENING,answer:'손녀가 호수공원에서 자전거를 탔어요.'}]});
 assert.doesNotMatch(single.question,/걸으|걷|산책/);
});

test('범용 대화 모델이 표현만 바꾼 중복 질문을 내도 후처리에서 걸러낸다',()=>{
 const turns=[{question:MEMORABLE_OPENING,answer:'오후에 손녀와 호수공원에 갔어요. 손녀가 자전거를 탔고 정말 행복했어요.'}];
 for(const question of ['그때 마음은 어떠셨어요?','그 일은 언제 있었나요?','손녀는 그때 무엇을 하고 있었나요?','걸으면서 어떤 풍경을 보셨나요?']){
  const reply=filterFollowup({turns},{question,ready:false});
  assert.ok(reply.filteredQuestionReason,question);assert.notEqual(reply.question,question);
 }
});

test('AI 사건 추출이 시간·행동·감정을 빼먹어도 같은 사건의 원문 근거로 보완한다',()=>{
 const s=session();
 const extracted={events:[
  {scene:{value:'병원 방문',evidence:'오전에 병원에 다녀왔고,'},place:{name:'병원',type:'hospital',evidence:'병원에 다녀왔고'}},
  {scene:{value:'호수공원에서 자전거 타기',evidence:'오후에는 손녀와 호수공원에 갔어요.'},place:{name:'호수공원',type:'park',evidence:'호수공원에 갔어요.'},activity:{value:'자전거 타기',evidence:'손녀가 처음 보조바퀴 없이 혼자 자전거를 탔어요.'},people:[{name:'손녀',action:'',evidence:'손녀와 호수공원에 갔어요.'}]}
 ]};
 const events=sceneCandidates({title:'하루',body:originalStory,scene:originalStory},s,extracted),r=park(events);
 assert.equal(events.length,2);assert.equal(r.timeOfDay,'afternoon');assert.equal(r.emotion.status,'provided');
 assert.match(r.people.find(p=>p.name==='손녀').action,/보조바퀴 없이/);assert.equal(collectionQuestion(r).field,'action:person-self');
});

test('이전 버전의 작성 중 사건도 앞 대화를 다시 연결하며 명시적 모름은 덮어쓰지 않는다',()=>{
 const events=localExperienceEvents(session()),stale=structuredClone(park(events));
 stale.timeOfDay='unknown';stale.collectionStatus.time='not_asked';
 stale.emotion={text:'',labels:[],status:'not_asked'};stale.collectionStatus.emotion='not_asked';
 const child=stale.people.find(p=>p.name==='손녀');child.action='';stale.collectionStatus[`action:${child.id}`]='not_asked';
 const r=reconcileExperienceContext(stale,events);assert.equal(r.id,stale.id);assert.equal(r.timeOfDay,'afternoon');
 assert.equal(r.emotion.status,'provided');assert.match(r.people.find(p=>p.id===child.id).action,/보조바퀴/);
 stale.collectionStatus.time='unknown';assert.equal(reconcileExperienceContext(stale,events).collectionStatus.time,'unknown');
});

async function repeatRequest(t,fetcher){
 const server=createApp({env:{DIARY_API_KEY:'test-only'},fetcher});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return async(path,body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
}

test('HTTP: 여러 사건이나 명확한 선택 의사 뒤에는 AI에게 불필요한 질문을 요청하지 않는다',async t=>{
 let calls=0;const req=await repeatRequest(t,async()=>{calls++;throw new Error('Unexpected question request');});
 const first=await req('question',{date,turns:[reportedTurns[0]]});assert.equal(first.data.selectionReady,true);
 const chosen=await req('question',{date,turns:[reportedTurns[0],reportedTurns[2]]});assert.equal(chosen.data.selectionReady,true);
 assert.equal(calls,0);
});

test('HTTP: 대화 모델의 중복 감정 질문을 실제 응답에서 대체한다',async t=>{
 const req=await repeatRequest(t,async()=>Response.json({choices:[{message:{content:JSON.stringify({question:'그때 마음은 어떠셨어요?',ready:false})}}]}));
 const reply=await req('question',{date,turns:[{question:MEMORABLE_OPENING,answer:'손녀가 호수공원에서 자전거를 탔어요. 정말 행복했어요.'}]});
 assert.equal(reply.status,200);assert.equal(reply.data.filteredQuestionReason,'already_recorded');assert.doesNotMatch(reply.data.question,/기분|마음|감정/);
});

test('HTTP: 모델이 한 답변의 부가 정보를 누락해도 로컬에서 알아낸 내용을 버리지 않는다',async t=>{
 const answer='오후에 벤치에 앉아 응원했어요. 정말 뿌듯하고 행복했어요.';
 const req=await repeatRequest(t,async()=>Response.json({choices:[{message:{content:JSON.stringify({people:[{name:'나',action:'벤치에 앉아 응원했다',evidence:'벤치에 앉아 응원했어요.'}]})}}]}));
 const r=park(localExperienceEvents({date,turns:[{question:MEMORABLE_OPENING,answer:'손녀와 호수공원에 갔어요. 손녀가 자전거를 탔어요.'}]}));
 const response=await req('scene-answer',{candidate:r,field:'action:person-self',answer});
 assert.equal(response.status,200);assert.equal(response.data.candidate.timeOfDay,'afternoon');assert.equal(response.data.candidate.emotion.status,'provided');
 assert.equal(response.data.candidate.sourceEvidence.answers.length,1);assert.equal(response.data.nextQuestion.field,'memoryCue');
});
