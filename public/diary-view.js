import {PLACE_TYPES,TIME_TYPES} from './diary-record.js';
import {readableDate} from './state.js';

const diaryList=value=>Array.isArray(value)?value:[];
const diaryText=value=>typeof value==='string'?value.trim():'';
const diaryStatusText={none:'없다고 말씀하셨어요.',unknown:'기억나지 않아요.',declined:'답변을 건너뛰었어요.',not_asked:'아직 확인하지 않았어요.'};
function diaryField(value,status){
 if(status&&status!=='provided'&&diaryStatusText[status])return diaryStatusText[status];
 return diaryText(value)||'이 일기에는 기록하지 않았어요.';
}
export function diaryImageSource(value){
 return typeof value==='string'&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(value)?value:'';
}

// Read saved facts only. Opening a diary never fills in or rewrites missing data.
export function diaryDetailModel(entry){
 const events=diaryList(entry.experiences?.events);
 const selectedId=entry.experiences?.selectedEventId||entry.sceneRecord?.id||entry.generation?.usedInformation?.selectedEventId||null;
 const record=[entry.sceneRecord,events.find(event=>selectedId&&event.id===selectedId),entry.generation?.recordAtGeneration].find(item=>item&&selectedId&&item.id===selectedId)||null;
 const ratings=[entry.experiences?.importance,entry.conversation?.importance,
  record?{eventId:record.id,value:record.importanceRating,status:record.importanceStatus}:null,
  entry.matching?.importance?{eventId:entry.matching.importance.eventId,value:entry.matching.importance.rating,status:entry.matching.importance.ratingStatus}:null];
 const savedRating=ratings.find(item=>item&&selectedId&&item.eventId===selectedId&&['provided','skipped'].includes(item.status));
 const rating=savedRating?.status==='provided'&&Number.isInteger(savedRating.value)&&savedRating.value>=1&&savedRating.value<=5
  ?{status:'provided',value:savedRating.value}
  :{status:savedRating?.status==='skipped'?'skipped':'not_asked',value:null};
 const metadata=[];
 const appearance=[];
 if(record){
  const statuses=record.collectionStatus||{};
  const eventDate=record.dateStatus==='known'&&diaryText(record.eventDate)?readableDate(record.eventDate):record.dateStatus==='unknown'?'날짜는 기억나지 않아요.':'경험 날짜를 기록하지 않았어요.';
  const time=record.timeOfDay&&record.timeOfDay!=='unknown'?(TIME_TYPES[record.timeOfDay]||record.timeOfDay):diaryField('',statuses.time||'unknown');
  const place=diaryField(record.place?.name||(record.place?.type!=='unknown'?PLACE_TYPES[record.place?.type]:''),statuses.place);
  const people=diaryList(record.people).map(person=>`${diaryText(person.name)||'이름 미기록'}: ${diaryField(person.action,statuses[`action:${person.id}`])}`);
  const objects=diaryList(record.objects).map(object=>`${diaryText(object.name)}${Number.isInteger(object.count)?` (${object.count}개)`:''}`).filter(Boolean).join(' · ');
  metadata.push(
   {label:'언제 · 어디서',lines:[`${eventDate} · ${time}`,place]},
   {label:'누구와 · 각자의 행동',lines:people.length?people:[diaryField('',statuses.people)]},
   {label:'활동 · 사물',lines:[diaryField(record.activity,statuses.activity),diaryField(objects,statuses.objects)]},
   {label:'소재 · 감정',lines:[diaryField(record.topic,statuses.topic),diaryField(record.emotion?.text,record.emotion?.status||statuses.emotion)],note:record.topicSource==='derived_from_activity'?'소재는 말씀하신 활동에서 정리했어요.':''},
   {label:'직접 말씀하신 기억 단서',lines:[diaryField(record.memoryCue,record.memoryCueStatus||statuses.memoryCue)]}
  );
  for(const person of diaryList(record.people))if(diaryText(person.visual))appearance.push(`${diaryText(person.name)||'이름 미기록'}: ${person.visual}`);
 }
 const conversation=diaryList(entry.conversation?.turns).filter(turn=>turn&&typeof turn==='object');
 const generation=entry.generation?.usedInformation;
 return {selectedId,record,rating,metadata,appearance,conversation,image:diaryImageSource(entry.image),
  // Without a recorded selection, do not label every story as unused.
  otherEvents:selectedId?events.filter(event=>event.id!==selectedId):[],
  generation:generation?{eventId:generation.selectedEventId||null,facts:diaryList(generation.facts).map(fact=>diaryText(fact.text)).filter(Boolean)}:null};
}

