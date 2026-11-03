// Calendar dates belong to the user's browser, never UTC timestamps.
export function validDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(`${value}T12:00:00`);
 return !Number.isNaN(date.getTime())&&`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`===value;
}
export function nextDate(value,days=1){
 if(!validDate(value))throw new Error('날짜를 확인해 주세요.');
 const date=new Date(`${value}T12:00:00`);date.setDate(date.getDate()+days);
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function shiftMonth(value,offset){
 if(!validDate(value))throw new Error('날짜를 확인해 주세요.');
 const date=new Date(`${value}T12:00:00`),day=date.getDate();
 date.setDate(1);date.setMonth(date.getMonth()+offset);
 const last=new Date(date.getFullYear(),date.getMonth()+1,0,12).getDate();date.setDate(Math.min(day,last));
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function monthDays(value){
 if(!validDate(value))throw new Error('날짜를 확인해 주세요.');
 const first=value.slice(0,8)+'01',date=new Date(`${first}T12:00:00`);
 const count=new Date(date.getFullYear(),date.getMonth()+1,0,12).getDate();
 const days=Array(date.getDay()).fill(null);
 for(let i=0;i<count;i++)days.push(nextDate(first,i));
 while(days.length%7)days.push(null);
 return days;
}
export function calendarEvent(value){
 if(!value||typeof value.title!=='string'||!value.title.trim()||value.title.length>100||!validDate(value.date)||typeof value.time!=='string'||(value.time!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time))||typeof value.location!=='string'||value.location.length>200)throw new Error('일정의 이름, 날짜, 시간과 장소를 확인해 주세요.');
 if(value.completed!==undefined&&typeof value.completed!=='boolean')throw new Error('일정 완료 표시를 확인해 주세요.');
 return {title:value.title.trim(),date:value.date,time:value.time,location:value.location.trim(),...(value.completed===undefined?{}:{completed:value.completed})};
}
export function validatePlanInput(input){
 if(!input||!validDate(input.date)||typeof input.text!=='string'||!input.text.trim()||input.text.length>2000)throw new Error('앞으로 할 일과 기록 날짜를 확인해 주세요.');
 if(planSegments(input.text,input.date).length>5)throw new Error('일정은 한 번에 다섯 개까지 확인할 수 있어요. 나누어 등록해 주세요.');
 const turns=input.turns??[],todayEvents=input.todayEvents??[];
 if(!Array.isArray(turns)||turns.length>8||turns.some(t=>!t||typeof t.question!=='string'||t.question.length>500||typeof t.answer!=='string'||t.answer.length>2000))throw new Error('일정에 참고할 대화 형식을 확인해 주세요.');
 if(!Array.isArray(todayEvents)||todayEvents.length>20)throw new Error('오늘 일정 형식을 확인해 주세요.');
 const events=todayEvents.map(calendarEvent);if(events.some(e=>e.date!==input.date))throw new Error('오늘 일정 날짜를 확인해 주세요.');
 return {date:input.date,text:input.text.trim(),turns:turns.map(t=>({question:t.question,answer:t.answer})),todayEvents:events};
}
const DATE_WORDS=String.raw`\d{4}-\d{2}-\d{2}|(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일|(?:다음|이번)\s*주\s*[월화수목금토일]요일|[월화수목금토일]요일|(?:이번|다음)\s*달\s*\d{1,2}일|\d{1,2}일\s*(?:후|뒤)|\d{1,2}일|내일|모레|모래(?=(?:에는?|는|은)?\s*(?:오전|오후|아침|저녁|밤|낮|\d{1,2}\s*(?:시|:)|몇\s*시))|글피|오늘|다음\s*(?:주|달)|이번\s*주`;
function dateWords(){return new RegExp(DATE_WORDS,'g');}
function resolvePlanDate(word,base){
 if(/내일/.test(word))return nextDate(base);
 if(/모레|모래/.test(word))return nextDate(base,2);
 if(word==='글피')return nextDate(base,3);
 if(word==='오늘')return base;
 if(/^\d{4}-/.test(word))return validDate(word)?word:'';
 const after=word.match(/^(\d{1,2})일\s*(?:후|뒤)$/);if(after)return nextDate(base,Number(after[1]));
 const monthDay=word.match(/^(?:(이번|다음)\s*달\s*)?(\d{1,2})일$/);
 if(monthDay){
  const day=monthDay[2].padStart(2,'0'),start=monthDay[1]==='다음'?1:0,end=monthDay[1]?start:12;
  for(let offset=start;offset<=end;offset++){const first=shiftMonth(base.slice(0,8)+'01',offset),candidate=first.slice(0,8)+day;if(validDate(candidate)&&candidate>base)return candidate;}
  return '';
 }
 const explicit=word.match(/^(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일$/);
 if(explicit){let year=explicit[1]?Number(explicit[1]):Number(base.slice(0,4));let date=`${year}-${explicit[2].padStart(2,'0')}-${explicit[3].padStart(2,'0')}`;if(!explicit[1]&&date<=base)date=`${year+1}-${date.slice(5)}`;return validDate(date)?date:'';}
 const weekday=word.match(/([월화수목금토일])요일/);
 if(weekday){const target='월화수목금토일'.indexOf(weekday[1]),day=(new Date(`${base}T12:00:00`).getDay()+6)%7;
  if(/다음\s*주/.test(word))return nextDate(base,7-day+target);
  if(/이번\s*주/.test(word))return nextDate(base,target-day);
  return nextDate(base,(target-day+7)%7||7);
 }
 return ''; // A week/month without a day needs the user's date confirmation.
}
function noPlan(text){return /^(?:없|몰라|모르겠|아직|쉬)/.test(text)||/^(?:(?:아무(?:런)?|특별한|정해진)\s*)?(?:계획|일정|할\s*일)(?:은|는|이|도)?\s*없/.test(text);}
function planSegments(text,base){
 const marks=[...text.matchAll(dateWords())],sections=[];
 if(!marks.length)sections.push({text,date:nextDate(base),specified:false});
 else{
  marks.forEach((mark,i)=>sections.push({text:text.slice(i===0?0:mark.index,marks[i+1]?.index??text.length),date:resolvePlanDate(mark[0],base),specified:true}));
 }
 return sections.flatMap(section=>section.text.split(/\n|[.!?。]|(?:\s*그리고\s*)/).flatMap(part=>{
  // Two clock times in the same clause can describe two separate activities.
  const times=[...part.matchAll(/(?:(?:오전|오후|아침|저녁|밤|낮)\s*)?\d{1,2}\s*시(?:\s*(?:반|\d{1,2}\s*분))?|\b\d{1,2}:[0-5]\d\b/g)];
  const pieces=times.length>1?times.map((m,i)=>part.slice(i===0?0:m.index,times[i+1]?.index??part.length)):[part];
  return pieces.map(value=>({...section,text:value.trim()}));
 })).filter(part=>{
  const content=part.text.replace(dateWords(),'').replace(/^(?:에는?|는|은|에)?\s*/,'').replace(/(?:하고|되고|그리고|또)\s*$/,'').trim();
  return content&&!noPlan(content)&&(!part.date||part.date>base);
 });
}
export function planDateHints({date,text}){return planSegments(text,date).map(p=>({text:p.text,date:p.date}));}
export function planCandidate(value){
 const date=value?.date??'';if(typeof date!=='string')throw new Error('AI 일정 날짜 형식이 올바르지 않아요.');
 const checked=calendarEvent({...value,date:date||'2000-01-01',time:value?.time??'',location:value?.location??''});
 return {title:checked.title,date,time:checked.time,location:checked.location};
}
export function validatePlans(value,date,text){
 if(!Array.isArray(value)||value.length>5)throw new Error('AI 일정 형식이 올바르지 않아요. 최대 다섯 개씩 확인해 주세요.');
 const events=value.map(item=>{const event=planCandidate(item);if(event.date&&event.date<=date)throw new Error('AI가 지난 날짜를 반환했어요. 날짜를 확인해 주세요.');return event;});
 if(text!==undefined){
  const hints=planDateHints({date,text}),allowed=new Set(hints.map(h=>h.date));
  if(events.some(e=>!allowed.has(e.date)))throw new Error('AI가 말씀하신 것과 다른 날짜를 반환했어요.');
  for(const expected of allowed)if(!events.some(e=>e.date===expected))throw new Error('AI가 일부 날짜의 일정을 빠뜨렸어요.');
 }
 return events;
}
function statedPlanDetails(text){
 // Preserve the place the user actually named; do not invent a clinic or address.
 const place=text.match(/([가-힣A-Za-z0-9·-]*(치과|병원|의원|약국|은행|보건소|주간보호센터))(?:에서|에|으로|로|(?=[?!.\s]|$))/);
 if(!place)return {location:'',title:''};
 const location=place[1].replace(/^(?:내일|모레|모래|글피)(?:은|는)?/,'');
 const visiting=/가요|가야|가려고|갑니|갈\s|갈게|방문|예약|와야|오라고|오라|오래요|오시|진료|검진|치료|스케일링/.test(text)&&!/일해|근무|출근|일하/.test(text);
 return {location,title:visiting?`${place[2]} 방문`:''};
}
function contextualPlanDetails(part,{turns=[],todayEvents=[]}={}){
 if(!/오래|오라고|와야|(?:또|다시).{0,12}(?:오|가|방문)|거기|그곳|같은\s*곳|방문/.test(part))return {location:'',title:''};
 const quoted=turns.findLastIndex(t=>t.answer.replace(/\s/g,'').includes(part.replace(/\s/g,'')));
 for(let i=quoted<0?turns.length-1:quoted;i>=0;i--){
  const turn=turns[i],before=turn.answer.includes(part)?turn.answer.slice(0,turn.answer.indexOf(part)):turn.answer;
  const past=temporalParts(before).filter(t=>!futureReference(t)).join(' ');
  const places=[...past.matchAll(/([가-힣A-Za-z0-9·-]*(?:치과|병원|의원|약국|은행|보건소|주간보호센터))(?:에서|에|으로|로|(?=[?!.\s]|$))/g)].map(m=>m[1]);
  if(new Set(places).size>1)return {location:'',title:''};
  let location=places[0];
  if(!location&&/갔다|다녀|갔|방문했|왔어요|맞아요|^네[.,! ]/.test(past)&&!/안\s*갔|아니|취소/.test(past))location=statedPlanDetails(turn.question).location;
  if(!location)continue;
  const type=location.match(/치과$|병원$|의원$|약국$|은행$|보건소$|주간보호센터$/)?.[0];
  if(!type)continue;
  if(location===type){
   const candidates=[...new Set(todayEvents.filter(e=>e.title.includes(type)||e.location.includes(type)).map(e=>e.location).filter(Boolean))];
   if(candidates.length===1)location=candidates[0];
  }
  return {location,title:`${type} 방문`,inferredFromContext:true};
 }
 return {location:'',title:''};
}
export function enrichPlans(events,text,context={}){
 const parts=planSegments(text,context.date||events[0]?.date||'2000-01-01'),details=parts.map(part=>{const direct=statedPlanDetails(part.text);return {...(direct.location?direct:contextualPlanDetails(part.text,context)),text:part.text,date:part.date};});
 return events.map(event=>{
  // For several appointments, fill only from a uniquely matching source clause.
  const sameDate=context.date?details.filter(d=>d.date===event.date):details;
  const matches=sameDate.filter(d=>d.location&&(event.title.includes(d.location)||event.location===d.location));
  const detail=sameDate.length===1?sameDate[0]:matches.length===1?matches[0]:null;
  if(!detail)return event;
  const vague=/내일|\d+\s*시|와야|가야|오라고|오라|가기|^방문$|^일정$|^약속$|^재방문$/.test(event.title);
  const hour=detail.text.match(/(\d{1,2})\s*시/),ambiguous=hour&&Number(hour[1])>=1&&Number(hour[1])<=12&&!/오전|오후|아침|저녁|밤|낮/.test(detail.text);
  return {...event,time:ambiguous?'':event.time,title:detail.title&&vague?detail.title:event.title,location:detail.inferredFromContext?detail.location:event.location||detail.location,...(detail.inferredFromContext?{inferredFromContext:true}:{})};
 });
}
export function localPlans({date,text,turns=[],todayEvents=[]}){
 const parts=planSegments(text,date);
 if(parts.length>5)throw new Error('일정은 한 번에 다섯 개까지 확인할 수 있어요. 나누어 등록해 주세요.');
 return parts.map(({text:part,date:planDate})=>{
  const clock=part.match(/(?:(오전|오후|아침|저녁|밤|낮)\s*)?(\d{1,2})\s*시(?:\s*(반|\d{1,2}\s*분))?/);
  let time='';
  if(clock){let hour=Number(clock[2]),minute=clock[3]==='반'?30:parseInt(clock[3]||'0',10);const period=clock[1];
   if(hour<=23&&minute<60){if(period&&hour<=12){hour=hour%12+(/오후|저녁|낮/.test(period)||period==='밤'&&hour!==12?12:0);time=`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;}else if(!period&&(hour===0||hour>12))time=`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;}
  }
  const digital=part.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);if(digital)time=`${digital[1].padStart(2,'0')}:${digital[2]}`;
  const direct=statedPlanDetails(part),detail=direct.location?direct:contextualPlanDetails(part,{turns,todayEvents});
  const title=detail.title||part.replace(dateWords(),'').replace(/^(?:에는?|는|은|에)?\s*/,'').trim().slice(0,100)||'다가오는 할 일';
  return {title,date:planDate,time,location:detail.location,...(detail.inferredFromContext?{inferredFromContext:true}:{})};
 });
}
export function temporalParts(text){
 const starts=[...new Set([0,...[...text.matchAll(dateWords())].map(m=>m.index),text.length])].sort((a,b)=>a-b);
 return starts.slice(0,-1).flatMap((start,i)=>text.slice(start,starts[i+1]).split(/(?<=[.!?。\n])\s*|\s*(?:그리고|하지만|그런데)\s*/)).filter(Boolean);
}
function futureReference(text){return [...text.matchAll(dateWords())].some(m=>m[0]!=='오늘')||/예정|할\s*거|갈\s*거/.test(text);}
function temporalLabels(text){
 let planning=false;
 return temporalParts(text).map(part=>{
  if(futureReference(part))planning=true;
  else if(/^오늘/.test(part.trim()))planning=false;
  else if(!planning||!/(?:\d{1,2}\s*(?:시|:)|가야|해야|만나야|만날|하기로|예약|할\s*거|갈\s*거)/.test(part))planning=false;
  return {text:part,future:planning};
 });
}
export function futurePlanText(turns){
 return turns.flatMap(t=>temporalLabels(t.answer)).filter(part=>part.future).map(part=>part.text).join('\n').slice(0,2000);
}
export function experienceTurns(turns){
 return turns.map(t=>({...t,answer:temporalLabels(t.answer).filter(part=>!part.future).map(part=>part.text).join(' ').trim()}));
}
