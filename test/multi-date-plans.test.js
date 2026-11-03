import test from 'node:test';
import assert from 'node:assert/strict';
import {localPlans,planCandidate,validatePlans,futurePlanText,experienceTurns} from '../public/calendar.js';
import {createApp} from '../server.js';
const date='2026-11-03';
async function request(t,options={env:{}}){
 const server=createApp(options);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(r=>server.close(r)));
 return async text=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/plans`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,text})});return {status:response.status,data:await response.json()};};
}
test('한 문장에서 내일과 모레(모래 오타)의 날짜·시간·장소를 나눈다',()=>{
 const plans=localPlans({date,text:'내일 오전 11시에 치과에 가야 되고 모래 오후 2시에 은행에 가야 돼'});
 assert.deepEqual(plans.map(e=>[e.date,e.time,e.title,e.location]),[['2026-11-04','11:00','치과 방문','치과'],['2026-11-05','14:00','은행 방문','은행']]);
 const sand=localPlans({date,text:'내일 오후 2시에 모래놀이를 해야 돼요'});assert.equal(sand.length,1);assert.equal(sand[0].date,'2026-11-04');
});
test('월일·ISO·일자만 말한 날짜와 며칠 뒤를 계산한다',()=>{
 for(const [text,expected] of [['11월 10일 오후 2시에 친구를 만나요','2026-11-10'],['2026-11-12 오전 10시에 병원에 가요','2026-11-12'],['10일 오후 3시에 치과에 가요','2026-11-10'],['3일 뒤 오전 10시에 은행에 가요','2026-11-06'],['다음 달 5일 오전 10시에 은행에 가요','2026-12-05']])assert.equal(localPlans({date,text})[0].date,expected,text);
 assert.equal(localPlans({date:'2026-11-29',text:'5일에 치과에 가요'})[0].date,'2026-12-05');
 assert.equal(localPlans({date:'2026-12-30',text:'1월 5일에 치과에 가요'})[0].date,'2027-01-05');
 assert.equal(localPlans({date:'2028-02-27',text:'모레 치과에 가요'})[0].date,'2028-02-29');
});
test('요일과 다음 주의 요일을 계산하며 불명확한 날짜는 비워둔다',()=>{
 assert.equal(localPlans({date,text:'다음 주 월요일 오전 10시에 병원에 가요'})[0].date,'2026-11-09');
 assert.equal(localPlans({date,text:'이번 주 금요일 오후 2시에 은행에 가요'})[0].date,'2026-11-06');
 assert.equal(localPlans({date,text:'금요일 오후 2시에 은행에 가요'})[0].date,'2026-11-06');
 assert.equal(localPlans({date,text:'다음 주에 병원에 가요'})[0].date,'');
 assert.equal(localPlans({date,text:'11월 31일에 병원에 가요'})[0].date,'');
 const candidate=planCandidate({title:'병원 방문',date:'',time:'',location:'병원'});assert.equal(candidate.date,'');
 assert.throws(()=>planCandidate({...candidate,date:0}));
});
test('날짜가 없는 후속 일정은 같은 날짜, 서로 다른 날짜의 동일 일정은 별개 후보다',()=>{
 const same=localPlans({date,text:'모레 오전 10시에 치과에 가요. 그리고 오후 3시에 은행에 가요.'});assert.deepEqual(same.map(e=>e.date),['2026-11-05','2026-11-05']);
 const separate=localPlans({date,text:'내일 오전 11시에 치과에 가요 모레 오전 11시에 치과에 가요'});assert.equal(separate.length,2);assert.notEqual(separate[0].date,separate[1].date);
 const clocks=localPlans({date,text:'모레 오전 10시 치과 방문 오후 3시 은행 방문'});assert.deepEqual(clocks.map(e=>e.time),['10:00','15:00']);
});
test('내일 일정이 없다는 말이 모레 일정까지 지우지 않는다',()=>{
 const plans=localPlans({date,text:'내일은 일정이 없어요 모레 오전 10시에 병원에 가요'});assert.equal(plans.length,1);assert.equal(plans[0].date,'2026-11-05');
 const intro=localPlans({date,text:'일정은 내일 오전 11시에 병원에 가요'});assert.equal(intro.length,1);
});
test('전체 대화의 여러 미래 날짜를 옮기되 오늘 일기와 섞지 않는다',()=>{
 const turns=[{question:'오늘은요?',answer:'오늘 공원에서 산책했어요. 내일 오전 11시에 치과에 가요 모래 오후 2시에 은행에 가요. 11월 10일에는 친구를 만나요.'}];
 const future=futurePlanText(turns);assert.match(future,/내일/);assert.match(future,/모래/);assert.match(future,/11월 10일/);assert.doesNotMatch(future,/산책/);
 assert.deepEqual(localPlans({date,text:future}).map(e=>e.date),['2026-11-04','2026-11-05','2026-11-10']);
 const past=experienceTurns(turns)[0].answer;assert.match(past,/산책/);assert.doesNotMatch(past,/치과|은행|친구/);
});
test('AI 날짜 검증은 요청에 없는 날짜·지난 날짜·다른 날짜 누락을 잡는다',()=>{
 const base={title:'치과 방문',time:'',location:'치과'},text='내일 치과에 가요 모레 병원에 가요';
 assert.equal(validatePlans([{...base,date:'2026-11-04'},{...base,date:'2026-11-05'}],date,text).length,2);
 assert.throws(()=>validatePlans([{...base,date:'2026-11-04'}],date,text));
 assert.throws(()=>validatePlans([{...base,date:'2026-11-06'}],date,text));
 assert.throws(()=>validatePlans([{...base,date}],date));
 assert.throws(()=>validatePlans([{...base,date:'2026-11-09'}],date,'다음 주에 병원에 가요'));
});
test('한 번에 5개를 넘으면 나누어 등록하도록 안내하며 조용히 버리지 않는다',async t=>{
 const text=Array.from({length:6},(_,i)=>`11월 ${i+10}일에 병원에 가요`).join('\n');
 assert.throws(()=>localPlans({date,text}),/다섯 개/);
 const req=await request(t),result=await req(text);assert.equal(result.status,400);assert.match(result.data.error,/다섯 개/);
});
test('HTTP: 여러 날짜 일정과 명시한 날짜를 각각 반환한다',async t=>{
 const req=await request(t),result=await req('내일 오전 11시에 치과에 가요 모레 오후 2시에 은행에 가요 10일 오전 10시에는 친구를 만나요');
 assert.equal(result.status,200);assert.deepEqual(result.data.events.map(e=>e.date),['2026-11-04','2026-11-05','2026-11-10']);
});
test('AI: 계산한 날짜를 전달하고 날짜별로 장소와 제목을 보완한다',async t=>{
 let received;const req=await request(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async(url,options)=>{
 received=JSON.parse(JSON.parse(options.body).messages[1].content[0].text);
 return Response.json({choices:[{message:{content:JSON.stringify({events:[{title:'11시에 방문',date:'2026-11-04',time:'11:00',location:''},{title:'2시에 방문',date:'2026-11-05',time:'14:00',location:''}]})}}]});}});
 const result=await req('내일 오전 11시에 치과에 가요 모레 오후 2시에 은행에 가요');
 assert.equal(result.data.mode,'ai');assert.equal(received.dayAfterTomorrow,'2026-11-05');assert.equal(received.dateHints.length,2);
 assert.deepEqual(result.data.events.map(e=>[e.date,e.title,e.location]),[['2026-11-04','치과 방문','치과'],['2026-11-05','은행 방문','은행']]);
});
test('AI가 모레 일정을 누락하면 전체 날짜를 담은 대체 후보를 제공한다',async t=>{
 const req=await request(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async()=>Response.json({choices:[{message:{content:JSON.stringify({events:[{title:'치과 방문',date:'2026-11-04',time:'11:00',location:'치과'}]})}}]})});
 const result=await req('내일 오전 11시에 치과에 가요 모레 오후 2시에 병원에 가요');assert.equal(result.data.mode,'local');assert.match(result.data.notice,/후보/);assert.deepEqual(result.data.events.map(e=>e.date),['2026-11-04','2026-11-05']);
});

test('대화 중 날짜 없는 후속 시간의 일정도 놓치지 않는다',()=>{
 const turns=[{question:'오늘은요?',answer:'오늘 책을 읽었어요. 내일 오전 10시에 치과에 가요. 그리고 오후 3시에 은행에 가요. 모레 오전 11시에 병원에 가요.'}];
 const future=futurePlanText(turns),plans=localPlans({date,text:future});
 assert.deepEqual(plans.map(e=>[e.date,e.time]),[['2026-11-04','10:00'],['2026-11-04','15:00'],['2026-11-05','11:00']]);
 assert.doesNotMatch(experienceTurns(turns)[0].answer,/치과|은행|병원/);
});
