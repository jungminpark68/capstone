import {validateSceneRecord,sceneFacts,sceneCharacters} from './diary-record.js';
import {validateVerificationResults,summarizeVerification,VERIFICATION_LABELS} from './verification-core.js';

function checkCanonical(value){
 if(Array.isArray(value))return value.map(checkCanonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,checkCanonical(value[key])]));
 return value;
}
async function checkSha(bytes){
 if(!globalThis.crypto?.subtle)throw new Error('이 브라우저에서는 그림 확인용 해시를 만들 수 없어요. localhost 또는 HTTPS에서 열어주세요.');
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export async function diaryCheckRequest({image,generation,sceneRecord}){
 if(typeof image!=='string'||image.length>6_000_000)throw new Error('판정용 그림은 4MB 안팎으로 준비해 주세요. 사람 검토 화면에서 작은 파일로 준비할 수 있어요.');
 const record=validateSceneRecord(generation?.recordAtGeneration||sceneRecord);
 const used=generation?.usedInformation;
 if(used&&used.selectedEventId!==record.id)throw new Error('그림을 만들 때 사용한 사건과 현재 기록이 달라요. 생성 당시 정보를 확인해 주세요.');
 const facts=sceneFacts(record);
 if(used?.facts&&JSON.stringify(used.facts.map(({id,text})=>({id,text})))!==JSON.stringify(facts.map(({id,text})=>({id,text}))))throw new Error('생성 당시 사실 목록이 기록과 달라 판정을 연결하지 않았어요.');
 const match=/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(image||'');
 if(!match)throw new Error('검사할 그림을 먼저 준비해 주세요.');
 const bytes=Uint8Array.from(atob(match[1]),char=>char.charCodeAt(0));
 const imageSha256=await checkSha(bytes);
 const context={recordId:record.id,imageSha256,scene:record.scene,characters:sceneCharacters(record),facts:facts.map(({id,text,kind})=>({id,text,kind}))};
 const requestFingerprint=await checkSha(new TextEncoder().encode(JSON.stringify(checkCanonical(context))));
 return {...context,image,requestFingerprint,requestId:crypto.randomUUID()};
}
export function diaryCheckPrediction(request,value,{imageId,source='online'}={}){
 if(value?.error)throw new Error('이 그림의 판정에 실패했어요. 오류를 해결한 뒤 다시 실행해 주세요.');
 if(!['local_fusion','local_finetuned','local_pretrained','baseline_vlm'].includes(value?.mode)||typeof value.model!=='string'||!value.model.trim())throw new Error('판정 모델의 출처를 확인하지 못했어요.');
 if(typeof value.trainedModel!=='boolean'||value.trainedModel!==['local_fusion','local_finetuned'].includes(value.mode))throw new Error('판정 모델의 학습 상태가 올바르지 않아요.');
 if(source==='kaggle_import'&&(value.requestFingerprint!==request.requestFingerprint||value.imageSha256!==request.imageSha256||value.recordId!==request.recordId))throw new Error('다른 그림이나 다른 사실 목록의 판정 결과예요. 현재 그림의 요청 파일로 다시 판정해 주세요.');
 const results=validateVerificationResults(value,request.facts),summary=summarizeVerification(results);
 return {schemaVersion:1,status:'completed',imageId,recordId:request.recordId,imageSha256:request.imageSha256,requestFingerprint:request.requestFingerprint,
  facts:structuredClone(request.facts),results,counts:summary.counts,total:summary.total,
  outcome:summary.status,mode:value.mode,model:value.model,trainedModel:value.trainedModel,
  trainingScope:value.trainingScope||null,source,checkedAt:new Date().toISOString(),humanGroundTruth:false};
}
export function currentDiaryCheck(state){
 const check=state?.imageVerification||state?.verification;
 return check&&state.imageId&&check.imageId===state.imageId&&check.recordId===((state.imageGeneration||state.generation)?.recordAtGeneration?.id||state.sceneRecord?.id)?check:null;
}
export function savedDiaryCheck(state){
 const check=currentDiaryCheck(state);if(!check)return null;
 const copy=structuredClone(check);
 if(copy.status==='checking'){copy.status='not_run';copy.message='그림 확인을 마치기 전에 저장했어요.';delete copy.results;delete copy.outcome;}
 return copy;
}
function checkNode(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;}
export function renderDiaryCheck(container,check){
 container.replaceChildren();container.className='diary-check';container.dataset.status=check?.status||'not_run';
 delete container.dataset.outcome;
 container.append(checkNode('h2','','그림이 이야기와 맞는지 확인해요'));
 const complete=check?.status==='completed';
 const message=complete?(check.outcome==='review'?'이야기와 다르게 보이는 부분이 있어요.':check.outcome==='uncertain'?'그림에서 확인하기 어려운 부분이 있어요.':'확인한 항목은 이야기와 일치한다고 판정했어요.'):
  check?.status==='checking'?'인물과 행동을 하나씩 확인하고 있어요…':check?.message||'아직 판정하지 않았어요. 그림을 보며 실제 기억과도 맞는지 살펴봐 주세요.';
 container.append(checkNode('p','diary-check-message',message));
 if(!complete)return;
 container.dataset.outcome=check.outcome;
 container.append(checkNode('p','diary-note',`일치 ${check.counts.supported} · 불일치 ${check.counts.contradicted} · 판단 보류 ${check.counts.uncertain}. AI의 판정이며 사람이 확인한 정답은 아니에요.`));
 const details=checkNode('details','diary-check-facts');details.open=check.outcome!=='supported';details.append(checkNode('summary','','어떤 내용을 확인했나요?'));
 for(const fact of check.facts){
  const result=check.results.find(item=>item.factId===fact.id);if(!result)continue;
  const item=checkNode('div','diary-check-fact');item.dataset.label=result.label;
  item.append(checkNode('strong','',VERIFICATION_LABELS[result.label].short),checkNode('p','',fact.text),checkNode('p','diary-note',result.reason));details.append(item);
 }
 details.append(checkNode('p','diary-note',`${check.source==='kaggle_import'?'Kaggle에서 가져온 ':''}${check.mode==='baseline_vlm'?'범용 API 비교 결과':'자체 실행 모델 결과'} · ${check.model}`));container.append(details);
}
