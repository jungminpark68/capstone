import test from 'node:test';
import assert from 'node:assert/strict';
import {localPlans,planCandidate,validatePlans,enrichPlans,calendarEvent,futurePlanText,experienceTurns} from '../public/calendar.js';
import {newSession,restorable} from '../public/state.js';
import {createApp} from '../server.js';
const date='2026-11-03',phrase='내일 1시그리고 5시에 병원가야돼';
const plans=text=>localPlans({date,text});
const fields=events=>events.map(e=>[e.date,e.time,e.title,e.location]);
async function request(t,events){
 const options=events===undefined?{env:{}}:{env:{DIARY_API_KEY:'test-only'},fetcher:async()=>Response.json({choices:[{message:{content:JSON.stringify({events})}}]})};
 const server=createApp(options);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(r=>server.close(r)));
 return async text=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/plans`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,text})});return {status:response.status,...await response.json()};};
}
test('같은 날 1시와 5시 방문은 두 후보와 독립적인 오전·오후 확인을 만든다',()=>{
 for(const text of [phrase,'내일 1시 그리고 5시에 병원 가야 돼요','내일 1시, 5시에 병원에 가요','내일 병원에 1시랑 5시에 가요']){
  const events=plans(text);assert.deepEqual(fields(events),[['2026-11-04','','병원 방문','병원'],['2026-11-04','','병원 방문','병원']],text);
  assert.deepEqual(events.map(e=>e.pendingTime.hour),[1,5]);assert.notEqual(events[0].pendingTime.group,events[1].pendingTime.group);
 }
});
test('시·분·24시간 표기와 같은 나열 안의 오전·오후를 보존한다',()=>{
 for(const [text,times] of [['내일 오후 1시랑 5시에 병원 가요',['13:00','17:00']],['내일 오후 1시 반 그리고 5시 30분에 병원 가요',['13:30','17:30']],['내일 13:00, 17:00 병원 가요',['13:00','17:00']],['내일 오전 12시와 오후 12시에 병원 가요',['00:00','12:00']]])assert.deepEqual(plans(text).map(e=>e.time),times,text);
});
test('여러 날짜와 여러 시간의 공통 방문을 빠짐없이 조합한다',()=>{
 const events=plans('내일이랑 모레 오후 1시랑 5시에 병원 가요');assert.deepEqual(events.map(e=>[e.date,e.time]),[['2026-11-04','13:00'],['2026-11-04','17:00'],['2026-11-05','13:00'],['2026-11-05','17:00']]);assert.ok(events.every(e=>e.location==='병원'));
 const ambiguous=plans('내일이랑 모레 1시랑 5시에 병원 가요');assert.equal(ambiguous.length,4);assert.equal(ambiguous[0].pendingTime.group,ambiguous[2].pendingTime.group);assert.equal(ambiguous[1].pendingTime.group,ambiguous[3].pendingTime.group);assert.notEqual(ambiguous[0].pendingTime.group,ambiguous[1].pendingTime.group);
});
test('다른 장소·행동에는 공통 시간대를 옮기지 않고 이후 날짜도 유지한다',()=>{
 const events=plans('내일 오후 1시 병원가고 5시에 은행가요 모레 오전 10시에 식당 예약했어요');
 assert.deepEqual(fields(events),[['2026-11-04','13:00','병원 방문','병원'],['2026-11-04','','은행 방문','은행'],['2026-11-05','10:00','식당 예약','식당']]);assert.equal(events[1].pendingTime.hour,5);
});
test('문장이 달라지면 다른 시각을 한 번의 확인으로 묶지 않는다',()=>{
 const events=plans('내일 1시랑5시에 병원 가요. 2시랑6시에 은행 가요.');assert.equal(events.length,4);assert.equal(new Set(events.map(e=>e.pendingTime.group)).size,4);assert.deepEqual(events.map(e=>e.pendingTime.hour),[1,5,2,6]);
 const untimed=plans('내일 오후1시 병원 가요 그리고 은행 가요');assert.deepEqual(untimed.map(e=>[e.time,e.location]),[['13:00','병원'],['','은행']]);
});
test('시간 범위는 시작 시간과 원래 범위를 남긴 한 일정이다',()=>{
 for(const text of ['내일 오후 1시부터 5시까지 병원에 있어요','내일 오후 1시~5시 병원에 가요']){
  const events=plans(text);assert.equal(events.length,1);assert.equal(events[0].time,'13:00');assert.equal(events[0].title,'병원 방문');assert.match(events[0].scheduleNote,/1시.*5시/);
 }
 const mixed=plans('내일 오후 1시부터 5시까지 병원에 있고 오후 6시 식당 예약했어요');assert.deepEqual(mixed.map(e=>[e.time,e.location]),[['13:00','병원'],['18:00','식당']]);assert.ok(mixed[0].scheduleNote);assert.equal(mixed[1].scheduleNote,undefined);
});
test('또는·아니면은 두 번 방문으로 확정하지 않고 시간 선택 메모를 남긴다',()=>{
 for(const join of ['또는','아니면','혹은']){const events=plans(`내일 1시 ${join} 5시에 병원 가요`);assert.equal(events.length,1);assert.equal(events[0].time,'');assert.match(events[0].scheduleNote,/1시.*5시/);assert.equal(events[0].title,'병원 방문');}
});
test('명확한 시간·날짜 정정은 변경된 후보만 남긴다',()=>{
 for(const text of ['내일 1시에 병원 예약했는데 5시로 변경됐어요','내일 1시에서 5시로 병원 예약 바꿨어요']){const events=plans(text);assert.equal(events.length,1);assert.equal(events[0].pendingTime.hour,5);assert.equal(events[0].location,'병원');}
 const changedPlace=plans('내일 1시에 병원 말고 5시에 식당 가요');assert.equal(changedPlace.length,1);assert.equal(changedPlace[0].location,'식당');assert.equal(changedPlace[0].pendingTime.hour,5);
 const changedDay=plans('내일 말고 모레 오전 10시에 병원 가요');assert.equal(changedDay.length,1);assert.equal(changedDay[0].date,'2026-11-05');
});
test('뒤의 시간만 정정하면 그보다 앞의 독립된 일정은 유지한다',()=>{
 const events=plans('내일 오전9시 은행 가고 1시에 병원 말고 5시에 식당 가요');assert.equal(events.length,2);assert.equal(events[0].time,'09:00');assert.equal(events[0].location,'은행');assert.equal(events[1].location,'식당');assert.equal(events[1].pendingTime.hour,5);
});
test('다른 일정에 붙은 변경·취소가 앞뒤의 독립된 일정을 덮어쓰지 않는다',()=>{
 assert.deepEqual(plans('내일 오후 1시 병원가고 오후 5시 식당 예약 변경됐어요').map(e=>[e.time,e.location]),[['13:00','병원'],['17:00','식당']]);
 for(const text of ['내일 병원에 안 가고 오후 5시에 식당가요','내일 오전 10시 병원 예약 취소하고 오후 5시 식당가요']){const events=plans(text);assert.equal(events.length,1);assert.equal(events[0].location,'식당');assert.equal(events[0].time,'17:00');}
 assert.equal(plans('내일 병원 예약 취소하고 은행 가요')[0].location,'은행');
});
test('취소·불참·예약하지 않았다는 말은 새 방문으로 만들지 않는다',()=>{
 for(const text of ['내일 병원 예약 취소했어요','내일 병원 안 가요','내일 병원 가지 않아요','내일 병원 예약 안 했어요'])assert.deepEqual(plans(text),[],text);
 for(const text of ['내일 병원 예약 취소 안 했어요','내일 은행에 예약 취소하러 가요'])assert.equal(plans(text).length,1,text);
});
test('잘못된 숫자 시간은 추측 대신 빈 시간과 확인 메모를 반환한다',()=>{
 for(const clock of ['25시','13시 90분','99:99','오후 13시']){const event=plans(`내일 ${clock} 병원 가요`)[0];assert.equal(event.time,'');assert.match(event.scheduleNote,/올바른 시간이 아니/);assert.equal(event.location,'병원');}
});
test('같은 날 여러 시간·행동을 AI가 누락하거나 중복하면 검증에서 잡는다',()=>{
 const event={title:'병원 방문',date:'2026-11-04',time:'',location:'병원'};
 assert.throws(()=>validatePlans([event],date,phrase));assert.equal(validatePlans([event,event],date,phrase).length,2);
 assert.throws(()=>validatePlans([event,event],date,'내일 오후1시부터5시까지 병원에 있어요'));
 assert.throws(()=>validatePlans([event],date,'내일 병원 예약 취소했어요'));
 assert.throws(()=>validatePlans([event],date,'내일 병원 가요 그리고 은행 가요'));
});
test('AI가 순서를 바꾸거나 오전·오후를 추측해도 원문 시각과 장소로 연결한다',()=>{
 const events=[{title:'병원 방문',date:'2026-11-04',time:'05:00',location:'병원'},{title:'병원 방문',date:'2026-11-04',time:'01:00',location:'병원'}];
 const enriched=enrichPlans(events,phrase,{date});assert.deepEqual(enriched.map(e=>e.pendingTime.hour),[5,1]);assert.ok(enriched.every(e=>e.time===''));
 const named=enrichPlans([{title:'치과 방문',date:'2026-11-04',time:'10:00',location:'잘못된치과'}],'내일 행복치과에 오전10시 가요',{date});assert.equal(named[0].location,'행복치과');
});
test('한 절의 여러 활동을 AI가 추가 분리하면 허용하고 한 장소로 덮어쓰지 않는다',()=>{
 const text='내일 병원 갔다가 은행 가야 돼요',events=[{title:'병원 방문',date:'2026-11-04',time:'',location:'병원'},{title:'은행 방문',date:'2026-11-04',time:'',location:'은행'}];
 assert.equal(validatePlans(events,date,text).length,2);assert.deepEqual(enrichPlans(events,text,{date}),events);assert.match(plans(text)[0].title,/병원.*은행/);
});
test('장소가 없는 행동도 AI 모드에서 각 시간의 확인 정보를 유지한다',()=>{
 const text='내일 1시 그리고5시에 약 먹어요',events=[{title:'약 먹기',date:'2026-11-04',time:'',location:''},{title:'약 먹기',date:'2026-11-04',time:'',location:''}];
 const result=enrichPlans(events,text,{date});assert.deepEqual(result.map(e=>e.pendingTime.hour),[1,5]);assert.ok(result.every(e=>e.location===''));
});
test('대화에서 옮긴 시간 나열과 확인 메모·독립 시간 선택 상태를 복원한다',()=>{
 const turns=[{question:'오늘은요?',answer:'오늘 책을 읽었어요. '+phrase}],text=futurePlanText(turns);assert.equal(plans(text).length,2);assert.doesNotMatch(experienceTurns(turns)[0].answer,/병원|5시/);
 for(const source of [phrase,'내일 오후1시부터5시까지 병원에 있어요','내일 1시 또는5시에 병원 가요']){const state=newSession(date);state.stage='tomorrow';state.planCandidates=plans(source).map((e,i)=>({...planCandidate(e),id:`p-${i}`}));assert.equal(restorable(state),true);}
 assert.throws(()=>calendarEvent({title:'병원',date:'2026-11-04',time:'',location:'',scheduleNote:'x'.repeat(301)}));
});
test('최대 개수는 날짜와 시간을 합쳐 계산하고 초과분을 조용히 버리지 않는다',async t=>{
 const text='내일 모레 글피 오후1시랑5시에 병원 가요';assert.throws(()=>plans(text),/다섯 개/);const req=await request(t);assert.equal((await req(text)).status,400);
});
test('HTTP: 체험 모드도 같은 날의 두 시간과 장소를 따로 반환한다',async t=>{
 const req=await request(t),result=await req(phrase);assert.equal(result.status,200);assert.equal(result.events.length,2);assert.deepEqual(result.events.map(e=>e.pendingTime.hour),[1,5]);assert.ok(result.events.every(e=>e.title==='병원 방문'&&e.location==='병원'));
});
test('HTTP: AI가 한 시간만 반환하면 두 시간을 갖춘 대체 후보를 안내한다',async t=>{
 const req=await request(t,[{title:'병원 방문',date:'2026-11-04',time:'01:00',location:'병원'}]),result=await req(phrase);assert.equal(result.mode,'local');assert.ok(result.notice);assert.equal(result.events.length,2);assert.deepEqual(result.events.map(e=>e.pendingTime.hour),[1,5]);
});
test('HTTP: AI의 범위 중복과 취소된 방문 추가를 대체 후보로 보완한다',async t=>{
 const event={title:'병원 방문',date:'2026-11-04',time:'13:00',location:'병원'},req=await request(t,[event,event]);
 const range=await req('내일 오후1시부터5시까지 병원에 있어요');assert.equal(range.mode,'local');assert.equal(range.events.length,1);assert.match(range.events[0].scheduleNote,/1시.*5시/);
 const cancelled=await req('내일 병원 예약 취소했어요');assert.equal(cancelled.mode,'local');assert.deepEqual(cancelled.events,[]);
});
