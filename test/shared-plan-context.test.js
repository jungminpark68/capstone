import test from 'node:test';
import assert from 'node:assert/strict';
import {localPlans,planCandidate,planDateHints,futurePlanText} from '../public/calendar.js';
import {newSession,restorable} from '../public/state.js';
import {createApp} from '../server.js';
const date='2026-11-03',phrase='내일이랑 모레 그리고19일날 병원에 오래 1시에';
async function request(t,fetcher){
 const server=createApp(fetcher?{env:{DIARY_API_KEY:'test-only'},fetcher}:{env:{}});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(r=>server.close(r)));
 return async text=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/plans`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,text})});return {status:r.status,data:await r.json()};};
}
test('보고된 문장은 날짜 세 개가 병원 방문과 1시를 공유한다',()=>{
 const plans=localPlans({date,text:phrase});assert.equal(plans.length,3);
 assert.deepEqual(plans.map(e=>[e.date,e.title,e.location]),[['2026-11-04','병원 방문','병원'],['2026-11-05','병원 방문','병원'],['2026-11-19','병원 방문','병원']]);
 assert.ok(plans.every(e=>e.time===''&&e.pendingTime.hour===1&&e.pendingTime.minute===0));assert.equal(new Set(plans.map(e=>e.pendingTime.group)).size,1);
 assert.equal(planDateHints({date,text:phrase}).length,3);
});
test('띄어쓰기·쉼표·조사·끝에 붙은 시간의 변형에서도 같은 행동을 연결한다',()=>{
 for(const text of ['내일, 모레, 19일에 병원에 오전 1시에 가요','내일하고 모레랑 19일날 오전 1시에 병원 가야 돼요','내일이랑 모래 그리고 19일날 병원에 오후 1시에 가야 돼요','병원에 내일이랑 모레 그리고 19일날 오후 1시에 가야 돼요']){
  const plans=localPlans({date,text});assert.equal(plans.length,3,text);assert.ok(plans.every(e=>e.title==='병원 방문'&&e.location==='병원'),text);assert.ok(plans.every(e=>e.time===plans[0].time&&e.time!==''),text);
 }
});
test('같은 병원이어도 날짜마다 말한 서로 다른 시간을 유지한다',()=>{
 const plans=localPlans({date,text:'내일 오전 10시 모레 오후 2시에 병원가야되고 19일 저녁 6시에 식당 예약되어있어서 가야 돼'});
 assert.deepEqual(plans.map(e=>[e.date,e.time,e.title,e.location]),[['2026-11-04','10:00','병원 방문','병원'],['2026-11-05','14:00','병원 방문','병원'],['2026-11-19','18:00','식당 예약','식당']]);
});
test('다른 행동이 시작되면 앞뒤 장소와 시간을 서로 복사하지 않는다',()=>{
 const plans=localPlans({date,text:'내일이랑 모레 병원에 오전 11시에 가고 19일은 은행에 오후 2시에 가요'});
 assert.deepEqual(plans.map(e=>[e.time,e.location,e.title]),[['11:00','병원','병원 방문'],['11:00','병원','병원 방문'],['14:00','은행','은행 방문']]);
 const distinct=localPlans({date,text:'내일 오전 9시 치과에 가고 모레 오후 2시 병원에 가고 19일 저녁 6시에 식당 예약이 있어요'});
 assert.deepEqual(distinct.map(e=>[e.time,e.location]),[['09:00','치과'],['14:00','병원'],['18:00','식당']]);
});
test('모호한 시간도 날짜마다 따로 말했으면 하나의 시간으로 덮어쓰지 않는다',()=>{
 const plans=localPlans({date,text:'내일 1시 모레 2시에 병원에 가야 돼요'});
 assert.deepEqual(plans.map(e=>e.pendingTime.hour),[1,2]);assert.notEqual(plans[0].pendingTime.group,plans[1].pendingTime.group);
});
test('목적 없는 접속사는 일정이 아니고, 또는로 말한 날짜는 선택이 필요하다',()=>{
 assert.deepEqual(localPlans({date,text:'내일이랑 모레 그리고19일'}),[]);
 const alternatives=localPlans({date,text:'내일 또는 모레 병원에 오전 11시에 가요'});assert.equal(alternatives.length,1);assert.equal(alternatives[0].date,'');
});
test('대화에서 일정 단계로 옮겨도 공유 문맥과 날짜 세 개를 유지한다',()=>{
 const text=futurePlanText([{question:'오늘은요?',answer:'오늘 산책했어요. '+phrase}]),plans=localPlans({date,text});assert.equal(plans.length,3);assert.ok(plans.every(e=>e.title==='병원 방문'&&e.pendingTime.hour===1));
});
test('공통 시간 확인 정보는 후보 복원에서 보존하고 잘못된 형식은 거절한다',()=>{
 const plans=localPlans({date,text:phrase}).map((p,i)=>({...planCandidate(p),id:`p-${i}`}));
 const state=newSession(date);state.stage='tomorrow';state.planCandidates=plans;assert.equal(restorable(state),true);assert.deepEqual(planCandidate(plans[0]).pendingTime,plans[0].pendingTime);
 assert.throws(()=>planCandidate({...plans[0],pendingTime:{hour:99,minute:0,group:'bad'}}));state.planCandidates[0].pendingTime.hour=99;assert.ok(!restorable(state));
});
test('HTTP: 체험 모드에서 세 일정과 공통 시간 확인 정보를 반환한다',async t=>{
 const req=await request(t),result=await req(phrase);assert.equal(result.status,200);assert.equal(result.data.events.length,3);assert.ok(result.data.events.every(e=>e.title==='병원 방문'&&e.pendingTime.hour===1));
});
test('AI가 다시 두 개만 반환해도 빠진 날짜를 포함한 후보로 복구한다',async t=>{
 const req=await request(t,async()=>Response.json({choices:[{message:{content:JSON.stringify({events:[{title:'이랑',date:'2026-11-04',time:'',location:''},{title:'날 병원에 오래 1시에',date:'2026-11-19',time:'',location:''}]})}}]}));
 const result=await req(phrase);assert.equal(result.data.mode,'local');assert.equal(result.data.events.length,3);assert.ok(result.data.events.every(e=>e.title==='병원 방문'&&e.location==='병원'&&e.pendingTime.hour===1));
});
test('AI의 조사 제목과 시간 추측도 원문이 공유한 병원 방문과 시간 확인으로 보완한다',async t=>{
 const events=['2026-11-04','2026-11-05','2026-11-19'].map(date=>({title:'이랑',date,time:'01:00',location:''}));
 const req=await request(t,async()=>Response.json({choices:[{message:{content:JSON.stringify({events})}}]}));
 const result=await req(phrase);assert.equal(result.data.mode,'ai');assert.equal(result.data.events.length,3);assert.ok(result.data.events.every(e=>e.title==='병원 방문'&&e.location==='병원'&&e.time===''&&e.pendingTime.hour===1));
});
