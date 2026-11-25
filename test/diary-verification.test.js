import test from 'node:test';
import assert from 'node:assert/strict';
import {diaryCheckRequest,diaryCheckPrediction,currentDiaryCheck,savedDiaryCheck} from '../public/diary-verification.js';
import {exampleRecord} from '../public/lab-samples.js';
import {compileScenePlan} from '../scene-pipeline.js';
import {newSession,makeEntry} from '../public/state.js';
import {createApp} from '../server.js';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
function generation(){const plan=compileScenePlan(exampleRecord);return {recordAtGeneration:plan.record,usedInformation:plan.usedInformation};}
function result(request,label='supported'){return {mode:'local_fusion',trainedModel:true,model:'SOFTWARE-TEST-DOUBLE',trainingScope:'fusion_head_only_frozen_encoders',results:request.facts.map(f=>({factId:f.id,label,reason:'소프트웨어 시험용 응답'}))};}

test('통합 판정은 생성 당시 사건과 사실을 사용하고 원문·다른 사건·정답을 보내지 않는다',async()=>{
 const g=generation();g.recordAtGeneration.supportingContext=['병원 방문'];
 const request=await diaryCheckRequest({image,generation:g,sceneRecord:{...g.recordAtGeneration,scene:'현재 편집 중인 다른 장면'}});
 assert.equal(request.scene,g.recordAtGeneration.scene);assert.equal(request.recordId,g.recordAtGeneration.id);
 assert.deepEqual(request.facts.map(f=>f.text),g.usedInformation.facts.map(f=>f.text));
 assert.doesNotMatch(JSON.stringify(request),/병원 방문|humanLabels|diaryNarrative|현재 편집/);
 assert.match(request.imageSha256,/^[0-9a-f]{64}$/);assert.match(request.requestFingerprint,/^[0-9a-f]{64}$/);
 assert.equal(request.requestFingerprint,(await diaryCheckRequest({image,generation:g})).requestFingerprint);
});
test('생성 사건이나 사용 사실이 바뀌면 임의로 현재 그림에 판정을 붙이지 않는다',async()=>{
 const g=generation();g.usedInformation.selectedEventId='other';await assert.rejects(diaryCheckRequest({image,generation:g}),/사건/);
 const other=generation();other.usedInformation.facts[0].text='다른 사실';await assert.rejects(diaryCheckRequest({image,generation:other}),/사실 목록/);
});
test('그림의 오류·보류를 정상으로 바꾸지 않고 모델 출처를 남긴다',async()=>{
 const request=await diaryCheckRequest({image,generation:generation()});
 const failed=diaryCheckPrediction(request,result(request,'contradicted'),{imageId:'image-1'});
 assert.equal(failed.status,'completed');assert.equal(failed.outcome,'review');assert.equal(failed.humanGroundTruth,false);
 assert.equal(diaryCheckPrediction(request,result(request,'uncertain'),{imageId:'image-1'}).outcome,'uncertain');
 assert.throws(()=>diaryCheckPrediction(request,{...result(request),trainedModel:false},{imageId:'i'}),/학습 상태/);
 assert.throws(()=>diaryCheckPrediction(request,{...result(request),results:[]},{imageId:'i'}),/사실 목록/);
});
test('Kaggle 판정 파일은 그림·사건·사실 지문이 모두 일치해야 가져온다',async()=>{
 const request=await diaryCheckRequest({image,generation:generation()});
 const imported={...result(request),requestFingerprint:request.requestFingerprint,imageSha256:request.imageSha256,recordId:request.recordId};
 assert.equal(diaryCheckPrediction(request,imported,{imageId:'i',source:'kaggle_import'}).source,'kaggle_import');
 for(const key of ['requestFingerprint','imageSha256','recordId'])assert.throws(()=>diaryCheckPrediction(request,{...imported,[key]:'different'},{imageId:'i',source:'kaggle_import'}),/다른 그림/);
});
test('다시 그린 그림에는 이전 판정을 복사하지 않고 저장할 때도 제외한다',async()=>{
 const g=generation(),request=await diaryCheckRequest({image,generation:g});
 const state={...newSession('2026-11-25'),sceneRecord:g.recordAtGeneration,imageId:'first',imageGeneration:g};
 state.imageVerification=diaryCheckPrediction(request,result(request),{imageId:'first'});
 assert.ok(currentDiaryCheck(state));state.imageId='second';assert.equal(savedDiaryCheck(state),null);
});
test('중단된 판정은 미판정으로 저장하며 글 저장에 그림 판정이 섞이지 않는다',()=>{
 const state={...newSession('2026-11-25'),imageId:'i',sceneRecord:exampleRecord};
 state.imageVerification={imageId:'i',recordId:exampleRecord.id,status:'checking'};
 assert.equal(savedDiaryCheck(state).status,'not_run');
 state.draft={title:'글 일기',body:'글로만 남겼다.',scene:exampleRecord.scene};
 assert.equal(makeEntry(state,'text').verification,undefined);
});
test('자동 API 판정은 API 방식과 자동 확인을 명시한 설정에서만 켜진다',async t=>{
 for(const [env,expected] of [[{},false],[{DIARY_VERIFY_BACKEND:'local',DIARY_VERIFY_AUTO:'true'},false],[{DIARY_VERIFY_BACKEND:'api'},false],[{DIARY_VERIFY_BACKEND:'api',DIARY_VERIFY_AUTO:'true'},true]]){
  const server=createApp({env});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{const config=await (await fetch(`http://127.0.0.1:${server.address().port}/api/config`)).json();assert.equal(config.autoApiVerification,expected);}
  finally{await new Promise(resolve=>server.close(resolve));}
 }
});
