import test from 'node:test';
import assert from 'node:assert/strict';
import {nextDate,calendarEvent,validDate,localPlans,experienceTurns,enrichPlans,monthDays,shiftMonth} from '../public/calendar.js';
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

test('전달받은 치과 예약은 짧은 방문 제목과 명시한 장소로 정리한다',()=>{
 const plan=localPlans({date,text:'내일 치과에서 11시에 와야된데요'})[0];
 assert.deepEqual(plan,{title:'치과 방문',date:'2027-01-01',time:'',location:'치과'});
 const named=localPlans({date,text:'내일 행복치과에서 오전 11시에 오라고 했어요'})[0];
 assert.equal(named.title,'치과 방문');assert.equal(named.location,'행복치과');assert.equal(named.time,'11:00');
 const hospital=localPlans({date,text:'내일 병원에 오후 2시에 가야 돼요'})[0];assert.equal(hospital.title,'병원 방문');assert.equal(hospital.location,'병원');
});
test('장소가 없는 일정은 추측하지 않고 근무와 방문을 구분한다',()=>{
 const unknown=localPlans({date,text:'내일 11시에 와야된데요'})[0];assert.equal(unknown.location,'');
 const work=localPlans({date,text:'내일 치과에서 일해요'})[0];assert.equal(work.location,'치과');assert.notEqual(work.title,'치과 방문');
 const separate=localPlans({date,text:'내일 행복치과에 오전 11시에 가요. 그리고 은행에 오후 2시에 가요.'});
 assert.deepEqual(separate.map(e=>e.location),['행복치과','은행']);
});
test('AI 보완은 원문에서만 장소를 채우고 구체적인 할 일과 여러 장소를 보존한다',()=>{
 const base={title:'내일 11시에 와야됨',date:'2027-01-01',time:'',location:''};
 assert.deepEqual(enrichPlans([base],'내일 치과에서 11시에 와야된데요')[0],{...base,title:'치과 방문',location:'치과'});
 const specific=enrichPlans([{...base,title:'스케일링'}],'내일 행복치과에 오후 3시에 스케일링 예약했어요')[0];assert.equal(specific.title,'스케일링');assert.equal(specific.location,'행복치과');
 const multiple=enrichPlans([{...base,title:'치과 방문'},{...base,title:'은행 방문'}],'내일 치과에서 오전 11시에 와야된대요. 그리고 은행에 오후 2시에 가요.');assert.deepEqual(multiple.map(e=>e.location),['치과','은행']);
 const ambiguous=enrichPlans([base],'내일 치과에서 11시에 와야된대요. 그리고 은행에 가요.')[0];assert.equal(ambiguous.location,'');
});
test('HTTP: 체험·모의 AI 모두 치과 발언에서 장소 누락과 모호한 제목을 보완한다',async t=>{
 const body={date,text:'내일 치과에서 11시에 와야된데요'};
 const local=await request(t);const result=await local('plans',body);assert.equal(result.status,200);assert.equal(result.data.events[0].title,'치과 방문');assert.equal(result.data.events[0].location,'치과');
 const ai=await request(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async()=>Response.json({choices:[{message:{content:JSON.stringify({events:[{title:'내일 11시에 와야됨',date:'2027-01-01',time:'',location:''}]})}}]})});
 const repaired=await ai('plans',body);assert.equal(repaired.status,200);assert.equal(repaired.data.events[0].title,'치과 방문');assert.equal(repaired.data.events[0].location,'치과');assert.equal(repaired.data.events[0].time,'');
});

test('월간 달력은 요일에 맞춰 모든 날짜를 한 번씩 표시하고 윤년을 처리한다',()=>{
 const days=monthDays('2028-02-10'),dates=days.filter(Boolean);
 assert.equal(dates.length,29);assert.equal(new Set(dates).size,29);assert.equal(days.length%7,0);assert.equal(days.indexOf('2028-02-01'),2);
 assert.equal(dates[0],'2028-02-01');assert.equal(dates.at(-1),'2028-02-29');
 const november=monthDays('2026-11-02');assert.equal(november[0],'2026-11-01');assert.equal(november.filter(Boolean).length,30);
 assert.throws(()=>monthDays('2026-02-30'));
});
test('이전·다음 달 이동은 월말 날짜를 보정하고 연도를 넘긴다',()=>{
 assert.equal(shiftMonth('2026-01-31',1),'2026-02-28');assert.equal(shiftMonth('2028-03-31',-1),'2028-02-29');assert.equal(shiftMonth('2026-12-15',1),'2027-01-15');assert.equal(shiftMonth('2026-01-01',-1),'2025-12-01');
});
