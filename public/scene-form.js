import {PLACE_TYPES,TIME_TYPES,validateSceneRecord} from './diary-record.js';

export function mountSceneForm(container,candidate,onChange=()=>{}){
 const record=JSON.parse(JSON.stringify(candidate));record.collectionStatus={...(record.collectionStatus||{})};container.replaceChildren();
 const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const field=(parent,label,value,key,options=null)=>{const wrap=node('label',label),input=node(options?'select':'input');input.dataset.sceneField=key;if(options)for(const [v,t] of Object.entries(options)){const option=node('option',t);option.value=v;input.append(option);}input.value=value??'';if(!options)input.maxLength=300;wrap.append(input);parent.append(wrap);return input;};
 const title=field(container,'이 장면의 제목',record.title,'title');title.maxLength=120;
 const activity=field(container,'이번 그림에서 메인으로 남길 일은 무엇인가요?',record.activity,'activity');activity.maxLength=200;
 const topic=field(container,'이 이야기의 소재·주제',record.topic,'topic'),emotion=field(container,'그때의 기분 (말씀하신 표현)',record.emotion?.text,'emotion');
 const mainHint=node('p','여러 일을 이야기하셨더라도 그림은 선택한 메인 장면을 중심으로 그려요. 나머지 이야기는 일기에 남아요.');mainHint.className='helper';container.append(mainHint);
 const date=field(container,'경험한 날짜 (모르면 비우기)',record.eventDate,'eventDate');date.type='date';
 const time=field(container,'시간대',record.timeOfDay,'timeOfDay',TIME_TYPES);
 const place=field(container,'장소 유형',record.place.type,'placeType',PLACE_TYPES),placeName=field(container,'장소 이름 (모르면 비우기)',record.place.name,'placeName');
 const people=node('div');container.append(people);
 const renderPeople=()=>{
  people.replaceChildren();record.people.forEach((person,index)=>{const box=node('fieldset'),legend=node('legend',`인물 ${String.fromCharCode(65+index)}`);box.append(legend);
   const name=field(box,'누구인가요?',person.name,'personName'),action=field(box,'이분은 무엇을 했나요?',person.action,'personAction'),visual=field(box,'그림에서 구별할 설정',person.visual,'personVisual');
   action.dataset.personId=person.id;
   const hint=node('p','옷 색 등은 그림에서 구별할 약속이에요. 실제 모습과 같다는 뜻은 아니에요.');hint.className='helper';box.append(hint);
   for(const [input,key] of [[name,'name'],[action,'action'],[visual,'visual']])input.addEventListener('input',()=>person[key]=input.value);
   const remove=node('button','이 인물 빼기');remove.type='button';remove.className='text-button';remove.onclick=()=>{if(record.people.length<=1)return;record.people.splice(index,1);renderPeople();changed();};box.append(remove);people.append(box);
  });
 };
 renderPeople();
 const add=node('button','＋ 함께한 사람 추가');add.type='button';add.className='secondary';add.onclick=()=>{if(record.people.length>=6)return;record.people.push({id:crypto.randomUUID(),name:'',action:'',visual:`인물 ${String.fromCharCode(65+record.people.length)}, 서로 구별되는 상의 (표현 설정)`});renderPeople();changed();};container.append(add);
 const cueStatus=field(container,'특히 기억에 남는 장면이나 물건이 있나요?',record.memoryCueStatus,'memoryCueStatus',{not_asked:'확인 전',provided:'있어요',none:'특별한 것은 없어요',unknown:'기억나지 않아요',declined:'이 질문은 건너뛸게요'});
 const cue=field(container,'기억 단서 (있을 때만)',record.memoryCue,'memoryCue');
 const sceneLabel=node('label','그림으로 남길 한 장면'),scene=node('textarea');scene.rows=3;scene.maxLength=1800;scene.value=record.scene;sceneLabel.append(scene);container.append(sceneLabel);
 const objectsLabel=node('label','핵심 사물 · 한 줄에 하나 (정확한 수가 있으면 이름 | 수량)'),objects=node('textarea');objects.rows=2;objects.value=record.objects.map(object=>`${object.name}${object.count===null?'':` | ${object.count}`}`).join('\n');objectsLabel.append(objects);container.append(objectsLabel);
 const confirmLabel=node('label',' 입력한 내용과 인물의 표현 설정이 맞아요.'),confirmed=node('input');confirmed.type='checkbox';confirmed.checked=false;confirmLabel.prepend(confirmed);confirmLabel.className='scene-confirm';container.append(confirmLabel);
 const read=()=>({...record,title:title.value,activity:activity.value,topic:topic.value,emotion:{...(record.emotion||{labels:[],status:'not_asked'}),text:emotion.value,status:emotion.value?'provided':record.emotion?.status||'not_asked'},eventDate:date.value||null,dateStatus:date.value?'known':'unknown',timeOfDay:time.value,place:{...record.place,name:placeName.value,type:place.value},scene:scene.value,
  memoryCue:cue.value,memoryCueStatus:cueStatus.value,confirmed:confirmed.checked,objects:objects.value.split(/\r?\n/).filter(line=>line.trim()).map(line=>{const parts=line.split('|').map(part=>part.trim());return {name:parts[0],count:parts[1]?Number(parts[1]):null};})});
 function changed(){confirmed.checked=false;onChange(read());}
 objects.dataset.sceneField='objects';
 container.oninput=event=>{
  if(event.target===confirmed)return;
  const key=event.target.dataset.sceneField,s=record.collectionStatus;
  if(['activity','topic'].includes(key))s[key]=event.target.value.trim()?'provided':'unknown';
  if(key==='placeName'||key==='placeType')s.place=place.value==='unknown'?'unknown':'provided';
  if(key==='personName')s.people='provided';
  if(key==='personAction')s['action:'+event.target.dataset.personId]=event.target.value.trim()?'provided':'unknown';
  if(key==='objects')s.objects=event.target.value.trim()?'provided':'none';
  changed();
 };
 return {read,confirm:(explicitConfirmation)=>validateSceneRecord({...read(),confirmed:typeof explicitConfirmation==='boolean'?explicitConfirmation:confirmed.checked})};
}
