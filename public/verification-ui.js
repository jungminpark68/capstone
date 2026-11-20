import {factList, summarizeVerification, validateVerificationResults, correctionRequest, VERIFICATION_LABELS} from './verification-core.js';
import {sampleScene, sampleCharacters, sampleFacts, verificationSamples, sampleSvg} from './verification-samples.js';

const $ = id => document.getElementById(id);
const standalone = location.protocol === 'file:';
const exampleFacts = factList(sampleFacts);
const state = {mode:'example', sampleId:'matching', customImage:'', customScene:'', customCharacters:'', customFacts:[], prepared:false, results:null, meta:null, busy:false, uploading:false, activeFact:null};
let config = {verificationEnabled:false}, requestNumber = 0, controller = null, uploadNumber = 0;

function example() { return verificationSamples.find(sample => sample.id === state.sampleId); }
function facts() { return state.mode === 'example' ? exampleFacts : state.customFacts; }
function scene() { return state.mode === 'example' ? sampleScene : state.customScene; }
function characters() { return state.mode === 'example' ? sampleCharacters : state.customCharacters; }
function artUrl() { return state.mode === 'example' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sampleSvg(state.sampleId))}` : state.customImage; }
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function feedback(message='', success=false) { $('feedback').textContent = message; $('feedback').hidden = !message; $('feedback').classList.toggle('success', success); }
function clearResult() {
 requestNumber++; controller?.abort(); controller = null; state.busy = false; state.results = null; state.meta = null; state.activeFact = null;
 $('correctionPanel').hidden = true; $('correctionText').value = ''; $('evidenceRegion').hidden = true;
}

function renderImage() {
 const image = artUrl();
 $('previewImage').hidden = !image;
 if (image) $('previewImage').src = image; else $('previewImage').removeAttribute('src');
 $('previewImage').alt = state.mode === 'example' ? example().description : '검증을 위해 선택한 그림';
 $('uploadPlaceholder').hidden = Boolean(image);
 $('sampleChoices').hidden = state.mode !== 'example'; $('uploadLabel').hidden = state.mode !== 'custom';
 $('characterKey').hidden = state.mode !== 'example';
 $('imageKind').textContent = state.mode === 'example' ? '도식화한 예시' : image ? '직접 선택한 그림' : '그림 준비';
 $('imageCaption').textContent = state.mode === 'example' ? '검증 흐름을 설명하기 위한 예시 삽화 · 실제 AI 생성 결과가 아닙니다.' : '선택한 그림은 자동 저장하지 않습니다. 검증 버튼을 누르면 API로 전송합니다.';
 $('imageHeading').textContent = state.mode === 'example' ? '이야기를 담은 한 장면' : '내가 확인할 그림';
 for (const button of $('sampleChoices').children) {
  const selected = button.dataset.sample === state.sampleId;
  button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
 }
}

function renderStory() {
 const isExample = state.mode === 'example';
 $('storyEyebrow').textContent = isExample ? '확인한 이야기 · 예시' : state.prepared ? '확인할 장면 · 직접 준비' : '확인할 장면 · 준비 중';
 $('storyHeading').textContent = isExample ? '공원에서 보낸 오후' : state.prepared ? '그림에 담기로 한 이야기' : '그림과 비교할 내용을 준비해요';
 $('storyText').textContent = isExample ? sampleScene : state.prepared ? state.customScene : '아래에서 장면 설명과 검사할 사실을 확인해 주세요. 하루 전체가 아니라 그림으로 선택한 장면만 비교합니다.';
 $('editStory').hidden = isExample || !state.prepared;
}

function renderEvidence(index) {
 if (state.mode !== 'example' || !state.results) return;
 state.activeFact = state.activeFact === index ? null : index;
 const overlay = $('evidenceRegion');
 overlay.hidden = state.activeFact === null;
 if (state.activeFact !== null) {
  const [x,y,w,h] = example().results[index].region;
  Object.assign(overlay.style, {left:`${x / 720 * 100}%`, top:`${y / 480 * 100}%`, width:`${w / 720 * 100}%`, height:`${h / 480 * 100}%`});
 }
 for (const button of $('factList').querySelectorAll('.fact-evidence')) button.setAttribute('aria-pressed', String(Number(button.dataset.index) === state.activeFact));
}

function renderFacts() {
 const list = $('factList'); list.replaceChildren();
 const currentFacts = facts();
 $('factCount').textContent = `${currentFacts.length}개 항목`;
 if (!currentFacts.length) list.append(element('p', 'fact-empty', '검사할 사실을 준비하면\n이곳에서 한 가지씩 확인할 수 있어요.'));
 currentFacts.forEach((fact, index) => {
  const result = state.results?.find(value => value.factId === fact.id);
  const item = element('article', 'fact-item');
  const row = element('div', 'fact-row');
  row.append(element('span', 'fact-number', String(index + 1).padStart(2,'0')), element('p', 'fact-text', fact.text), element('span', `fact-status ${result?.label || 'pending'}`, result ? VERIFICATION_LABELS[result.label].short : '확인 전'));
  item.append(row);
  if (result) {
   item.append(element('p', 'fact-reason', result.reason));
   if (state.mode === 'example') {
    const button = element('button', 'fact-evidence', '예시 관찰 영역 보기'); button.type = 'button'; button.dataset.index = String(index); button.setAttribute('aria-pressed','false');
    button.addEventListener('click', () => renderEvidence(index)); item.append(button);
   }
  }
  list.append(item);
 });
 renderSummary(); renderControls();
}

function renderSummary() {
 const summary = $('summary'); summary.replaceChildren(); summary.hidden = !state.results; $('nextCard').hidden = !state.results;
 $('matchingExample').hidden = true; $('makeCorrection').hidden = true;
 if (!state.results) return;
 const value = summarizeVerification(state.results), {supported,contradicted,uncertain} = value.counts;
 summary.className = `summary ${value.status}`;
 const title = value.status === 'review' ? `${contradicted}개 항목의 표현이 이야기와 달라요.` : value.status === 'uncertain' ? `${uncertain}개 항목은 판단을 보류했어요.` : '입력한 모든 항목에서 일치로 표시됐어요.';
 summary.append(element('h3', '', title), element('p', '', `일치 ${supported} · 불일치 ${contradicted} · 판단 보류 ${uncertain}`));
 if (value.status === 'review') {
  $('nextHeading').textContent = '어떤 표현을 고칠지 확인할 수 있어요.';
  $('nextText').textContent = state.mode === 'example' ? '두 인물의 역할이 바뀐 예시입니다. 일치하는 다른 예시와 비교해 보세요.' : '차이가 있다고 판정한 항목을 검토하고, 필요하면 수정 요청문을 준비해 보세요.';
  $('matchingExample').hidden = state.mode !== 'example'; $('makeCorrection').hidden = false;
 } else if (value.status === 'uncertain') {
  $('nextHeading').textContent = '모호한 부분은 오류로 단정하지 않아요.';
  $('nextText').textContent = '판단 보류는 정답도 오류도 아닙니다. 더 잘 보이는 그림이나 인물 기준이 필요할 수 있어요.';
 } else {
  $('nextHeading').textContent = '이야기와 그림을 나란히 살펴봤어요.';
  $('nextText').textContent = state.mode === 'example' ? '사전 주석의 결과입니다. 실제 모델의 성능을 측정한 결과가 아닙니다.' : '기존 AI 모델의 판정입니다. 입력한 사실 이외의 내용과 실제 경험 전체를 보장하지 않습니다.';
 }
 const flow = document.querySelectorAll('.flow li'); flow.forEach((node,index) => node.classList.toggle('current',index === 2));
}

function renderControls() {
 const isExample = state.mode === 'example';
 $('runVerification').disabled = state.busy || state.uploading || (!isExample && (!state.prepared || !state.customImage || !config.verificationEnabled));
 $('runLabel').textContent = state.busy ? '그림을 살펴보고 있어요…' : isExample ? '예시 판정 보기' : state.results ? '기존 AI로 다시 검증하기' : '기존 AI로 그림 검증하기';
 const icon = $('runVerification').firstElementChild; icon.className = state.busy ? 'loading-dot' : ''; icon.textContent = state.busy ? '' : '✧';
 const note = $('modeNote'); note.replaceChildren(element('span','','ⓘ'));
 const text = element('p');
 if (isExample) {
  text.append(element('strong','','미리 작성한 예시 판정'), document.createElement('br'), document.createTextNode('실제 AI 분석이 아닌, 검증 흐름을 보여주는 체험입니다.'));
  $('runHelp').textContent = '그림을 바꿔 역할 교환과 판단 보류도 살펴보세요.';
 } else if (config.verificationEnabled) {
  text.append(element('strong','','기존 AI 모델의 기준 판정'), document.createElement('br'), document.createTextNode('그림과 입력 내용을 OpenAI로 전송합니다. 자체 학습 모델은 아직 연결하지 않았습니다.'));
  $('runHelp').textContent = `사용 모델: ${config.verificationModel || '서버 설정 모델'} · API 비용이 발생합니다.`;
 } else {
  text.append(element('strong','','실제 AI 판정은 아직 연결되지 않았어요'), document.createElement('br'), document.createTextNode(standalone ? '이 파일에서는 예시 체험을 이용할 수 있어요. 실제 검증은 API를 설정한 서버 화면에서 실행합니다.' : '서버의 .env에 DIARY_API_KEY를 설정하고 다시 시작하면 실제 검증을 사용할 수 있어요.'));
  $('runHelp').textContent = 'API 없이도 예시 체험의 세 가지 결과를 살펴볼 수 있어요.';
 }
 note.append(text);
 const badge = $('connectionBadge'); badge.replaceChildren(element('span','connection-dot'));
 badge.append(document.createTextNode(isExample ? '예시 체험 · 사전 주석' : config.verificationEnabled ? 'API 설정됨 · 인증은 실행 시 확인' : '실제 판정 미연결'));
 badge.classList.toggle('offline', !isExample && !config.verificationEnabled);
}

function setMode(mode) {
 if (!['example','custom'].includes(mode)) return;
 clearResult(); state.mode = mode; feedback();
 document.querySelectorAll('[data-mode]').forEach(button => { const selected=button.dataset.mode===mode; button.classList.toggle('active',selected); button.setAttribute('aria-pressed',String(selected)); });
 $('customEditor').hidden = mode !== 'custom' || state.prepared;
 document.querySelectorAll('.flow li').forEach((node,index) => node.classList.toggle('current',index === 0));
 renderStory(); renderImage(); renderFacts();
}

function chooseSample(id) {
 if (!verificationSamples.some(sample => sample.id === id)) return;
 clearResult(); state.sampleId = id; feedback();
 document.querySelectorAll('.flow li').forEach((node,index) => node.classList.toggle('current',index === 1));
 renderImage(); renderFacts();
}

function prepareCustom() {
 try {
  const nextScene=$('sceneInput').value.trim();
  if (!nextScene || nextScene.length > 3000) throw new Error('비교할 장면을 3000자 이내로 적어주세요.');
  const nextFacts=factList($('factsInput').value);
  clearResult(); state.customScene=nextScene; state.customCharacters=$('characterInput').value.trim(); state.customFacts=nextFacts; state.prepared=true;
  $('customEditor').hidden=true; renderStory(); renderFacts(); feedback('검사할 내용을 준비했어요. 그림을 고른 다음 검증할 수 있어요.',true);
 } catch(error) { feedback(error.message); }
}

async function uploadImage(file) {
 const token=++uploadNumber;
 if (!file) return;
 try {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 8*1024*1024) throw new Error('8MB 이하의 JPG·PNG·WebP 그림을 골라주세요.');
  state.uploading=true; renderControls();
  const bitmap=await createImageBitmap(file);
  let data;
  try {
   const scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));
   const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(bitmap.width*scale)); canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const context=canvas.getContext('2d'); context.fillStyle='#fff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(bitmap,0,0,canvas.width,canvas.height); data=canvas.toDataURL('image/jpeg',.9);
   if (data.length > 6000000) throw new Error('그림 용량이 커요. 더 작은 이미지로 골라주세요.');
  } finally { bitmap.close(); }
  if (token!==uploadNumber) return;
  clearResult(); state.customImage=data; renderImage(); renderFacts(); feedback('그림을 준비했어요. 실제 검증 전에는 외부로 전송하지 않습니다.',true);
 } catch(error) { if(token===uploadNumber) feedback(error.message || '그림을 읽지 못했어요. 다른 파일로 골라주세요.'); }
 finally { if(token===uploadNumber) {state.uploading=false;renderControls();} $('imageUpload').value=''; }
}

async function runVerification() {
 if (state.busy) return;
 feedback();
 if (state.mode==='example') {
  state.results=example().results.map((result,index)=>({factId:exampleFacts[index].id,label:result.label,reason:result.reason}));
  state.meta={mode:'example_annotation',trainedModel:false,model:null,annotationSource:'manual_example',sampleId:state.sampleId};
  renderFacts();
  if (matchMedia('(max-width:950px)').matches) $('analysisHeading').scrollIntoView({behavior:'instant',block:'start'});
  return;
 }
 if (!state.prepared || !state.customImage || !config.verificationEnabled) return;
 const token=++requestNumber, input={image:state.customImage,scene:state.customScene,characters:state.customCharacters,facts:state.customFacts.map(fact=>fact.text)};
 const snapshot=state.customFacts.map(fact=>({...fact}));
 state.busy=true; state.results=null; state.meta=null; $('correctionPanel').hidden=true; renderFacts();
 const requestController=new AbortController(); controller=requestController; const timeout=setTimeout(()=>requestController.abort(),70000);
 try {
  const response=await fetch('/api/verification',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:requestController.signal});
  let body; try {body=await response.json();} catch {throw new Error('서버 응답을 읽지 못했어요. 검증 결과를 확정하지 않았어요.');}
  if (token!==requestNumber) return;
  if (!response.ok) throw new Error(body.error || 'AI 검증에 연결하지 못했어요.');
  state.results=validateVerificationResults(body,snapshot);
  state.meta={mode:'baseline_vlm',trainedModel:false,model:body.model || config.verificationModel,annotationSource:null};
 } catch(error) {
  if(token===requestNumber) {state.results=null;state.meta=null;feedback(error.name==='AbortError'?'검증 시간이 길어 중단했어요. 그림과 내용은 유지되어 있어요.':error.message);}
 } finally {
  clearTimeout(timeout);
  if(token===requestNumber) {state.busy=false;controller=null;renderFacts();}
 }
}

function exportVerification() {
 if (!state.results) return;
 const record={schemaVersion:1,createdAt:new Date().toISOString(),...state.meta,scene:scene(),characters:characters(),facts:facts(),results:state.results,summary:summarizeVerification(state.results),image:artUrl(),note:state.mode==='example'?'사전 주석을 이용한 화면 체험. 모델 성능 평가 결과가 아님.':'기존 VLM의 예측 결과. 사람의 정답 주석이나 자체 학습 모델의 평가 결과가 아님.'};
 const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download=`memory-verification-${state.mode==='example'?state.sampleId:'baseline'}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click',()=>setMode(button.dataset.mode));
