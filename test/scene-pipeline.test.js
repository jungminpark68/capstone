import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScenePlan,sceneCandidate} from '../scene-pipeline.js';
import {exampleRecord} from '../public/lab-samples.js';
import {matchingMetadata,validateSceneRecord,sceneFacts} from '../public/diary-record.js';
import {makeEntry,newSession} from '../public/state.js';
import {createApp} from '../server.js';

test('메인과 그림 밖 사건을 분리하며 낮은 시각 강조도 필수 사실을 삭제하지 않는다',()=>{
 const record=validateSceneRecord({...exampleRecord,diaryNarrative:'오전 병원에 갔고 오후 손녀와 자전거를 탔고 저녁 장을 봤다.',supportingContext:['오전 병원 방문','저녁 장보기'],focusFactIds:['fact-4']});
 const plan=compileScenePlan(record),meta=matchingMetadata(record);
 assert.equal(plan.facts.length,6);assert.ok(plan.facts.every(fact=>fact.required));
 assert.equal(plan.facts.find(fact=>fact.id==='fact-4').visualPriority,'main');
 assert.ok(!plan.facts.some(fact=>fact.text.includes('병원')||fact.text.includes('장보기')));
 assert.ok(meta.textBlocks.fullDiary.includes('병원'));assert.equal(meta.sceneDensity.reportedOtherEvents,2);
 assert.equal(meta.importance.learnedWeights,null);assert.ok(plan.prompt.includes('같은 크기의 여러 사건 콜라주'));
 assert.throws(()=>validateSceneRecord({...record,focusFactIds:['unknown']}));
 const unknown=matchingMetadata(validateSceneRecord(exampleRecord));assert.equal(unknown.sceneDensity.reportedOtherEvents,null);
});

test('화풍·품질과 생성 방식은 독립 요인이며 같은 사실 목록과 해시를 유지한다',()=>{
 const a=compileScenePlan({...exampleRecord,imageStyle:'watercolor',imageQuality:'medium'}),b=compileScenePlan({...exampleRecord,imageStyle:'clear_illustration',imageQuality:'medium'}),c=compileScenePlan({...exampleRecord,generationMethod:'free_text',imageStyle:'clear_illustration',imageQuality:'medium'});
 assert.deepEqual(a.facts,b.facts);assert.deepEqual(b.facts,c.facts);assert.equal(a.recordSha256,b.recordSha256);assert.notEqual(a.promptSha256,b.promptSha256);
 assert.equal(b.options.quality,c.options.quality);assert.equal(b.options.style,c.options.style);assert.ok(!c.prompt.includes('[인물-행동 연결표'));
 assert.throws(()=>compileScenePlan({...exampleRecord,imageStyle:'unknown'}));
});

test('발언 근거가 없는 추출 결과는 채우지 않고 장면 초안을 자동 확정하지 않는다',()=>{
 const draft={title:'공원',body:'손녀와 공원에 갔다.',scene:'공원에서 쉬었다.'},session={date:'2026-11-18',turns:[{question:'어디요?',answer:'손녀와 공원에 갔어요.'}]};
 const candidate=sceneCandidate(draft,session,{activity:{value:'병원 진료',evidence:'없는 발언'},place:{name:'호수공원',type:'park',evidence:'손녀와 공원에 갔어요.'}});
 assert.equal(candidate.confirmed,false);assert.equal(candidate.activity,'');assert.equal(candidate.place.type,'park');assert.equal(candidate.people[0].action,'');
});

test('완성 일기에 메인·전체 이야기·생성 설정을 보관하고 원본 사진을 넣지 않는다',()=>{
 const state=newSession('2026-11-18');state.draft={title:'공원',body:'일기 전체 본문',scene:exampleRecord.scene};state.sceneRecord=validateSceneRecord(exampleRecord);state.image='data:image/jpeg;base64,YQ==';state.imageScene=state.draft.scene;state.imageGeneration={model:'test',style:'clear_illustration',quality:'medium'};
 const entry=makeEntry(state,'id');assert.equal(entry.matching.textBlocks.fullDiary,'일기 전체 본문');assert.equal(entry.generation.quality,'medium');assert.equal('photos' in entry,false);
});

async function requestFor(t,options){const server=createApp(options);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));return async(path,body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};}

test('자체 서버 판정은 API 키 없이 동작하며 외부 API로 자동 대체하거나 키를 전달하지 않는다',async t=>{
 const calls=[],image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
 const request=await requestFor(t,{env:{DIARY_API_KEY:'never-forward-this',DIARY_VERIFY_BACKEND:'local',DIARY_VERIFIER_URL:'http://127.0.0.1:8010'},fetcher:async(url,options)=>{calls.push({url,options});return Response.json({mode:'local_finetuned',trainedModel:true,model:'trained-adapter',results:[{factId:'fact-1',label:'uncertain',reason:'판단 불가'}]});}});
 const result=await request('/api/verification',{image,scene:'공원',facts:['공원이다.']});assert.equal(result.status,200);assert.equal(result.data.mode,'local_finetuned');assert.equal(result.data.trainedModel,true);assert.equal(calls[0].options.headers.Authorization,undefined);assert.equal(calls[0].url,'http://127.0.0.1:8010/verify');
 const missing=await requestFor(t,{env:{DIARY_API_KEY:'test',DIARY_VERIFY_BACKEND:'local'}});assert.equal((await missing('/api/verification',{image,scene:'공원',facts:['공원이다.']})).status,503);
});
