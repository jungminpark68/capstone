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
 if(value.scheduleNote!==undefined&&(typeof value.scheduleNote!=='string'||value.scheduleNote.length>300))throw new Error('일정 메모를 확인해 주세요.');
 if(value.completed!==undefined&&typeof value.completed!=='boolean')throw new Error('일정 완료 표시를 확인해 주세요.');
 return {title:value.title.trim(),date:value.date,time:value.time,location:value.location.trim(),...(value.completed===undefined?{}:{completed:value.completed}),...(value.scheduleNote===undefined?{}:{scheduleNote:value.scheduleNote.trim()})};
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
const DATE_WORDS=String.raw`\d{4}-\d{2}-\d{2}|(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일|(?:다음|이번)\s*주\s*[월화수목금토일]요일|[월화수목금토일]요일|(?:이번|다음)\s*달\s*\d{1,2}일|\d{1,2}일\s*(?:후|뒤)|\d{1,2}일|내일|모레|모래(?=(?:에는?|는|은)?\s*(?:오전|오후|아침|저녁|밤|낮|\d{1,2}\s*(?:시|:)|몇\s*시)|\s*(?:그리고|이랑|랑|하고|[,·/]|\d{1,2}일|$))|글피|오늘|다음\s*(?:주|달)|이번\s*주`;
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
const TIME_WORDS=String.raw`(?<!\d)(?:(?:(오전|오후|아침|저녁|밤|낮)\s*)?(\d{1,2})\s*시(?:\s*(반|\d{1,2}\s*분))?|\b(\d{1,2}):(\d{2})\b)(?:에는|에)?`;
function timeWords(){return new RegExp(TIME_WORDS,'g');}
function planClock(text){
 const clock=new RegExp(TIME_WORDS).exec(text);if(!clock)return {source:'',time:''};
 if(clock[4])return Number(clock[4])>23||Number(clock[5])>59?{source:clock[0],time:'',invalid:true}:{source:clock[0],time:`${clock[4].padStart(2,'0')}:${clock[5]}`};
 let hour=Number(clock[2]),minute=clock[3]==='반'?30:parseInt(clock[3]||'0',10);const period=clock[1];
 if(hour>23||minute>59)return {source:clock[0],time:'',invalid:true};
 if(!period&&hour>=1&&hour<=12)return {source:clock[0],time:'',ambiguous:{hour,minute}};
 if(period){if(hour>12||hour===0)return {source:clock[0],time:'',invalid:true};hour=hour%12+(/오후|저녁|낮/.test(period)||period==='밤'&&hour!==12?12:0);}
 return {source:clock[0],time:`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`};
}
function dateJoinKind(text){
 // A date list may attach different times to each date, but contains no action.
 const rest=text.replace(timeWords(),'').replace(/그리고|이랑|하고|또는|아니면|혹은|및|에는|날에|날|랑|과|와|에|은|는|도|또|쯤|경|[\s,、·/]/g,'');
 if(rest)return null;
 return /또는|아니면|혹은/.test(text)?'alternative':'and';
}
function planBody(text){
 const first=new RegExp(`^\\s*(?:${DATE_WORDS})`).exec(text);
 if(first)text=text.slice(first[0].length).replace(/^\s*(?:날)?(?:에는?|은|는|도)?\s*/,'');
 return text.trim();
}
function normalizeDateCorrections(text){
 const pair=new RegExp(`(${DATE_WORDS})(?:날)?(?:은|는|이|가)?\\s*(?:말고|아니라|아니고)\\s*(${DATE_WORDS})`,'g');
 let next=text;for(let i=0;i<5;i++){const changed=next.replace(pair,'$2');if(changed===next)break;next=changed;}return next;
}
function cancelledPlan(text){return /취소|안\s*(?:가|간|갈|해|했)|가지\s*않|없어졌/.test(text)&&!/취소\s*(?:안|하지\s*않)|취소하러|취소하려고/.test(text);}
function timeSections(section,index){
 const body=planBody(section.text);
 // Keep a negated/cancelled action from swallowing a later, independent action.
 const boundaries=[...body.matchAll(/취소(?:하고|했고|됐고|했지만)|안\s*가고|가지\s*않고|안\s*하고/g)].map(m=>m.index+m[0].length).filter(end=>end<body.trimEnd().length);
 if(boundaries.length){const starts=[0,...boundaries,body.length];return starts.slice(0,-1).flatMap((start,i)=>{const text=body.slice(start,starts[i+1]).trim();return text?timeSections({...section,text},`${index}-${i}`):[];});}
 const conjunction=[...body.matchAll(/그리고/g)].find(m=>{const before=body.slice(0,m.index),last=[...before.matchAll(timeWords())].at(-1);return /가요|가야|가고|했어요|해요|해야|먹어요|먹고|만나요|만나고|있어요|있고/.test(last?before.slice(last.index+last[0].length):before);});
 if(conjunction)return [body.slice(0,conjunction.index),body.slice(conjunction.index+conjunction[0].length)].flatMap((text,i)=>timeSections({...section,text},`${index}-${i}`));
 const marks=[...body.matchAll(timeWords())];
 if(!marks.length)return body.split(/\n|그리고/).map(text=>({...section,text}));
 const rangeAt=marks.findIndex((mark,i)=>i+1<marks.length&&/부터|에서|[~～–]/.test(body.slice(mark.index+mark[0].length,marks[i+1].index))&&(/까지/.test(body.slice(marks[i+1].index+marks[i+1][0].length,marks[i+2]?.index))||/[~～–]/.test(body.slice(mark.index,marks[i+1].index))));
 if(rangeAt>=0&&marks.length>2){
  const starts=[...new Set([0,...(rangeAt?[marks[rangeAt].index]:[]),...(marks[rangeAt+2]?[marks[rangeAt+2].index]:[]),body.length])];
  return starts.slice(0,-1).flatMap((start,i)=>timeSections({...section,text:body.slice(start,starts[i+1])},`${index}-${i}`));
 }
 const correction=/아니라|아니고|말고|대신/,lastGap=marks.length>1?body.slice(marks.at(-2).index+marks.at(-2)[0].length,marks.at(-1).index):'';
 const places=new Set([...body.matchAll(/([가-힣A-Za-z0-9·-]*(?:치과|병원|의원|약국|은행|식당|레스토랑|카페))/g)].map(m=>m[1]));
 const timeChange=marks.length>1&&(correction.test(lastGap)||places.size<=1&&!/가고|방문하고|예약하고|먹고|만나고/.test(lastGap)&&/변경|바꿨|바꿔|바뀌/.test(body.slice(marks.at(-1).index)));
 if(timeChange){
  let start=marks.length-2;while(start>0&&correction.test(body.slice(marks[start-1].index+marks[start-1][0].length,marks[start].index)))start--;
  if(start>0)return [body.slice(0,marks[start].index),body.slice(marks[start].index)].flatMap((text,i)=>timeSections({...section,text},`${index}-${i}`));
  const last=marks.at(-1),cut=body.search(/아니라|아니고|말고|대신/),suffix=cut>=0?body.slice(cut):'';
  const action=(suffix&&statedPlanDetails(suffix).location?suffix:body).replace(timeWords(),'').replace(/아니라|아니고|말고|대신/g,'').trim();
  return [{...section,text:`${last[0]} ${action}`,timeGroup:`correction-${index}`,restrictCount:true}];
 }
 const range=marks.length===2&&/부터|에서|[~～–]/.test(body.slice(marks[0].index+marks[0][0].length,marks[1].index))&&(/까지/.test(body.slice(marks[1].index+marks[1][0].length))||/[~～–]/.test(body));
 if(range){
  const action=body.replace(timeWords(),'').replace(/부터|까지|[~～–]/g,'').trim();
  return [{...section,text:`${marks[0][0]} ${action}`,timeGroup:`range-${index}`,restrictCount:true,scheduleNote:`말씀하신 시간 범위: ${marks[0][0]} ~ ${marks[1][0]}. 달력 시간 칸에는 시작 시간을 적어요.`}];
 }
 const pieces=[];
 for(let i=0;i<marks.length;i++){
  const start=i;let alternative=false;
  while(i+1<marks.length){const join=dateJoinKind(body.slice(marks[i].index+marks[i][0].length,marks[i+1].index));if(!join)break;alternative||=join==='alternative';i++;}
  const end=marks[i+1]?.index??body.length,prefix=start===0?body.slice(0,marks[start].index):'';
  if(i===start){pieces.push({...section,text:prefix+body.slice(marks[i].index,end),timeGroup:section.timeGroup||marks.length>1?`${section.timeGroup||'times-'+index}:${start}`:undefined});continue;}
  const action=(prefix+' '+body.slice(marks[i].index+marks[i][0].length,end)).replace(/^\s*(?:그리고|이랑|랑|및|과|와)\s*/,'').trim();
  if(!action||dateJoinKind(action))continue;
  if(alternative){pieces.push({...section,text:action,restrictCount:true,scheduleNote:`말씀하신 시간 후보: ${marks.slice(start,i+1).map(m=>m[0]).join(' 또는 ')}. 확정할 시간은 시간 칸에서 확인하거나 미정으로 남겨주세요.`});continue;}
  const periods=[...new Set(marks.slice(start,i+1).map(m=>m[1]).filter(Boolean))];
  for(let j=start;j<=i;j++){
   const source=(!marks[j][1]&&marks[j][2]&&periods.length===1?periods[0]+' ':'')+marks[j][0];
   pieces.push({...section,text:`${source} ${action}`,timeGroup:`${section.timeGroup||'times-'+index}:${j}`});
  }
 }
 return pieces;
}
function planSegments(text,base){
 text=normalizeDateCorrections(text);
 const marks=[...text.matchAll(dateWords())],sections=[];
 if(!marks.length)sections.push({text,date:nextDate(base)});
 for(let i=0;i<marks.length;i++){
  const start=i;let alternative=false;
  while(i+1<marks.length){
   const join=dateJoinKind(text.slice(marks[i].index+marks[i][0].length,marks[i+1].index));
   if(!join)break;alternative||=join==='alternative';i++;
  }
  const end=marks[i+1]?.index??text.length,prefix=start===0?text.slice(0,marks[start].index):'';
  if(i===start){sections.push({text:prefix+text.slice(marks[i].index,end),date:resolvePlanDate(marks[i][0],base)});continue;}
  const tail=planBody(text.slice(marks[i].index,end)),commonClock=planClock(tail);
  const action=(prefix+' '+(commonClock.source?tail.replace(commonClock.source,''):tail)).trim();
  if(!action||dateJoinKind(action))continue;
  // Apply a trailing shared action only to this contiguous date/time list.
  for(let j=start;j<=i;j++){
   const modifier=text.slice(marks[j].index+marks[j][0].length,j===i?end:marks[j+1].index);
   const ownClock=planClock(modifier),clock=ownClock.source?ownClock:commonClock;
   const origin=ownClock.source&&j!==i?marks[j].index:marks[i].index;
   sections.push({text:`${marks[j][0]} ${clock.source} ${action}`,date:alternative?'':resolvePlanDate(marks[j][0],base),timeGroup:`dates-${marks[start].index}-${origin}`});
   if(alternative)break; // An either/or date needs one date confirmation, not two bookings.
  }
 }
 return sections.flatMap((section,index)=>section.text.split(/[.!?。]/).flatMap((text,sentence)=>timeSections({...section,text},`${index}-${sentence}`))).filter(part=>{
  const content=planBody(part.text).replace(/(?:하고|되고|그리고|또)\s*$/,'').trim();
  return content&&!noPlan(content)&&!cancelledPlan(content)&&(dateJoinKind(content)===null||planClock(content).source)&&(!part.date||part.date>base);
 });
}
export function planDateHints({date,text}){return planSegments(text,date).map(p=>({text:p.text,date:p.date,...(p.timeGroup?{sharedTimeGroup:p.timeGroup}:{})}));}
export function planCandidate(value){
 const date=value?.date??'';if(typeof date!=='string')throw new Error('AI 일정 날짜 형식이 올바르지 않아요.');
 const checked=calendarEvent({...value,date:date||'2000-01-01',time:value?.time??'',location:value?.location??''});
 const result={title:checked.title,date,time:checked.time,location:checked.location,...(checked.scheduleNote?{scheduleNote:checked.scheduleNote}:{})};
 if(value.pendingTime!==undefined){const t=value.pendingTime;if(!t||!Number.isInteger(t.hour)||t.hour<1||t.hour>12||!Number.isInteger(t.minute)||t.minute<0||t.minute>59||typeof t.group!=='string'||!t.group||t.group.length>100)throw new Error('시간 확인 형식이 올바르지 않아요.');result.pendingTime={hour:t.hour,minute:t.minute,group:t.group};}
 return result;
}
export function validatePlans(value,date,text){
 if(!Array.isArray(value)||value.length>5)throw new Error('AI 일정 형식이 올바르지 않아요. 최대 다섯 개씩 확인해 주세요.');
 const events=value.map(item=>{const event=planCandidate({...item,pendingTime:undefined,scheduleNote:undefined});if(event.date&&event.date<=date)throw new Error('AI가 지난 날짜를 반환했어요. 날짜를 확인해 주세요.');return event;});
 if(text!==undefined){
  const parts=planSegments(text,date),allowed=new Set(parts.map(h=>h.date));
  if(events.some(e=>!allowed.has(e.date)))throw new Error('AI가 말씀하신 것과 다른 날짜를 반환했어요.');
  const source=localPlans({date,text});
  for(const expected of allowed){
   const count=new Set(source.filter(e=>e.date===expected).map(e=>JSON.stringify([e.title,e.time,e.location,e.pendingTime?.hour,e.pendingTime?.minute,e.scheduleNote]))).size;
   const actual=events.filter(e=>e.date===expected).length,restricted=parts.some(p=>p.date===expected&&p.restrictCount);
   if(actual<count||restricted&&actual>count)throw new Error('AI가 일부 일정을 빠뜨리거나 중복해서 반환했어요.');
  }
 }
 return events;
}
function statedPlanDetails(text){
 // Preserve the place the user actually named; do not invent a clinic or address.
 text=planBody(text);
 if(new Set([...text.matchAll(/([가-힣A-Za-z0-9·-]*(?:치과|병원|의원|약국|은행|보건소|주간보호센터|식당|레스토랑|카페))/g)].map(m=>m[1])).size>1)return {location:'',title:'',ambiguousPlaces:true};
 const place=text.match(/([가-힣A-Za-z0-9·-]*(치과|병원|의원|약국|은행|보건소|주간보호센터|식당|레스토랑|카페))(?:에서|에|으로|로|(?=[?!.\s]|가야|가요|가고|가려고|갈|방문|예약|오래|오라|$))/);
 if(!place)return {location:'',title:''};
 const location=place[1].replace(/^(?:내일|모레|모래|글피)(?:은|는)?/,'');
 const visiting=/가요|가야|가려고|가고|가기로|있어요|있어야|있고|갑니|갈\s|갈게|방문|예약|와야|오라고|오라|오래(?:요)?(?=\s|\d|[.!?]|$)|오시|진료|검진|치료|스케일링/.test(text)&&!/일해|근무|출근|일하/.test(text);
 return {location,title:/식당|레스토랑|카페/.test(place[2])&&/예약/.test(text)?`${place[2]} 예약`:visiting?`${place[2]} 방문`:''};
}
function contextualPlanDetails(part,{turns=[],todayEvents=[]}={}){
 if(!/오래|오라고|와야|(?:또|다시).{0,12}(?:오|가|방문)|거기|그곳|같은\s*곳|방문/.test(part))return {location:'',title:''};
 const quoted=turns.findLastIndex(t=>t.answer.replace(/\s/g,'').includes(part.replace(/\s/g,'')));
 for(let i=quoted<0?turns.length-1:quoted;i>=0;i--){
  const turn=turns[i],before=turn.answer.includes(part)?turn.answer.slice(0,turn.answer.indexOf(part)):turn.answer;
  const past=temporalParts(before).filter(t=>!futureReference(t)).join(' ');
  const places=[...past.matchAll(/([가-힣A-Za-z0-9·-]*(?:치과|병원|의원|약국|은행|보건소|주간보호센터|식당|레스토랑|카페))(?:에서|에|으로|로|(?=[?!.\s]|$))/g)].map(m=>m[1]);
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
 const parts=planSegments(text,context.date||events[0]?.date||'2000-01-01'),details=parts.map(part=>{const direct=statedPlanDetails(part.text);return {...(direct.location||direct.ambiguousPlaces?direct:contextualPlanDetails(part.text,context)),text:part.text,date:part.date,timeGroup:part.timeGroup,scheduleNote:part.scheduleNote};});
 const used=new Set();
 return events.map(event=>{
  // For several appointments, fill only from a uniquely matching source clause.
  const sameDate=context.date?details.filter(d=>d.date===event.date):details;
  const available=sameDate.filter(d=>!used.has(d));
  const byTime=available.filter(d=>{const clock=planClock(d.text);return event.time&&(clock.time===event.time||clock.ambiguous&&Number(event.time.slice(0,2))%12===clock.ambiguous.hour%12&&Number(event.time.slice(3))===clock.ambiguous.minute);});
  const matches=available.filter(d=>d.location&&(event.title.includes(d.location)||event.location===d.location));
  const equivalent=items=>items.length>1&&items.every(d=>d.location===items[0].location&&(d.title&&d.title===items[0].title||planBody(d.text).replace(timeWords(),'').trim()===planBody(items[0].text).replace(timeWords(),'').trim()));
  const detail=available.length===1?available[0]:byTime.length===1?byTime[0]:matches.length===1||equivalent(matches)?matches[0]:equivalent(available)?available[0]:null;
  if(!detail||detail.ambiguousPlaces)return event;used.add(detail);
  const vague=/내일|\d+\s*시|와야|가야|오라고|오라|가기|^방문$|^일정$|^약속$|^재방문$|^(?:이랑|랑|그리고|또|및|과|와|날|기타|할 일)$/.test(event.title);
  const clock=planClock(detail.text);
  const scheduleNote=clock.invalid?`‘${clock.source}’는 올바른 시간이 아니에요. 시간을 직접 고치거나 미정으로 남겨주세요.`:detail.scheduleNote;
  const result={...event,time:clock.source?clock.time:scheduleNote?'':event.time,...(scheduleNote?{scheduleNote}:{}),title:detail.title&&vague?detail.title:event.title,location:detail.location||event.location,...(detail.inferredFromContext?{inferredFromContext:true}:{})};
  if(clock.ambiguous&&detail.timeGroup)result.pendingTime={...clock.ambiguous,group:detail.timeGroup};
  return result;
 });
}
export function localPlans({date,text,turns=[],todayEvents=[]}){
 const parts=planSegments(text,date);
 if(parts.length>5)throw new Error('일정은 한 번에 다섯 개까지 확인할 수 있어요. 나누어 등록해 주세요.');
 return parts.map(({text:part,date:planDate,timeGroup,scheduleNote})=>{
  const clock=planClock(part);
  if(clock.invalid)scheduleNote=`‘${clock.source}’는 올바른 시간이 아니에요. 시간을 직접 고치거나 미정으로 남겨주세요.`;
  const direct=statedPlanDetails(part),detail=direct.location||direct.ambiguousPlaces?direct:contextualPlanDetails(part,{turns,todayEvents});
  const title=detail.title||planBody(part).replace(timeWords(),'').trim().slice(0,100)||'다가오는 할 일';
  return {title,date:planDate,time:clock.time,location:detail.location,...(scheduleNote?{scheduleNote}:{}),...(detail.inferredFromContext?{inferredFromContext:true}:{}),...(clock.ambiguous&&timeGroup?{pendingTime:{...clock.ambiguous,group:timeGroup}}:{})};
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
