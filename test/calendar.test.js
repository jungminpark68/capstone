import test from 'node:test';
import assert from 'node:assert/strict';
import {nextDate,calendarEvent,validDate,localPlans,experienceTurns} from '../public/calendar.js';
import {localReply,localDraft} from '../diary.js';
import {newSession,restorable} from '../public/state.js';
import {createApp} from '../server.js';
const date='2026-12-31';
const event={title:'병원 방문',date,time:'10:00',location:'동네 병원'};
async function request(t,options={env:{}}){
 const server=createApp(options);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(r=>server.close(r)));
 return async(path,data)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
}
test('내일 날짜는 월말·연말·윤년을 처리하고 잘못된 날짜는 거절한다',()=>{
 assert.equal(nextDate(date),'2027-01-01');assert.equal(nextDate('2028-02-28'),'2028-02-29');assert.equal(nextDate('2026-02-28'),'2026-03-01');assert.equal(validDate('2026-02-30'),false);
 assert.throws(()=>calendarEvent({...event,time:'25:00'}));assert.throws(()=>calendarEvent({...event,title:' '}));
});
test('캘린더 첫 질문은 예정과 실제를 구분하고 답변이 바뀌면 실제 경험을 따른다',()=>{
 const first=localReply({turns:[],todayEvents:[event]});assert.match(first.question,/병원 방문/);assert.match(first.question,/실제로/);
 const next=localReply({todayEvents:[event],turns:[{question:first.question,answer:'병원은 취소하고 딸과 공원에서 산책했어요.'}]});
 assert.doesNotMatch(next.question,/병원|누구/);assert.match(next.question,/걸으면서/);
});
test('체험 일정 추출은 여러 일정과 명시된 시간만 사용한다',()=>{
 const events=localPlans({date,text:'내일 오후 3시 반에 치과에 가요. 그리고 오전 10시에 친구를 만나요.'});assert.equal(events.length,2);assert.equal(events[0].date,'2027-01-01');assert.equal(events[0].time,'15:30');assert.equal(events[1].time,'10:00');assert.equal(localPlans({date,text:'내일 밤 12시에 약 먹기'})[0].time,'00:00');
 assert.equal(localPlans({date,text:'내일 3시에 치과에 가요.'})[0].time,'');assert.deepEqual(localPlans({date,text:'내일은 아직 모르겠어요.'}),[]);assert.deepEqual(localPlans({date,text:'모레 병원에 가요.'}),[]);assert.deepEqual(localPlans({date,text:'내일 일정은 없어요.'}),[]);
});
test('내일 계획과 예정 정보는 체험 일기에서 제외한다',()=>{
 const turns=[{question:'병원 다녀오셨나요?',answer:'오늘 공원에서 산책했어요. 그리고 내일 오후 3시에 치과에 가요.'}];
 const draft=localDraft(turns);assert.match(draft.body,/산책/);assert.doesNotMatch(draft.body,/치과|내일|병원/);assert.equal(experienceTurns(turns).length,1);
 assert.throws(()=>localDraft([{question:'오늘은요?',answer:'내일 병원에 가요.'}]));
 const mixed=localDraft([{question:'오늘은요?',answer:'오늘 산책했고 내일 병원에 가요'}]);assert.match(mixed.body,/산책/);assert.doesNotMatch(mixed.body,/병원/);
});
test('내일 일정 입력·수정 중인 상태는 복원하고 기존 세션도 지원한다',()=>{
 const state=newSession(date);state.stage='tomorrow';state.planCandidates=[{id:'draft',title:'',date:'',time:'',location:''}];assert.equal(restorable(state),true);
 const legacy=newSession(date);delete legacy.planCandidates;delete legacy.todayEvents;assert.equal(restorable(legacy),true);
});
test('HTTP: 일정 기반 시작, 내일 추출, 경험 분리와 입력 오류',async t=>{
 const req=await request(t);
 const first=await req('question',{date,todayEvents:[event],turns:[]});assert.equal(first.status,200);assert.match(first.data.question,/병원 방문/);
 const plans=await req('plans',{date,text:'내일 오후 3시에 치과에 가요.'});assert.equal(plans.status,200);assert.equal(plans.data.events[0].time,'15:00');
 const draft=await req('draft',{date,todayEvents:[event],turns:[{question:first.data.question,answer:'집에서 책을 읽었어요. 내일 치과에 가요.'}]});assert.equal(draft.status,200);assert.doesNotMatch(draft.data.body,/치과|병원/);
 for(const data of [{date:'2026-02-30',text:'치과'},{date,text:''},{date,text:'a'.repeat(2001)}])assert.equal((await req('plans',data)).status,400);
 assert.equal((await req('question',{date:'2027-01-01',turns:[],todayEvents:[event]})).status,400);
});
test('AI: 일정은 데이터로 전달하고 다른 날짜·잘못된 시간을 반환하면 거절한다',async t=>{
 const calls=[];let events=[{title:'치과 방문',date:'2027-01-01',time:'',location:''}];
 const req=await request(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({choices:[{message:{content:JSON.stringify({events})}}]});}});
 const good=await req('plans',{date,text:'내일 3시에 치과'});assert.equal(good.status,200);assert.equal(good.data.events[0].time,'');
 const data=JSON.parse(calls[0].messages[1].content[0].text);assert.equal(data.tomorrow,'2027-01-01');assert.equal(data.text,'내일 3시에 치과');
 events=[{...events[0],date:'2027-01-02'}];assert.equal((await req('plans',{date,text:'내일 치과'})).status,502);
 events=[{...events[0],date:'2027-01-01',time:'99:00'}];assert.equal((await req('plans',{date,text:'내일 치과'})).status,502);
});
test('AI: 캘린더 예정은 별도 맥락, 내일 발언은 초안 입력에서 제외',async t=>{
 const calls=[];
 const req=await request(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async(url,options)=>{const payload=JSON.parse(options.body);calls.push(payload);return Response.json({choices:[{message:{content:JSON.stringify(payload.messages[0].content.includes('초안을 만든다')?{title:'산책',body:'오늘 공원을 걸었다.',scene:'공원 산책'}:{question:'산책할 때 어떤 풍경이 보였나요?',ready:false})}}]});}});
 await req('question',{date,todayEvents:[event],turns:[{question:'오늘은요?',answer:'병원은 안 가고 산책했어요.'}]});
 const context=JSON.parse(calls[0].messages[1].content[0].text);assert.equal(context.todayEvents[0].title,event.title);assert.match(context.turns[0].answer,/안 가고/);
 await req('draft',{date,todayEvents:[event],turns:[{question:'오늘은요?',answer:'오늘 공원을 걸었어요. 내일 병원에 가요.'}]});
 const draft=JSON.parse(calls[1].messages[1].content[0].text);assert.doesNotMatch(draft.turns[0].answer,/내일/);
});
