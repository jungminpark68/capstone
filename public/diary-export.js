// Team handoff contract; images, dialogue and appearance settings stay in app storage.
import {PLACE_TYPES} from './diary-record.js';

export const DIARY_EVENTS_SCHEMA='memory-itda-diary-events-v1';
export const DIARY_ELEMENT_KEYS=['place','person','activity','object','emotion'];
const exportString=value=>typeof value==='string'?value.trim():'';
const exportArray=value=>Array.isArray(value)?value:[];
const exportUnique=values=>[...new Set(values.map(exportString).filter(Boolean))];
const exportAvailable=status=>!['none','unknown','declined','not_asked'].includes(status);
function exportDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function exportObject(value,keys){
 return value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
}
function exportEvent(event,text){
 const s=event.collectionStatus||{},people=exportAvailable(s.people)?exportArray(event.people):[];
 const activity=exportAvailable(s.activity)?exportString(event.activity):'';
 const emotion=event.emotion||{};
 const feelings=exportAvailable(emotion.status??s.emotion)&&exportString(emotion.text)?[emotion.text]:[];
 const place=exportAvailable(s.place)&&event.place?.type!=='unknown'
  ?exportString(event.place?.name)||(event.place?.type!=='other'?PLACE_TYPES[event.place?.type]:''):'';
 return {eventId:exportString(event.id),eventText:exportString(text)||exportString(event.scene),
  elements:{place:exportUnique([place]),person:exportUnique(people.map(person=>person.name)),
   activity:exportUnique([activity,...people.filter(person=>exportString(person.name)&&exportAvailable(s['action:'+person.id])&&exportString(person.action)).map(person=>person.name+': '+person.action)]),
   object:exportAvailable(s.objects)?exportUnique(exportArray(event.objects).map(object=>exportString(object.name)+(Number.isInteger(object.count)?' '+object.count+'개':''))):[],
   emotion:exportUnique(feelings)}};
}
function exportRating(entry,record){
 const candidates=[entry.experiences?.importance,entry.conversation?.importance,
  {eventId:record.id,status:record.importanceStatus,value:record.importanceRating},
  entry.matching?.importance?{eventId:entry.matching.importance.eventId,status:entry.matching.importance.ratingStatus,value:entry.matching.importance.rating}:null];
 const item=candidates.find(value=>value?.eventId===record.id&&['provided','skipped'].includes(value.status));
 return item?.status==='provided'&&Number.isInteger(item.value)&&item.value>=1&&item.value<=5?item.value:null;
}
export function createDiaryEventsExport(entry){
 if(!entry||!exportString(entry.id))throw new Error('일기를 먼저 저장하거나 일기 ID를 준비해 주세요.');
 const events=exportArray(entry.experiences?.events);
 const selectedId=entry.experiences?.selectedEventId||entry.sceneRecord?.id||entry.generation?.recordAtGeneration?.id||entry.generation?.usedInformation?.selectedEventId;
 if(!selectedId)throw new Error('이 일기에는 선택한 사건 정보가 없어요. 한 사건을 선택하고 확인한 새 일기에서 내보내 주세요.');
 if(entry.sceneRecord&&entry.sceneRecord.id!==selectedId)throw new Error('선택한 사건과 저장한 장면이 달라요. 사건을 다시 확인해 주세요.');
 if(entry.image&&entry.generation?.usedInformation?.selectedEventId&&entry.generation.usedInformation.selectedEventId!==selectedId)
  throw new Error('그림 생성 당시 사건과 선택 사건이 달라요.');
 const record=[entry.sceneRecord,events.find(event=>event.id===selectedId),entry.generation?.recordAtGeneration]
  .find(event=>event?.id===selectedId&&event.confirmed===true);
 if(!record)throw new Error('선택한 사건의 질문과 장면 확인을 먼저 마쳐주세요.');
 const selectedEvent=exportEvent(record,entry.body);
 selectedEvent.importance={rating:exportRating(entry,record),scale:'1-5'};
 const value={schema:DIARY_EVENTS_SCHEMA,diaryId:entry.id,
  experienceDate:record.dateStatus==='unknown'?null:exportDate(record.eventDate)?record.eventDate:null,
  selectedEvent,otherEvents:events.filter(event=>event.id!==selectedId).map(event=>exportEvent(event))};
 return validateDiaryEventsExport(value);
}
export function validateDiaryEventsExport(value){
 const fail=message=>{throw new Error('연동 JSON 형식 확인: '+message);};
 if(!exportObject(value,['schema','diaryId','experienceDate','selectedEvent','otherEvents'])||value.schema!==DIARY_EVENTS_SCHEMA)fail('최상위 필드를 확인해 주세요.');
 if(!exportString(value.diaryId)||value.diaryId!==value.diaryId.trim())fail('diaryId가 필요해요.');
 if(value.experienceDate!==null&&!exportDate(value.experienceDate))fail('experienceDate는 실제 날짜 YYYY-MM-DD 또는 null이에요.');
 if(!Array.isArray(value.otherEvents))fail('otherEvents는 배열이에요.');
 const ids=new Set();
 for(const [index,event] of [value.selectedEvent,...value.otherEvents].entries()){
  const keys=index===0?['eventId','eventText','elements','importance']:['eventId','eventText','elements'];
  if(!exportObject(event,keys)||!exportString(event.eventId)||!exportString(event.eventText))fail('각 사건에 eventId와 eventText가 필요해요.');
  if(ids.has(event.eventId))fail('선택 사건과 다른 사건의 ID가 중복됐어요.');ids.add(event.eventId);
  if(!exportObject(event.elements,DIARY_ELEMENT_KEYS))fail('elements의 다섯 항목을 확인해 주세요.');
  for(const key of DIARY_ELEMENT_KEYS){
   const values=event.elements[key];
   if(!Array.isArray(values)||values.some(v=>typeof v!=='string'||!v.trim()||v!==v.trim())||new Set(values).size!==values.length)fail(key+'는 중복·빈 문자열 없는 문자열 배열이에요.');
  }
  if(index===0){
   const importance=event.importance;
   if(!exportObject(importance,['rating','scale'])||importance.scale!=='1-5'||
    importance.rating!==null&&(!Number.isInteger(importance.rating)||importance.rating<1||importance.rating>5))fail('별점은 1~5 정수 또는 null이에요.');
  }
 }
 return value;
}
export function diaryEventsFileName(value){
 const id=value.diaryId.replace(/[^a-zA-Z0-9가-힣_-]/g,'_').slice(0,100);
 return '기억잇다_사건_'+(value.experienceDate||'날짜미상')+'_'+id+'.json';
}