verificationSamples.forEach((sample,index)=>{
 const button=element('button','sample-choice'); button.type='button';button.dataset.sample=sample.id;button.setAttribute('aria-pressed',String(index===0));button.append(element('span','',index===0?'○':index===1?'⇄':'◌'),document.createTextNode(sample.short));button.title=sample.description;button.addEventListener('click',()=>chooseSample(sample.id));$('sampleChoices').append(button);
});
$('applyFacts').addEventListener('click',prepareCustom);
$('editStory').addEventListener('click',()=>{$('customEditor').hidden=false;$('sceneInput').focus();});
for (const id of ['sceneInput','factsInput','characterInput']) $(id).addEventListener('input',()=>{clearResult();state.prepared=false;state.customFacts=[];renderStory();renderFacts();});
$('imageUpload').addEventListener('change',()=>uploadImage($('imageUpload').files[0]));
$('runVerification').addEventListener('click',runVerification);
$('matchingExample').addEventListener('click',()=>{chooseSample('matching');runVerification();});
$('makeCorrection').addEventListener('click',()=>{const text=correctionRequest(scene(),facts(),state.results||[]);if(!text)return;$('correctionText').value=text;$('correctionPanel').hidden=false;$('correctionPanel').scrollIntoView({behavior:'instant',block:'nearest'});});
$('exportResult').addEventListener('click',exportVerification);
$('showGuide').addEventListener('click',()=>$('guideDialog').showModal());
$('closeGuide').addEventListener('click',()=>$('guideDialog').close());$('guideDone').addEventListener('click',()=>$('guideDialog').close());
$('showGuideFooter').addEventListener('click',()=>$('guideDialog').showModal());
if(standalone){$('backToDiary').hidden=true;$('brandHome').href='#';$('brandHome').addEventListener('click',event=>{event.preventDefault();setMode('example');});}

