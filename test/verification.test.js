import test from 'node:test';
import assert from 'node:assert/strict';
import {factList,summarizeVerification,validateVerificationResults,correctionRequest} from '../public/verification-core.js';
import {validateVerificationInput,verificationResponse} from '../verification.js';
import {createApp} from '../server.js';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const input={scene:'공원에서 A는 앉아 있고 B는 자전거를 탄다.',characters:'A는 보라색 옷, B는 노란색 옷이다.',facts:['배경은 공원이다.','A가 벤치에 앉아 있다.','B가 자전거를 타고 있다.'],image};
const results=[{factId:'fact-1',label:'supported',reason:'공원 장면이다.'},{factId:'fact-2',label:'contradicted',reason:'앉아 있는 인물이 B다.'},{factId:'fact-3',label:'uncertain',reason:'하체가 가려져 있다.'}];

test('검증 대상은 명시적인 사실이며 중복·빈 목록을 거부한다',()=>{
 assert.deepEqual(factList(' 공원이다.\n\n자전거가 있다. '),[{id:'fact-1',text:'공원이다.'},{id:'fact-2',text:'자전거가 있다.'}]);
 for(const value of ['',[],Array(9).fill('공원이다.'),['같다.','같다.'],['x'.repeat(301)]])assert.throws(()=>factList(value));
 assert.equal(validateVerificationInput(input).facts.length,3);
 for(const value of [null,{...input,scene:''},{...input,facts:[null]},{...input,image:'https://example.com/a.png'},{...input,image:'data:image/svg+xml;base64,YQ=='},{...input,image:'data:image/png;base64,YQ=='}])assert.throws(()=>validateVerificationInput(value));
});

test('판단 보류와 누락 결과를 정상 통과로 바꾸지 않는다',()=>{
 const facts=factList(input.facts);
 assert.equal(summarizeVerification(results).status,'review');
 assert.equal(summarizeVerification([{label:'uncertain'}]).status,'uncertain');
 assert.equal(summarizeVerification([{label:'supported'}]).status,'supported');
 for(const value of [{},{results:[]},{results:results.slice(0,2)},{results:[results[0],results[0],results[2]]},{results:results.map((r,i)=>i===1?{...r,label:'pass'}:r)},{results:results.map((r,i)=>i===1?{...r,reason:''}:r)}])assert.throws(()=>validateVerificationResults(value,facts));
 const value=verificationResponse({results:[...results].reverse(),status:'supported'},facts,'test-model');
 assert.equal(value.status,'review');assert.equal(value.mode,'baseline_vlm');assert.equal(value.trainedModel,false);assert.deepEqual(value.counts,{supported:1,contradicted:1,uncertain:1});
 assert.equal(value.results[0].factId,'fact-1');assert.equal(Object.hasOwn(value,'accuracy'),false);
 const prompt=correctionRequest(input.scene,facts,results);assert.match(prompt,/- A가 벤치/);assert.doesNotMatch(prompt,/- B가 자전거/);assert.equal(correctionRequest(input.scene,facts,[results[2]]),'');
});

async function running(t,options){const server=createApp(options);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;return async(path,body)=>{const response=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};}

test('API 없이 사용자 그림을 분석한 것처럼 응답하지 않는다',async t=>{
 const request=await running(t,{env:{}});
 const config=await request('/api/config');assert.equal(config.data.verificationEnabled,false);assert.equal(config.data.trainedVerifier,false);
 const value=await request('/api/verification',input);assert.equal(value.status,503);assert.match(value.data.error,/예시|주석/);assert.equal(value.data.results,undefined);
 assert.equal((await request('/api/verification',{...input,image:'data:image/png;base64,YQ=='})).status,400);
});

test('같은 사실·그림을 기존 VLM에 전달하고 서버가 판정을 집계한다',async t=>{
 const calls=[];
 const request=await running(t,{env:{DIARY_API_KEY:'test-only',DIARY_VERIFY_MODEL:'test-vision'},fetcher:async(url,options)=>{calls.push({url,payload:JSON.parse(options.body)});return Response.json({choices:[{message:{content:JSON.stringify({results,status:'supported'})}}]});}});
 const value=await request('/api/verification',input);assert.equal(value.status,200);assert.equal(value.data.status,'review');assert.equal(value.data.model,'test-vision');assert.equal(value.data.trainedModel,false);
 assert.equal(calls.length,1);assert.match(calls[0].url,/chat\/completions$/);assert.equal(calls[0].payload.model,'test-vision');
 const content=calls[0].payload.messages[1].content;assert.equal(content[1].image_url.url,image);assert.equal(content[1].image_url.detail,'high');assert.deepEqual(JSON.parse(content[0].text).facts,factList(input.facts));
});

test('불완전·잘못된 모델 응답과 인증 실패를 판정 결과로 저장하지 않는다',async t=>{
 for(const content of [JSON.stringify({results:results.slice(0,2)}),'not JSON',JSON.stringify({results:results.map(r=>({...r,factId:'unknown'}))})]){
  const request=await running(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async()=>Response.json({choices:[{message:{content}}]})});
  const value=await request('/api/verification',input);assert.equal(value.status,502);assert.equal(value.data.results,undefined);
 }
 const request=await running(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async()=>Response.json({error:{message:'private upstream token',code:'invalid_api_key'}},{status:401})});
 const value=await request('/api/verification',input);assert.equal(value.status,502);assert.doesNotMatch(value.data.error,/private upstream token/);assert.equal(value.data.results,undefined);
});

test('자체 문장–이미지 학습 모델을 키 없이 연결하고 학습 범위를 보존한다',async t=>{
 const calls=[];
 const request=await running(t,{env:{DIARY_VERIFY_BACKEND:'local',DIARY_VERIFIER_URL:'http://127.0.0.1:8010'},fetcher:async(url,options)=>{calls.push({url,options});return Response.json({results,mode:'local_fusion',model:'fusion:test-checkpoint',trainedModel:true,trainingScope:'fusion_head_only_frozen_encoders'});}});
 const value=await request('/api/verification',{...input,backend:'local'});
 assert.equal(value.status,200);assert.equal(value.data.mode,'local_fusion');assert.equal(value.data.trainedModel,true);
 assert.equal(value.data.trainingScope,'fusion_head_only_frozen_encoders');assert.equal(value.data.status,'review');
 assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:8010/verify');
 assert.equal(Object.keys(calls[0].options.headers).some(key=>key.toLowerCase()==='authorization'),false);
 assert.deepEqual(JSON.parse(calls[0].options.body).facts,factList(input.facts));
});
