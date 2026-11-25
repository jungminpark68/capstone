import {factList, validateVerificationResults, correctionRequest, VERIFICATION_LABELS} from './verification-core.js';
import {PLACE_TYPES,TIME_TYPES,validateSceneRecord,sceneFacts,sceneCharacters,generationConditions,sceneGenerationPrompt,matchingMetadata,experimentSummary,collectionQuestions} from './diary-record.js';
import {buildScenePlan} from './generation-plan.js';
import {diaryCheckRequest} from './diary-verification.js';
import {exampleRecord,labSamples,samplePredictions,sampleImage} from './lab-samples.js';

const lab$=id=>document.getElementById(id);
const labStandalone=location.protocol==='file:';
const labClone=value=>JSON.parse(JSON.stringify(value));
const newLabId=prefix=>`${prefix}-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const labState={mode:'example',sample:'matching',record:labClone(exampleRecord),prepared:true,image:sampleImage('matching'),provenance:{kind:'example',model:null},predictions:null,predictionSource:null,human:{},busy:false,revision:0};
let labConfig={aiEnabled:false,verificationEnabled:false,localVerificationEnabled:false,apiVerificationEnabled:false},labController=null,customCache=null;
const labDataset=[];
const kindNames={place:'장소',people_count:'주요 인물·수',actor_action:'인물과 행동의 연결',object:'핵심 사물',object_count:'핵심 사물·수',relation:'위치·상호작용'};

function labNode(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function labNotice(text='',success=false){lab$('notice').textContent=text;lab$('notice').hidden=!text;lab$('notice').classList.toggle('success',success);}
function clearLabPredictions(){labState.predictions=null;labState.predictionSource=null;labState.trainedModel=false;labState.trainingScope=null;labState.verificationModel=null;}
function labInvalidate(){labState.revision++;labController?.abort();labController=null;labState.busy=false;clearLabPredictions();labState.human={};lab$('labCorrection').hidden=true;}
function labFacts(){return labState.prepared?sceneFacts(labState.record):[];}
function labSourceLabel(provenance){return provenance.kind==='example'?'예시 도식 삽화':provenance.kind==='generated_api'?'API로 생성한 그림':provenance.kind==='uploaded_generated'?'AI 생성 그림 · 사용자 제공':'출처 미확인 · 사용자 제공';}
function labPercent(value){return value===null?'—':`${(value*100).toFixed(1)}%`;}
function blankLabRecord(){return {schemaVersion:1,id:newLabId('event'),title:'',activity:'',eventDate:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()),dateStatus:'known',timeOfDay:'unknown',place:{id:'',name:'',type:'unknown'},people:[{id:'person-self',alias:'A',name:'나',visual:'',action:''}],objects:[],scene:'',memoryCue:'',memoryCueStatus:'not_asked',relation:'',confirmed:false};}

function labGenerationOptions(){return {generationMethod:lab$('generationMethod').value,imageStyle:lab$('generationStyle').value,imageQuality:lab$('generationQuality').value};}
function labCurrentPrompt(){return buildScenePlan({...labState.record,...labGenerationOptions()}).prompt;}
function labVerifierReady(){return lab$('verifierBackend').value==='local'?labConfig.localVerificationEnabled:labConfig.apiVerificationEnabled;}

function renderLabRecord(){
 const record=labState.record,isExample=labState.mode==='example';
 lab$('recordSource').textContent=isExample?'확인한 경험 · 예시 자료':labState.prepared?'확인한 경험 · 직접 준비':'그림으로 남길 경험 · 준비 중';
 lab$('recordTitle').textContent=record.title||'나의 한 장면을 준비해요';
 lab$('recordStory').textContent=record.scene||'날짜·시간대·장소·사람과 행동을 확인하면, 같은 정보로 그림 생성 조건과 검증 항목을 만들 수 있어요.';
 const metadata=lab$('metadata');metadata.replaceChildren();
 const values=[['날짜',record.dateStatus==='known'?record.eventDate:'미확인'],['시간대',TIME_TYPES[record.timeOfDay]],['장소',record.place.name||PLACE_TYPES[record.place.type]],['사람',record.people.map(person=>person.name||'이름 미입력').join(' · ')],['활동',record.activity||'미확인'],['기억 단서',record.memoryCue||({none:'특별한 단서 없음',unknown:'기억나지 않음',declined:'답변 원치 않음'}[record.memoryCueStatus]||'확인 전')]];
 for(const [label,value] of values){const chip=labNode('span');chip.append(labNode('b','',label),document.createTextNode(value||'미확인'));metadata.append(chip);}
 lab$('recordStatus').textContent=labState.prepared?`${labFacts().length}개 시각적 필수 조건 · 날짜·신원은 내부 정보로 보관`:'입력한 내용을 확인하고 장면을 확정해 주세요.';
 lab$('exportRecord').disabled=!labState.prepared;
 lab$('conditionCount').textContent=labState.prepared?`${labFacts().length}개 사실`:'정보 확정 필요';
 const conditions=lab$('conditionList');conditions.replaceChildren();
 if(labState.prepared){for(const condition of generationConditions(record))conditions.append(labNode('li','',condition.text));lab$('generationPrompt').value=labCurrentPrompt();}
 else lab$('generationPrompt').value='장면을 확정하면 생성 요청문이 여기에 나타나요.';
 lab$('copyPrompt').disabled=lab$('downloadPrompt').disabled=!labState.prepared;
 const key=lab$('castKey');key.replaceChildren();
 for(const person of record.people){const row=labNode('span');row.append(labNode('b','',`${person.alias||'?'} · ${person.name||'인물'}`),document.createTextNode(person.visual||'표현 설정 미지정'));key.append(row);}
}

function renderLabImage(){
 const isExample=labState.mode==='example',image=labState.image;
 lab$('labImage').hidden=!image;lab$('emptyImage').hidden=!!image;
 if(image)lab$('labImage').src=image;else lab$('labImage').removeAttribute('src');
 lab$('labImage').alt=isExample?labSamples.find(sample=>sample.id===labState.sample).caption:'입력한 장면의 사실과 비교할 그림';
 lab$('imageTag').textContent=labSourceLabel(labState.provenance);
 lab$('imageCaption').textContent=isExample?'검증 흐름을 설명하기 위한 도식 삽화와 사전 주석입니다. 실제 생성 모델의 오류율이 아닙니다.':labState.provenance.kind==='generated_api'?`생성 모델: ${labState.provenance.model}. 입력한 생성 조건과 함께 기록됩니다.`:'JPG·PNG·WebP / 최대 8MB. 파일 준비만으로 외부에 전송되지 않습니다.';
 lab$('sampleButtons').hidden=!isExample;lab$('customImageActions').hidden=isExample;
 for(const button of lab$('sampleButtons').children){const selected=button.dataset.sample===labState.sample;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));}
 lab$('imageOrigin').value=labState.provenance.kind==='uploaded_generated'?'uploaded_generated':'unconfirmed';
 lab$('uploadedModel').value=labState.provenance.kind==='uploaded_generated'?labState.provenance.model||'':'';
 lab$('imageOrigin').disabled=lab$('uploadedModel').disabled=labState.provenance.kind==='generated_api';
}

function renderLabFacts(){
 const facts=labFacts(),container=lab$('reviewFacts');container.replaceChildren();lab$('labFactCount').textContent=`${facts.length}개 조건`;
 if(!facts.length)container.append(labNode('p','field-hint','장면을 확정하면 검사할 사실이 여기에 나타나요.'));
 for(const [index,fact] of facts.entries()){
  const article=labNode('article','review-fact');article.dataset.fact=fact.id;
  article.append(labNode('p','fact-kind',kindNames[fact.kind]||'확인한 사실'));
  const title=labNode('h3','fact-title');title.append(labNode('span','fact-index',String(index+1).padStart(2,'0')),document.createTextNode(fact.text));article.append(title);
  if(labState.mode==='custom'){
   const focus=labNode('button','text-button',fact.visualPriority==='main'?'★ 다음 생성에서 메인으로 강조':'☆ 다음 생성에서 강조하기');focus.type='button';focus.setAttribute('aria-pressed',String(fact.visualPriority==='main'));
   focus.addEventListener('click',()=>{let selected=labFacts().filter(item=>item.visualPriority==='main').map(item=>item.id);selected=selected.includes(fact.id)?selected.filter(id=>id!==fact.id):[...selected,fact.id];labState.record.focusFactIds=selected;renderLabRecord();renderLabFacts();});article.append(focus);
  }
  const prediction=labState.predictions?.find(item=>item.factId===fact.id);
  if(prediction&&!lab$('hidePredictions').checked){const row=labNode('p',`prediction ${prediction.label}`);row.append(labNode('strong','',`${labState.mode==='example'?'예시 주석':['local_finetuned','local_fusion'].includes(labState.predictionSource)?'자체 학습 모델':'기준 모델'} · ${VERIFICATION_LABELS[prediction.label].short}  `),document.createTextNode(prediction.reason));article.append(row);}
  const choices=labNode('div','human-choices');choices.setAttribute('role','group');choices.setAttribute('aria-label',`${fact.text} 사람 검토`);
  for(const [label,text] of [['supported','일치'],['contradicted','불일치'],['uncertain','판단 보류']]){
   const button=labNode('button',`human-choice ${label}`,text);button.type='button';button.dataset.label=label;button.setAttribute('aria-pressed',String(labState.human[fact.id]===label));button.disabled=labState.busy;
   button.addEventListener('click',()=>{labState.human[fact.id]=label;for(const sibling of choices.children)sibling.setAttribute('aria-pressed',String(sibling===button));renderLabProgress();});choices.append(button);
  }
  article.append(choices);container.append(article);
 }
 renderLabProgress();renderLabControls();
}

function renderLabProgress(){
 const facts=labFacts(),reviewed=facts.filter(fact=>labState.human[fact.id]).length;
 lab$('reviewProgress').textContent=`사람 검토 ${reviewed} / ${facts.length}개${reviewed===facts.length&&facts.length?' · 기록할 준비가 됐어요.':''}`;
 lab$('saveReview').disabled=labState.busy||!labState.image||!facts.length||reviewed!==facts.length;
 lab$('labCorrection').hidden=true;
 if(facts.length&&facts.some(fact=>labState.human[fact.id]==='contradicted')){
  const results=facts.map(fact=>({factId:fact.id,label:labState.human[fact.id]||'uncertain'}));
  lab$('labCorrectionText').value=correctionRequest(labState.record.scene,facts,results);lab$('labCorrection').hidden=false;
 }
}

function renderLabControls(){
 const isExample=labState.mode==='example';
 lab$('connection').textContent=labStandalone?'단일 파일 체험 · API 미연결':labConfig.localVerificationEnabled?'자체 모델 주소 설정됨 · 실행 시 연결 확인':labConfig.apiVerificationEnabled?'API 설정됨 · 실행 시 연결 확인':'API 없이 예시·직접 검토 가능';
 lab$('runLabVerification').disabled=labState.busy||!labState.prepared||!labState.image||(!isExample&&!labVerifierReady());
 lab$('runLabVerification').textContent=labState.busy?'처리 중…':isExample?'예시 판정 보기 ✧':lab$('verifierBackend').value==='local'?'자체 모델로 판정하기 ✧':'범용 API로 비교하기 ✧';
 lab$('predictionNote').textContent=!isExample&&lab$('verifierBackend').value==='local'?(labState.predictionSource==='local_fusion'?'자체 판정 모듈 학습 · 문장·그림 인코더 고정':labConfig.localVerificationEnabled?'자체 모델 서버 · 실제 연결은 실행 시 확인':'학습한 자체 모델 서버를 먼저 연결해 주세요. API로 자동 대체하지 않습니다.'):isExample?'미리 작성한 예시 주석 · 실제 AI 추론 아님':labConfig.verificationEnabled?`기존 VLM: ${labConfig.verificationModel||'서버 설정'} · API로 전송`:'API 없이도 사람이 직접 검토할 수 있어요.';
 lab$('fillExample').hidden=!isExample;lab$('fillExample').disabled=labState.busy;
 lab$('generateImage').disabled=labState.busy||!labState.prepared||!labConfig.aiEnabled||labStandalone;
 lab$('generateImage').textContent=labState.busy?'처리 중…':'이 조건으로 그림 생성';
 lab$('generationHelp').textContent=labConfig.aiEnabled&&!labStandalone?`생성: ${labConfig.imageModel||'서버 설정 모델'} · 버튼을 누르면 API 비용이 발생합니다.`:'API 키 없이 요청문 작성·파일 업로드·사람 검토를 체험할 수 있어요. 실제 생성·AI 판정은 서버 설정이 필요해요.';
 lab$('labUpload').disabled=labState.busy;lab$('editRecord').disabled=labState.busy;
}

function renderLabAll(){renderLabRecord();renderLabImage();renderLabFacts();}

function labPersonEditor(person,index){
 const row=labNode('div','person-editor');row.dataset.personRow='';
 const grid=labNode('div','form-grid');
 const field=(label,value,key,placeholder,max=200)=>{const wrapper=labNode('label','',label),input=labNode('input');input.dataset.field=key;input.value=value||'';input.maxLength=max;if(placeholder)input.placeholder=placeholder;wrapper.append(input);return wrapper;};
 grid.append(field(`${String.fromCharCode(65+index)} · 이름·관계`,person.name,'name','예: 나, 손녀',80),field('이 장면에서 하는 행동',person.action,'action','예: 벤치에 앉아 쉬고 있다'));
 row.append(grid,field('그림에서 구별할 표현 설정',person.visual,'visual','예: 흰머리, 안경, 보라색 옷'));
 const advanced=labNode('details'),summary=labNode('summary','','인물 ID 확인 · 같은 사람은 같은 ID 유지');advanced.append(summary,field('인물 ID',person.id,'id','같은 사람의 과거 기록과 연결',100));row.append(advanced);
 const remove=labNode('button','remove-person','이 인물 빼기');remove.type='button';remove.addEventListener('click',()=>{if(lab$('peopleEditor').children.length===1)return labNotice('이 장면의 주인공 한 명은 남겨주세요.');row.remove();labDirty();});row.append(remove);return row;
}

function labObjectEditor(object){
 const row=labNode('div','object-editor');row.dataset.objectRow='';
 const nameLabel=labNode('label','','사물 이름'),name=labNode('input');name.dataset.objectName='';name.maxLength=80;name.value=object.name||'';name.placeholder='예: 자전거';nameLabel.append(name);
 const countLabel=labNode('label','','수량 · 모르면 빈칸'),count=labNode('input');count.type='number';count.min='1';count.max='20';count.step='1';count.dataset.objectCount='';count.value=object.count??'';countLabel.append(count);
 const remove=labNode('button','remove-object','빼기');remove.type='button';remove.addEventListener('click',()=>{row.remove();labDirty();});row.append(nameLabel,countLabel,remove);return row;
}

function populateLabEditor(record){
 lab$('eventTitle').value=record.title;lab$('eventDate').value=record.eventDate||'';lab$('dateUnknown').checked=record.dateStatus==='unknown';lab$('eventDate').disabled=lab$('dateUnknown').checked;
 lab$('eventTime').value=record.timeOfDay;lab$('placeType').value=record.place.type;lab$('placeName').value=record.place.name||'';lab$('placeId').value=record.place.id||'';lab$('sceneText').value=record.scene;lab$('eventActivity').value=record.activity||'';lab$('fullDiaryNarrative').value=record.diaryNarrative||'';lab$('supportingEvents').value=(record.supportingContext||[]).join('\n');
 lab$('memoryCue').value=record.memoryCue||'';lab$('memoryCueStatus').value=record.memoryCueStatus||(record.memoryCue?'provided':'not_asked');lab$('sceneRelation').value=record.relation||'';lab$('recordConfirmed').checked=record.confirmed===true;
 lab$('peopleEditor').replaceChildren(...record.people.map(labPersonEditor));lab$('objectsEditor').replaceChildren(...record.objects.map(labObjectEditor));
}

function readLabEditor(){
 return {id:labState.record.id,title:lab$('eventTitle').value,eventDate:lab$('eventDate').value||null,dateStatus:lab$('dateUnknown').checked?'unknown':'known',timeOfDay:lab$('eventTime').value,place:{id:lab$('placeId').value,name:lab$('placeName').value,type:lab$('placeType').value},
  diaryNarrative:lab$('fullDiaryNarrative').value,supportingContext:lab$('supportingEvents').value.split(/\r?\n/).map(text=>text.trim()).filter(Boolean),focusFactIds:[],activity:lab$('eventActivity').value,scene:lab$('sceneText').value,memoryCue:lab$('memoryCue').value,memoryCueStatus:lab$('memoryCueStatus').value,relation:lab$('sceneRelation').value,confirmed:lab$('recordConfirmed').checked,
  people:[...lab$('peopleEditor').children].map((row,index)=>({alias:String.fromCharCode(65+index),...Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value]))})),
  objects:[...lab$('objectsEditor').children].map(row=>({name:row.querySelector('[data-object-name]').value,count:row.querySelector('[data-object-count]').value===''?null:Number(row.querySelector('[data-object-count]').value)}))};
}

function labDirty(event){
 if(labState.mode!=='custom')return;
 labInvalidate();labState.prepared=false;if(event?.target?.id!=='recordConfirmed')lab$('recordConfirmed').checked=false;
 if(event?.target?.id==='memoryCue'&&lab$('memoryCue').value.trim())lab$('memoryCueStatus').value='provided';
 renderLabRecord();renderLabFacts();
}

function setLabMode(mode){
 if(!['example','custom'].includes(mode)||mode===labState.mode)return;
 if(labState.mode==='custom')customCache={record:lab$('recordEditor').hidden?labClone(labState.record):readLabEditor(),prepared:labState.prepared,image:labState.image,provenance:labClone(labState.provenance)};
 labInvalidate();labState.mode=mode;labNotice();
 if(mode==='example'){labState.record=labClone(exampleRecord);labState.prepared=true;labState.image=sampleImage(labState.sample);labState.provenance={kind:'example',model:null};lab$('recordEditor').hidden=true;}
 else{const cache=customCache||{record:blankLabRecord(),prepared:false,image:'',provenance:{kind:'unconfirmed',model:null}};Object.assign(labState,cache);populateLabEditor(labState.record);lab$('recordEditor').hidden=labState.prepared;}
 for(const button of document.querySelectorAll('[data-lab-mode]')){const active=button.dataset.labMode===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
 renderLabAll();
}

function chooseLabSample(id){if(!labSamples.some(sample=>sample.id===id))return;labInvalidate();labState.sample=id;labState.image=sampleImage(id);renderLabImage();renderLabFacts();labNotice();}

async function labUploadImage(file){
 if(!file)return;
 labInvalidate();const revision=labState.revision;labState.busy=true;renderLabFacts();
 try{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024)throw new Error('8MB 이하의 JPG·PNG·WebP 파일을 골라주세요.');
  const bitmap=await createImageBitmap(file);let data;
  try{const scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);data=canvas.toDataURL('image/jpeg',.9);}finally{bitmap.close();}
  if(revision!==labState.revision)return;
  if(data.length>6000000)throw new Error('그림 용량이 커요. 더 작은 파일을 골라주세요.');
  labState.image=data;labState.provenance={kind:lab$('imageOrigin').value,model:lab$('uploadedModel').value.trim()||null,fileName:file.name};labNotice('그림을 준비했어요. 사람이 직접 검토하거나, API 설정 후 AI 판정을 요청할 수 있어요.',true);renderLabImage();
 }catch(error){if(revision===labState.revision)labNotice(error.message||'그림 파일을 읽지 못했어요.');}
 finally{if(revision===labState.revision){labState.busy=false;renderLabFacts();}lab$('labUpload').value='';}
}

async function labApiRequest(path,body,timeout){
 const controller=new AbortController();labController=controller;const timer=setTimeout(()=>controller.abort(),timeout);
 try{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});let value;try{value=await response.json();}catch{throw new Error('서버 응답을 읽지 못했어요. 결과를 확정하지 않았어요.');}if(!response.ok)throw new Error(value.error||'API 요청을 완료하지 못했어요.');return value;}
 finally{clearTimeout(timer);if(labController===controller)labController=null;}
}

async function runLabVerification(){
 if(labState.busy||!labState.prepared||!labState.image)return;labNotice();
 if(labState.mode==='example'){labState.predictions=samplePredictions(labState.sample);labState.predictionSource='example_annotation';renderLabFacts();return;}
 if(!labVerifierReady()||labStandalone)return;
 const revision=labState.revision,facts=labFacts();labState.busy=true;clearLabPredictions();renderLabFacts();
 try{const value=await labApiRequest('/api/verification',{backend:lab$('verifierBackend').value,image:labState.image,scene:labState.record.scene,characters:sceneCharacters(labState.record),facts:facts.map(fact=>fact.text)},100000);if(revision!==labState.revision)return;labState.predictions=validateVerificationResults(value,facts);labState.predictionSource=value.mode||'baseline_vlm';labState.trainedModel=value.trainedModel===true;labState.trainingScope=value.trainingScope||null;labState.verificationModel=value.model||labConfig.verificationModel;}
 catch(error){if(revision===labState.revision)labNotice(error.name==='AbortError'?'검증 요청이 중단됐어요. 그림과 입력은 유지됩니다.':error.message);}
 finally{if(revision===labState.revision){labState.busy=false;renderLabFacts();}}
}

async function generateLabImage(){
 if(labState.busy||!labState.prepared||!labConfig.aiEnabled||labStandalone)return;
 const revision=labState.revision,snapshot={...labClone(labState.record),...labGenerationOptions()};if(labState.provenance.kind==='generated_api'&&!labDataset.some(row=>row.image===labState.image)){labNotice('현재 생성한 그림을 먼저 검토하고 저장해 주세요. 좋은 그림과 오류 그림을 모두 기록해야 비교할 수 있어요.');return;}labState.busy=true;renderLabFacts();labNotice('확정한 필수 조건으로 그림을 생성하고 있어요.');
 try{const value=await labApiRequest('/api/scene-illustration',snapshot,135000);if(revision!==labState.revision)return;if(typeof value.image!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value.image)||value.image.length>16000000)throw new Error('생성된 그림 응답이 올바르지 않아요.');labState.image=value.image;labState.provenance=value.generation||{kind:'generated_api',model:value.model||labConfig.imageModel,createdAt:new Date().toISOString(),recordAtGeneration:snapshot,prompt:buildScenePlan(snapshot).prompt,method:snapshot.generationMethod,style:snapshot.imageStyle,quality:snapshot.imageQuality};clearLabPredictions();labState.human={};labNotice('그림을 생성했어요. 같은 필수 조건으로 표현을 확인해 주세요.',true);renderLabImage();}
 catch(error){if(revision===labState.revision)labNotice(error.name==='AbortError'?'생성 요청이 중단됐어요. 입력은 유지됩니다.':error.message);}
 finally{if(revision===labState.revision){labState.busy=false;renderLabFacts();}}
}

function saveLabReview(){
 const facts=labFacts();if(!labState.image||!facts.length||facts.some(fact=>!labState.human[fact.id]))return labNotice('모든 필수 항목을 사람이 검토한 뒤 저장해 주세요.');
 const record={id:newLabId('review'),createdAt:new Date().toISOString(),record:labClone(labState.record),matching:matchingMetadata(labState.record),facts:labClone(facts),image:labState.image,imageProvenance:labClone(labState.provenance),humanLabels:{...labState.human},humanSource:labState.mode==='example'?'example_demonstration':'manual_review',predictions:labState.predictions?labClone(labState.predictions):null,predictionSource:labState.predictionSource,verificationModel:labState.predictionSource&&labState.predictionSource!=='example_annotation'?labState.verificationModel:null,trainedModel:labState.trainedModel===true,trainingScope:labState.trainingScope||null};
 const previous=labDataset.findIndex(item=>item.image===record.image&&JSON.stringify(item.record)===JSON.stringify(record.record));
 if(previous>=0){record.id=labDataset[previous].id;labDataset[previous]=record;}
 else if(labDataset.length>=24)return labNotice('현재 탭에는 최대 24장을 보관할 수 있어요. 기록을 내려받은 뒤 비워주세요.');
 else labDataset.push(record);
 lab$('datasetGroup').value=record.imageProvenance.kind==='example'?'example':['generated_api','uploaded_generated'].includes(record.imageProvenance.kind)?'generated':'unconfirmed';renderLabDataset();labNotice(previous>=0?'같은 그림·장면의 검토 기록을 갱신했어요. 표본 수를 중복으로 늘리지 않았어요.':'사람 검토 기록을 저장했어요. 예시와 실제 자료는 따로 집계합니다.',true);
}

function labGroup(records,group){return records.filter(record=>group==='example'?record.imageProvenance.kind==='example':group==='generated'?['generated_api','uploaded_generated'].includes(record.imageProvenance.kind):record.imageProvenance.kind==='unconfirmed');}
function renderLabDataset(){
 const group=lab$('datasetGroup').value,records=labGroup(labDataset,group),summary=experimentSummary(records);
 lab$('datasetNote').textContent=group==='example'?'도식 삽화와 사람이 구성한 예시 주석의 집계입니다. 실제 생성 모델의 오류율이나 AI 검출 성능으로 해석하지 않습니다.':group==='generated'?'AI 생성 그림에 대한 사람의 검토 결과입니다. 업로드 자료의 모델 정보는 사용자 제공이며, 이 표본의 비율을 모델 전체 오류율로 일반화하지 않습니다.':'그림의 생성 출처가 확인되지 않은 자료입니다. 생성 모델의 오류율로 해석하지 않습니다.';
 const grid=lab$('metricGrid');grid.replaceChildren();
 const metrics=[['검토한 그림',`${summary.images}장`,`${summary.facts}개 필수 항목 · 모두 사람이 판정`],['확인된 오류 그림 비율',labPercent(summary.errorImageProportion),`${summary.errorImages} / ${summary.images}장에 명확한 불일치`],['보류만 남은 그림',`${summary.unresolvedImages}장`,`${summary.matchedImages}장 전체 일치 · 보류는 통과와 구분`]];
 for(const [title,value,note] of metrics){const card=labNode('div','metric');card.append(labNode('h3','',title),labNode('strong','',value),labNode('small','',note));grid.append(card);}
 const rows=lab$('datasetRows');rows.replaceChildren();
 if(!records.length){const tr=labNode('tr'),td=labNode('td','table-empty','아직 저장한 검토 기록이 없어요. 항목을 확인한 뒤 저장해 보세요.');td.colSpan=5;tr.append(td);rows.append(tr);}
 for(const record of records){const s=experimentSummary([record]),tr=labNode('tr'),title=labNode('td','',record.record.title);title.append(labNode('small','',record.record.eventDate||'날짜 미확인'));const origin=labNode('td','',labSourceLabel(record.imageProvenance));origin.append(labNode('small','',record.imageProvenance.model||'모델 미확인 / 해당 없음'));const counts=labNode('td','',`일치 ${s.supported} · 불일치 ${s.contradicted} · 보류 ${s.uncertain}`),result=labNode('td');result.append(labNode('span',`result-label ${s.errorImages?'review':s.unresolvedImages?'uncertain':''}`,s.errorImages?'불일치 있음':s.unresolvedImages?'판단 보류':'전체 일치'));const action=labNode('td'),remove=labNode('button','text-button','삭제');remove.setAttribute('aria-label',`${record.record.title} 검토 기록 삭제`);remove.addEventListener('click',()=>{labDataset.splice(labDataset.indexOf(record),1);renderLabDataset();});action.append(remove);tr.append(title,origin,counts,result,action);rows.append(tr);}
 lab$('modelAgreement').textContent=summary.modelCompared?`모델과 사람 판정의 일치: ${summary.modelAgreed} / ${summary.modelCompared}개 (${labPercent(summary.modelHumanAgreement)}). 3분류 판정의 일치율이며, 생성 오류 비율과 다른 지표입니다.`:'AI 검출 성능은 아직 집계하지 않았어요. 실제 모델 예측과 사람 검토가 함께 있는 항목에서만 판정 일치율을 계산합니다.';
 lab$('exportDataset').disabled=lab$('clearDataset').disabled=!labDataset.length;
}

function labDownload(name,value,type='application/json'){const blob=new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type:`${type};charset=utf-8`}),url=URL.createObjectURL(blob),link=labNode('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}

for(const [id,values] of [['eventTime',TIME_TYPES],['placeType',PLACE_TYPES]])for(const [value,label] of Object.entries(values)){const option=labNode('option','',label);option.value=value;lab$(id).append(option);}
for(const button of document.querySelectorAll('[data-lab-mode]'))button.addEventListener('click',()=>setLabMode(button.dataset.labMode));
for(const sample of labSamples){const button=labNode('button','sample-button',sample.name);button.dataset.sample=sample.id;button.setAttribute('aria-pressed',String(sample.id===labState.sample));button.title=sample.caption;button.addEventListener('click',()=>chooseLabSample(sample.id));lab$('sampleButtons').append(button);}
lab$('editRecord').addEventListener('click',()=>{if(labState.mode==='example'){customCache={record:{...labClone(exampleRecord),id:newLabId('event'),confirmed:false},prepared:false,image:'',provenance:{kind:'unconfirmed',model:null}};setLabMode('custom');}populateLabEditor(labState.record);lab$('recordEditor').hidden=false;lab$('editorTitle').scrollIntoView({block:'start'});});
lab$('cancelEdit').addEventListener('click',()=>{if(!labState.prepared)return labNotice('입력 중인 내용은 그대로 있어요. 장면을 확정한 뒤 편집을 닫을 수 있어요.');lab$('recordEditor').hidden=true;});
lab$('recordForm').addEventListener('input',labDirty);
lab$('dateUnknown').addEventListener('change',()=>{lab$('eventDate').disabled=lab$('dateUnknown').checked;});
lab$('recordForm').addEventListener('submit',event=>{event.preventDefault();try{const record=validateSceneRecord(readLabEditor());labInvalidate();labState.record=record;labState.prepared=true;lab$('recordEditor').hidden=true;renderLabAll();labNotice('장면을 확정했어요. 매칭 정보·생성 조건·검증 사실이 같은 기록에서 준비됐어요.',true);}catch(error){labNotice(error.message);lab$('notice').scrollIntoView({block:'start'});}});
lab$('addPerson').addEventListener('click',()=>{if(lab$('peopleEditor').children.length>=6)return labNotice('한 장면에 주요 인물은 최대 6명까지 준비해 주세요.');lab$('peopleEditor').append(labPersonEditor({id:newLabId('person')},lab$('peopleEditor').children.length));labDirty();});
lab$('addObject').addEventListener('click',()=>{if(lab$('objectsEditor').children.length>=6)return labNotice('핵심 사물은 최대 6개까지 준비해 주세요.');lab$('objectsEditor').append(labObjectEditor({name:'',count:null}));labDirty();});
lab$('labUpload').addEventListener('change',()=>labUploadImage(lab$('labUpload').files[0]));
for(const id of ['imageOrigin','uploadedModel'])lab$(id).addEventListener('input',()=>{if(labState.provenance.kind==='generated_api')return;labState.provenance={...labState.provenance,kind:lab$('imageOrigin').value,model:lab$('uploadedModel').value.trim()||null};lab$('imageTag').textContent=labSourceLabel(labState.provenance);});
lab$('runLabVerification').addEventListener('click',runLabVerification);lab$('generateImage').addEventListener('click',generateLabImage);
lab$('hidePredictions').addEventListener('change',renderLabFacts);
lab$('fillExample').addEventListener('click',()=>{if(labState.mode!=='example')return;labState.human=Object.fromEntries(samplePredictions(labState.sample).map(item=>[item.factId,item.label]));renderLabFacts();labNotice('미리 작성한 예시 주석을 채웠어요. 실제 생성 오류율이나 모델 성능은 아닙니다.',true);});
lab$('saveReview').addEventListener('click',saveLabReview);lab$('datasetGroup').addEventListener('change',renderLabDataset);
lab$('clearDataset').addEventListener('click',()=>{if(!confirm('현재 탭의 검토 기록을 비울까요? 필요한 기록은 먼저 내려받아 주세요.'))return;labDataset.splice(0);renderLabDataset();});
lab$('exportDataset').addEventListener('click',()=>labDownload('기억잇다_그림검증_실험기록.json',{schemaVersion:1,exportedAt:new Date().toISOString(),trainedModel:labDataset.some(record=>record.trainedModel===true&&record.predictions?.length),scope:'reviewed_sample_only',records:labDataset,summaries:{examples:experimentSummary(labGroup(labDataset,'example')),generated:experimentSummary(labGroup(labDataset,'generated')),unconfirmed:experimentSummary(labGroup(labDataset,'unconfirmed'))},definitions:{errorImageProportion:'모든 필수 항목을 사람이 검토한 그림 중 불일치가 하나 이상인 그림의 비율. 미해결 보류가 있으면 확인된 오류의 최소 비율.',modelHumanAgreement:'실제 자체 모델 또는 범용 API 예측과 사람의 3분류 판정 일치율. 생성 오류율과 다름.'}}));
lab$('exportRecord').addEventListener('click',()=>{if(labState.prepared)labDownload('기억잇다_장면정보_생성조건.json',{record:labState.record,matching:matchingMetadata(labState.record),additionalQuestions:collectionQuestions(labState.record),requiredVisualFacts:labFacts(),generationConditions:generationConditions(labState.record),generationPrompt:labCurrentPrompt()});});
lab$('downloadPrompt').addEventListener('click',()=>{if(labState.prepared)labDownload('그림일기_필수조건_요청문.txt',labCurrentPrompt(),'text/plain');});
lab$('copyPrompt').addEventListener('click',async()=>{if(!labState.prepared)return;try{await navigator.clipboard.writeText(labCurrentPrompt());labNotice('생성 요청문을 복사했어요.',true);}catch{lab$('generationPrompt').focus();lab$('generationPrompt').select();labNotice('자동 복사를 사용할 수 없어요. 선택된 요청문을 복사하거나 파일로 내려받아 주세요.');}});
if(labStandalone){lab$('diaryLink').hidden=true;lab$('homeLink').href='#main';}

renderLabAll();renderLabDataset();
if(location.hash==='#custom')setLabMode('custom');
try{
 const handoff=sessionStorage.getItem('memory-verification-handoff-v1');
 if(handoff){sessionStorage.removeItem('memory-verification-handoff-v1');const value=JSON.parse(handoff);if(typeof value.scene==='string'&&value.scene.length<=1800&&typeof value.image==='string'&&value.image.length<=16000000&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value.image)){setLabMode('custom');labState.image=value.image;if(value.record){try{labState.record=validateSceneRecord(value.record);labState.prepared=true;}catch{labState.record.scene=value.scene;}}else labState.record.scene=value.scene;if(value.generation?.kind==='generated_api')labState.provenance=value.generation;if(value.verification?.status==='completed'&&labState.prepared){const request=await diaryCheckRequest({image:labState.image,generation:value.generation,sceneRecord:labState.record});if(request.requestFingerprint===value.verification.requestFingerprint){labState.predictions=validateVerificationResults(value.verification,labFacts());labState.predictionSource=value.verification.mode;labState.trainedModel=value.verification.trainedModel===true;labState.trainingScope=value.verification.trainingScope||null;labState.verificationModel=value.verification.model;lab$('hidePredictions').checked=true;}}populateLabEditor(labState.record);lab$('recordEditor').hidden=labState.prepared;renderLabAll();labNotice('기존 그림과 장면을 가져왔어요. 날짜·장소·인물과 필수 사실을 확인한 뒤 검토해 주세요.',true);}}
}catch{labNotice('이전 장면을 불러오지 못했어요. 직접 장면과 그림을 준비할 수 있어요.');}
if(!labStandalone)fetch('/api/config',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error();return response.json();}).then(value=>{labConfig={aiEnabled:value.aiEnabled===true,verificationEnabled:value.verificationEnabled===true,localVerificationEnabled:value.localVerificationEnabled===true,apiVerificationEnabled:value.apiVerificationEnabled===true||value.apiVerificationEnabled===undefined&&value.verificationEnabled===true,verificationModel:typeof value.verificationModel==='string'?value.verificationModel:'서버 설정',imageModel:typeof value.imageModel==='string'?value.imageModel:'서버 설정'};renderLabControls();}).catch(()=>{labConfig={aiEnabled:false,verificationEnabled:false};renderLabControls();});

for(const id of ['generationMethod','generationStyle','generationQuality'])lab$(id).addEventListener('change',()=>{if(labState.prepared)lab$('generationPrompt').value=labCurrentPrompt();});
lab$('verifierBackend').addEventListener('change',renderLabControls);