setMode(location.hash==='#custom'?'custom':'example');
try {
 const stored=sessionStorage.getItem('memory-verification-handoff-v1');
 if(stored){
  sessionStorage.removeItem('memory-verification-handoff-v1');
  const data=JSON.parse(stored);
  if(typeof data.scene==='string' && data.scene.trim() && data.scene.length<=3000 && typeof data.image==='string' && data.image.length<=16000000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(data.image)){
   state.customImage=data.image;$('sceneInput').value=data.scene;$('factsInput').value=data.scene.split(/(?<=[.!?。])\s+|\n+/u).map(text=>text.trim()).filter(Boolean).slice(0,8).join('\n');setMode('custom');feedback('그림일기의 장면과 그림을 불러왔어요. 검사할 사실을 한 줄에 하나씩 나누어 확인해 주세요.',true);
  }
 }
} catch { feedback('작성한 그림을 불러오지 못했어요. 직접 그림을 골라 준비할 수 있어요.'); }

if(!standalone){
 fetch('/api/config',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error();return response.json();}).then(value=>{config={verificationEnabled:value.verificationEnabled===true,verificationModel:typeof value.verificationModel==='string'?value.verificationModel:'서버 설정 모델'};renderControls();}).catch(()=>{config={verificationEnabled:false};renderControls();});
}
