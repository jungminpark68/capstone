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
 if(!input||!validDate(input.date)||typeof input.text!=='string'||!input.text.trim()||input.text.length>2000)throw new Error('내일 할 일과 기록 날짜를 확인해 주세요.');
 const turns=input.turns??[],todayEvents=input.todayEvents??[];
 if(!Array.isArray(turns)||turns.length>8||turns.some(t=>!t||typeof t.question!=='string'||t.question.length>500||typeof t.answer!=='string'||t.answer.length>2000))throw new Error('일정에 참고할 대화 형식을 확인해 주세요.');
 if(!Array.isArray(todayEvents)||todayEvents.length>20)throw new Error('오늘 일정 형식을 확인해 주세요.');
 const events=todayEvents.map(calendarEvent);if(events.some(e=>e.date!==input.date))throw new Error('오늘 일정 날짜를 확인해 주세요.');
 return {date:input.date,text:input.text.trim(),turns:turns.map(t=>({question:t.question,answer:t.answer})),todayEvents:events};
}
export function validatePlans(value,date){
 if(!Array.isArray(value)||value.length>5)throw new Error('AI 일정 형식이 올바르지 않아요. 최대 다섯 개씩 확인해 주세요.');
 return value.map(item=>{const checked=calendarEvent({...item,time:item?.time??'',location:item?.location??''}),event={title:checked.title,date:checked.date,time:checked.time,location:checked.location};if(event.date!==nextDate(date))throw new Error('AI가 내일과 다른 날짜를 반환했어요. 날짜를 직접 확인해 주세요.');return event;});
}
function planParts(text){return text.split(/\n|[.!?。]|(?:\s*그리고\s*)/).map(s=>s.trim()).filter(Boolean);}
function statedPlanDetails(text){
 // Preserve the place the user actually named; do not invent a clinic or address.
 const place=text.match(/([가-힣A-Za-z0-9·-]*(치과|병원|의원|약국|은행|보건소|주간보호센터))(?:에서|에|으로|로|(?=[?!.\s]|$))/);
 if(!place)return {location:'',title:''};
 const location=place[1].replace(/^내일(?:은)?/,'');
 const visiting=/가요|가야|가려고|갑니|갈\s|갈게|방문|예약|와야|오라고|오라|오래요|오시|진료|검진|치료|스케일링/.test(text)&&!/일해|근무|출근|일하/.test(text);
 return {location,title:visiting?`${place[2]} 방문`:''};
}
function contextualPlanDetails(part,{turns=[],todayEvents=[]}={}){
 if(!/오래|오라고|와야|(?:또|다시).{0,12}(?:오|가|방문)|거기|그곳|같은\s*곳|방문/.test(part))return {location:'',title:''};
 const quoted=turns.findLastIndex(t=>t.answer.replace(/\s/g,'').includes(part.replace(/\s/g,'')));
 for(let i=quoted<0?turns.length-1:quoted;i>=0;i--){
  const turn=turns[i],before=turn.answer.includes(part)?turn.answer.slice(0,turn.answer.indexOf(part)):turn.answer;
  const past=temporalParts(before).filter(t=>!/내일|모레|다음\s*(?:주|달)/.test(t)).join(' ');
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
 const parts=planParts(text),details=parts.map(part=>{const direct=statedPlanDetails(part);return {...(direct.location?direct:contextualPlanDetails(part,context)),text:part};});
 return events.map(event=>{
  // For several appointments, fill only from a uniquely matching source clause.
  const matches=details.filter(d=>d.location&&(event.title.includes(d.location)||event.location===d.location));
  const detail=events.length===1&&parts.length===1?details[0]:matches.length===1?matches[0]:null;
  if(!detail)return event;
  const vague=/내일|\d+\s*시|와야|가야|오라고|오라|가기|^방문$|^일정$|^약속$|^재방문$/.test(event.title);
  const hour=detail.text.match(/(\d{1,2})\s*시/),ambiguous=hour&&Number(hour[1])>=1&&Number(hour[1])<=12&&!/오전|오후|아침|저녁|밤|낮/.test(detail.text);
  return {...event,time:ambiguous?'':event.time,title:detail.title&&vague?detail.title:event.title,location:detail.inferredFromContext?detail.location:event.location||detail.location,...(detail.inferredFromContext?{inferredFromContext:true}:{})};
 });
}
export function localPlans({date,text,turns=[],todayEvents=[]}){
 const reply=text.trim().replace(/^내일(?:은|에)?\s*/,'');
 if(/^(?:없|몰라|모르겠|아직|쉬)/.test(reply)||/^(?:(?:아무(?:런)?|특별한|정해진)\s*)?(?:계획|일정|할\s*일)(?:은|는|이|도)?\s*없/.test(reply))return [];
 // Ambiguous hours deliberately remain unset for user confirmation.
 const parts=planParts(text);
 return parts.filter(s=>!(/모레|다음\s*(?:주|달)|오늘/.test(s)&&!/내일/.test(s))).slice(0,5).map(part=>{
  const clock=part.match(/(?:(오전|오후|아침|저녁|밤|낮)\s*)?(\d{1,2})\s*시(?:\s*(반|\d{1,2}\s*분))?/);
  let time='';
  if(clock){let hour=Number(clock[2]),minute=clock[3]==='반'?30:parseInt(clock[3]||'0',10);const period=clock[1];
   if(hour<=23&&minute<60){if(period&&hour<=12){hour=hour%12+(/오후|저녁|낮/.test(period)||period==='밤'&&hour!==12?12:0);time=`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;}else if(!period&&(hour===0||hour>12))time=`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;}
  }
  const digital=part.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);if(digital)time=`${digital[1].padStart(2,'0')}:${digital[2]}`;
  const direct=statedPlanDetails(part),detail=direct.location?direct:contextualPlanDetails(part,{turns,todayEvents});
  const title=detail.title||part.replace(/내일(?:은|에)?\s*/g,'').trim().slice(0,100)||'내일의 할 일';
  return {title,date:nextDate(date),time,location:detail.location,...(detail.inferredFromContext?{inferredFromContext:true}:{})};
 });
}
export function temporalParts(text){return text.split(/(?<=[.!?。\n])\s*|\s*(?:그리고|하지만|그런데)\s*|\s+(?=(?:오늘|내일|모레|다음\s*(?:주|달)))/);}
export function experienceTurns(turns){
 return turns.map(t=>({...t,answer:temporalParts(t.answer).filter(s=>!(/내일|모레|다음\s*(?:주|달)|예정|할\s*거|갈\s*거/.test(s))).join(' ').trim()}));
}
