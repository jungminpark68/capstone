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
test('AI: 잘못된 날짜·시간은 버리고 확인 가능한 대체 후보를 안내한다',async t=>{
 const calls=[];let events=[{title:'치과 방문',date:'2027-01-01',time:'',location:''}];
 const req=await request(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({choices:[{message:{content:JSON.stringify({events})}}]});}});
 const good=await req('plans',{date,text:'내일 3시에 치과'});assert.equal(good.status,200);assert.equal(good.data.events[0].time,'');
 const data=JSON.parse(calls[0].messages[1].content[0].text);assert.equal(data.tomorrow,'2027-01-01');assert.equal(data.text,'내일 3시에 치과');
 events=[{...events[0],date:'2027-01-02'}];const wrongDate=await req('plans',{date,text:'내일 치과'});assert.equal(wrongDate.status,200);assert.equal(wrongDate.data.mode,'local');assert.match(wrongDate.data.notice,/확인/);assert.equal(wrongDate.data.events[0].date,'2027-01-01');
 events=[{...events[0],date:'2027-01-01',time:'99:00'}];const wrongTime=await req('plans',{date,text:'내일 치과'});assert.equal(wrongTime.status,200);assert.equal(wrongTime.data.mode,'local');assert.equal(wrongTime.data.events[0].time,'');assert.ok(wrongTime.data.diagnostic);
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

test('내일 또 오라는 말은 전체 대화에서 병원과 확인된 장소명을 연결한다',()=>{
 const turns=[{question:'병원에 갔다오셨나요?',answer:'병원에 갔다왔어요. 내일 11시에 또오래요'},{question:'의사선생님과 무슨 이야기했나요?',answer:'딱히 이야기한 것은 없었어요.'}];
 const input={date,text:'내일 11시에 또오래요',turns,todayEvents:[{...event,location:'행복병원'}]};
 const plan=localPlans(input)[0];assert.equal(plan.title,'병원 방문');assert.equal(plan.location,'행복병원');assert.equal(plan.time,'');assert.equal(plan.inferredFromContext,true);
 const generic=localPlans({...input,todayEvents:[]})[0];assert.equal(generic.location,'병원');
 const yes=localPlans({...input,turns:[{question:'행복병원에 다녀오셨나요?',answer:'네, 다녀왔어요. 내일 11시에 또오래요'}],todayEvents:[]})[0];assert.equal(yes.location,'행복병원');
 const repaired=enrichPlans([{title:'11시에 방문',date:'2027-01-01',time:'11:00',location:''}],input.text,input)[0];assert.equal(repaired.title,'병원 방문');assert.equal(repaired.location,'행복병원');assert.equal(repaired.time,'');
});
test('여러 장소나 연결 근거가 없으면 병원 일정으로 단정하지 않는다',()=>{
 const input={date,text:'내일 11시에 또오래요',turns:[],todayEvents:[event]};assert.equal(localPlans(input)[0].location,'');
 const ambiguous={...input,turns:[{question:'오늘은요?',answer:'병원에 갔다가 은행에 갔어요. 내일 11시에 또오래요'}]};assert.equal(localPlans(ambiguous)[0].location,'');
 const friend={...input,text:'내일 친구랑 또 만나기로 했어요',turns:[{question:'오늘은요?',answer:'병원에 갔어요'}]};assert.equal(localPlans(friend)[0].location,'');
});
test('HTTP: 일정 추출은 대화 전체를 AI에 전달하고 누락된 장소를 보완한다',async t=>{
 let received;const input={date,text:'내일 11시에 또오래요',turns:[{question:'병원에 갔다오셨나요?',answer:'병원에 갔다왔어요. 내일 11시에 또오래요'}],todayEvents:[{...event,location:'행복병원'}]};
 const req=await request(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async(url,options)=>{received=JSON.parse(JSON.parse(options.body).messages[1].content[0].text);return Response.json({choices:[{message:{content:JSON.stringify({events:[{title:'11시에 방문',date:'2027-01-01',time:null,location:null,completed:true}]})}}]});}});
 const result=await req('plans',input);assert.equal(result.status,200);assert.deepEqual(received.turns,input.turns);assert.equal(received.todayEvents[0].location,'행복병원');assert.equal(result.data.events[0].location,'행복병원');assert.equal(result.data.events[0].title,'병원 방문');assert.equal(result.data.events[0].time,'');assert.equal('completed' in result.data.events[0],false);
});
test('HTTP: AI 연결 실패도 일정 후보를 확인할 수 있고 오류 원문은 노출하지 않는다',async t=>{
 const req=await request(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async()=>{throw new Error('private-token sensitive failure');}});
 const result=await req('plans',{date,text:'내일 치과에서 오전 11시에 오라고 했어요'});assert.equal(result.status,200);assert.equal(result.data.mode,'local');assert.equal(result.data.events[0].location,'치과');assert.equal(result.data.events[0].time,'11:00');assert.match(result.data.notice,/AI/);assert.doesNotMatch(JSON.stringify(result.data),/private-token|sensitive/);
});
test('HTTP: 일정 문맥과 완료 상태 입력을 검증한다',async t=>{
 const req=await request(t),input={date,text:'내일 또 오래요'};
 for(const extra of [{turns:[{question:'질문',answer:1}]},{turns:Array(9).fill({question:'q',answer:'a'})},{todayEvents:[{...event,completed:'yes'}]},{todayEvents:[{...event,date:'2027-01-01'}]}])assert.equal((await req('plans',{...input,...extra})).status,400);
});
test('완료한 일정은 첫 질문에서 다시 수행 여부를 묻지 않는다',()=>{
 const first=localReply({turns:[],todayEvents:[{...event,completed:true},{...event,title:'은행 방문',completed:false}]});assert.match(first.question,/은행 방문/);assert.doesNotMatch(first.question,/병원/);
 const all=localReply({turns:[],todayEvents:[{...event,completed:true}]});assert.doesNotMatch(all.question,/실제로|병원/);
});
