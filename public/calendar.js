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
export function calendarEvent(value){
 if(!value||typeof value.title!=='string'||!value.title.trim()||value.title.length>100||!validDate(value.date)||typeof value.time!=='string'||(value.time!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time))||typeof value.location!=='string'||value.location.length>200)throw new Error('일정의 이름, 날짜, 시간과 장소를 확인해 주세요.');
 return {title:value.title.trim(),date:value.date,time:value.time,location:value.location.trim()};
}
export function validatePlanInput(input){
 if(!input||!validDate(input.date)||typeof input.text!=='string'||!input.text.trim()||input.text.length>2000)throw new Error('내일 할 일과 기록 날짜를 확인해 주세요.');
 return {date:input.date,text:input.text.trim()};
}
export function validatePlans(value,date){
 if(!Array.isArray(value)||value.length>5)throw new Error('AI 일정 형식이 올바르지 않아요. 최대 다섯 개씩 확인해 주세요.');
 return value.map(item=>{const event=calendarEvent(item);if(event.date!==nextDate(date))throw new Error('AI가 내일과 다른 날짜를 반환했어요. 날짜를 직접 확인해 주세요.');return event;});
}
function planParts(text){return text.split(/\n|[.!?。]|(?:\s*그리고\s*)/).map(s=>s.trim()).filter(Boolean);}
function statedPlanDetails(text){
 // Preserve the place the user actually named; do not invent a clinic or address.
 const place=text.match(/([가-힣A-Za-z0-9·-]*(치과|병원|의원|약국|은행|보건소|주간보호센터))(?:에서|에|으로|로)/);
 if(!place)return {location:'',title:''};
 const location=place[1].replace(/^내일(?:은)?/,'');
 const visiting=/가요|가야|가려고|갑니|갈\s|갈게|방문|예약|와야|오라고|오라|오래요|오시|진료|검진|치료|스케일링/.test(text)&&!/일해|근무|출근|일하/.test(text);
 return {location,title:visiting?`${place[2]} 방문`:''};
}
export function enrichPlans(events,text){
 const parts=planParts(text),details=parts.map(statedPlanDetails);
 return events.map(event=>{
  // For several appointments, fill only from a uniquely matching source clause.
  const matches=details.filter(d=>d.location&&(event.title.includes(d.location)||event.location===d.location));
  const detail=events.length===1&&parts.length===1?details[0]:matches.length===1?matches[0]:null;
  if(!detail)return event;
  const vague=/내일|\d+\s*시|와야|가야|오라고|오라|가기|^방문$|^일정$|^약속$/.test(event.title);
  return {...event,title:detail.title&&vague?detail.title:event.title,location:event.location||detail.location};
 });
}
export function localPlans({date,text}){
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
  const detail=statedPlanDetails(part);
  const title=detail.title||part.replace(/내일(?:은|에)?\s*/g,'').trim().slice(0,100)||'내일의 할 일';
  return {title,date:nextDate(date),time,location:detail.location};
 });
}
export function temporalParts(text){return text.split(/(?<=[.!?。\n])\s*|\s*(?:그리고|하지만|그런데)\s*|\s+(?=(?:오늘|내일|모레|다음\s*(?:주|달)))/);}
export function experienceTurns(turns){
 return turns.map(t=>({...t,answer:temporalParts(t.answer).filter(s=>!(/내일|모레|다음\s*(?:주|달)|예정|할\s*거|갈\s*거/.test(s))).join(' ').trim()}));
}
