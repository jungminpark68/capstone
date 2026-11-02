import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationGuard,localReply} from '../public/conversation.js';
import {createApp} from '../server.js';
const story={question:'병원에 갔다오셨나요?',answer:'병원에 갔다왔어요. 내일 11시에 또오래요'};
test('딱히 이야기하지 않았다는 답에는 원인·분위기를 캐묻지 않고 주제를 바꾼다',()=>{
 const turns=[story,{question:'의사선생님과 무슨 이야기했나요?',answer:'의사선생님과 딱히 이야기한 것은 없었어요.'}];
 const reply=localReply({turns});assert.equal(reply.topicShift,true);assert.match(reply.question,/다른 일/);assert.doesNotMatch(reply.question,/분위기|의사|대처|왜/);
 const end=conversationGuard({turns:[...turns,{question:reply.question,answer:'딱히 없어요.'}]});assert.equal(end.ready,true);assert.doesNotMatch(end.question,/다른 일/);
});
test('불편하거나 무거웠다는 답은 감정·대처 질문 대신 전환하고 반복 신호에는 마무리한다',()=>{
 const reply=conversationGuard({turns:[story,{question:'분위기는요?',answer:'분위기는 좀 무거웠어요.'}]});assert.equal(reply.topicShift,true);assert.doesNotMatch(reply.question,/대처|감정|무거/);
 const end=conversationGuard({turns:[story,{question:'진료는요?',answer:'딱히 이야기할 것은 없어요.'},{question:'분위기는요?',answer:'무거웠어요.'}]});assert.equal(end.ready,true);
});
test('사용자가 새로운 경험을 말하면 전환 뒤에도 대화를 이어갈 수 있다',()=>{
 const first=conversationGuard({turns:[story,{question:'진료는요?',answer:'딱히 없었어요.'}]});
 assert.equal(conversationGuard({turns:[story,{question:first.question,answer:'그냥 집에서 딸과 맛있는 국수를 먹었어요.'}]}),null);
 const stop=conversationGuard({turns:[{question:'오늘은요?',answer:'말하고 싶지 않아요.'},{question:first.question,answer:'아니요.'}]});assert.equal(stop.rest,true);
});
test('HTTP: AI가 깊은 질문을 만들기 전에 거절 신호를 처리한다',async t=>{
 let calls=0;const server=createApp({env:{DIARY_API_KEY:'test-only'},fetcher:async()=>{calls++;throw new Error('AI must not probe');}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(r=>server.close(r)));
 const r=await fetch(`http://127.0.0.1:${server.address().port}/api/question`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({turns:[story,{question:'의사 선생님과요?',answer:'딱히 이야기한 건 없어요.'}]})});
 assert.equal(r.status,200);assert.equal((await r.json()).topicShift,true);assert.equal(calls,0);
});