function diaryNode(tag,className,text){
 const element=document.createElement(tag);
 if(className)element.className=className;
 if(text!==undefined)element.textContent=text;
 return element;
}
function diaryDisclosure(title,className,open=false){
 const details=diaryNode('details',className);details.open=open;
 details.append(diaryNode('summary','',title));return details;
}
function appendDiaryLines(parent,lines){for(const line of lines)parent.append(diaryNode('p','',line));}

export function renderDiaryDetail(container,entry){
 const model=diaryDetailModel(entry);
 container.replaceChildren();
 const layout=diaryNode('div','diary-layout');
 const paper=diaryNode('article','diary-sheet');
 paper.append(diaryNode('p','paper-date',`${readableDate(entry.date)} · 나의 일기`));
 if(model.selectedId)paper.append(diaryNode('span','diary-event-tag',model.image?'그림으로 남긴 한 가지 이야기':'일기로 남긴 한 가지 이야기'));
 const title=diaryNode('h1','',entry.title);title.id='detailTitle';title.tabIndex=-1;paper.append(title);
 if(model.image){
  const figure=diaryNode('figure');const image=diaryNode('img');image.src=model.image;image.alt=`${entry.title} · AI로 그린 일기 삽화`;
  figure.append(image,diaryNode('figcaption','','AI로 그린 그림 · 실제 사진이 아니에요.'));paper.append(figure);
 }
 paper.append(diaryNode('p','diary-body',entry.body));
 const importance=diaryNode('section','diary-saved-rating');
 importance.setAttribute('aria-label','선택한 경험의 중요도');
 importance.append(diaryNode('h2','','이 경험의 소중함'));
 if(model.rating.status==='provided'){
  const stars=diaryNode('p','diary-stars','★'.repeat(model.rating.value)+'☆'.repeat(5-model.rating.value));
  stars.setAttribute('aria-label',`경험 중요도 5점 중 ${model.rating.value}점`);
  importance.append(stars,diaryNode('p','diary-note',`선택한 경험의 중요도 ${model.rating.value}점 · 그림의 품질 점수가 아니에요.`));
 }else importance.append(diaryNode('p','diary-note',model.rating.status==='skipped'?'별점은 나중에 매기기로 했어요.':'아직 남긴 별점이 없어요.'));
 paper.append(importance);layout.append(paper);
 const metadata=diaryNode('aside','diary-metadata');metadata.setAttribute('aria-label','같이 저장한 정보');
 metadata.append(diaryNode('p','diary-kicker','이 이야기의 단서'),diaryNode('h2','','같이 저장한 정보'));
 if(model.record){
  const dl=diaryNode('dl');
  for(const field of model.metadata){
   const group=diaryNode('div','diary-field');const dd=diaryNode('dd');appendDiaryLines(dd,field.lines);
   if(field.note)dd.append(diaryNode('p','diary-note',field.note));
   group.append(diaryNode('dt','',field.label),dd);dl.append(group);
  }
  metadata.append(dl);
  if(model.appearance.length){
   const appearance=diaryDisclosure('그림 구별용 표현 설정','diary-appearance');
   appendDiaryLines(appearance,model.appearance);appearance.append(diaryNode('p','diary-note','인물을 구별하려고 정한 그림 속 설정이에요. 실제 외모를 확인한 기록과는 달라요.'));
   metadata.append(appearance);
  }
 }else metadata.append(diaryNode('p','diary-note','이 일기에는 장소·인물 같은 별도 정보가 저장되지 않았어요. 남겨둔 글과 그림은 그대로 볼 수 있어요.'));
 layout.append(metadata);container.append(layout);

 if(model.conversation.length){
  const dialogue=diaryDisclosure('어떤 대화로 완성했나요?','diary-dialogue',true);
  dialogue.append(diaryNode('p','diary-note','처음 나눈 이야기부터 한 사건을 고르고 내용을 채운 과정까지 볼 수 있어요.'));
  const turns=diaryNode('ol','diary-turns');
  const phases={today_story:'오늘 이야기',selected_event_details:'선택한 이야기의 추가 확인',event_selection:'그림으로 남길 이야기 선택',future_plans:'앞으로의 일정 · 오늘 경험과 별도',importance:'선택한 경험의 중요도'};
  for(const [index,turn] of model.conversation.entries()){
   const item=diaryNode('li','diary-turn');if(turn.phase==='future_plans')item.classList.add('diary-future-turn');
   item.append(diaryNode('p','diary-turn-label',`${String(index+1).padStart(2,'0')} · ${phases[turn.phase]||'대화 기록'}`));
   item.append(diaryNode('p','diary-turn-question',diaryText(turn.question)||'질문 내용이 저장되지 않았어요.'));
   const answer=diaryNode('div','diary-turn-answer');answer.append(diaryNode('span','diary-speaker','나의 이야기'),diaryNode('p','',diaryText(turn.answer)||'이 질문은 건너뛰었어요.'));
   item.append(answer);turns.append(item);
  }
  dialogue.append(turns);container.append(dialogue);
 }else{
  const dialogue=diaryNode('section','diary-dialogue');dialogue.append(diaryNode('h2','','어떤 대화로 완성했나요?'),diaryNode('p','diary-note','이 일기에는 질문과 답변 기록이 저장되지 않았어요.'));container.append(dialogue);
 }
 if(model.otherEvents.length){
  const other=diaryDisclosure(`그림으로 만들지 않은 이야기 ${model.otherEvents.length}개`,'diary-extra');
  other.append(diaryNode('p','diary-note','이야기는 함께 보관해요. 선택한 그림의 내용이나 별점에 섞지 않았어요.'));
  for(const event of model.otherEvents){
   const card=diaryNode('article','diary-other-event');card.append(diaryNode('h3','',event.title||'함께 보관한 이야기'),diaryNode('p','',event.scene||''));
   card.append(diaryNode('p','diary-note',event.confirmed===true?'따로 확인한 이야기예요.':'처음 대화에서 정리한 이야기예요. 자세한 내용은 아직 확인하지 않았어요.'));other.append(card);
  }
  container.append(other);
 }
 if(model.generation){
  const generation=diaryDisclosure('그림에 실제로 사용한 정보','diary-extra diary-generation');
  generation.append(diaryNode('p','diary-note','그림을 만들 당시 사용한 기록이에요. 위의 대화 전체를 그림에 넣은 것은 아니에요.'));
  if(model.generation.eventId&&model.selectedId&&model.generation.eventId!==model.selectedId)generation.append(diaryNode('p','diary-note','생성 당시 사건과 현재 저장한 사건의 ID가 달라요. 이 기록을 현재 사건의 정보로 합치지 않았어요.'));
  if(model.generation.facts.length){const list=diaryNode('ul','diary-facts');for(const fact of model.generation.facts)list.append(diaryNode('li','',fact));generation.append(list);}
  else generation.append(diaryNode('p','diary-note','개별 생성 조건은 저장되지 않았어요.'));
  container.append(generation);
 }
}
