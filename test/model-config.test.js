import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_IMAGE_MODEL,imageModel} from '../model-config.js';
import {createApp} from '../server.js';
import {describeApiError} from '../api-errors.js';
test('이미지 API는 서비스 중인 대체 모델을 기본값으로 사용한다',()=>{
 assert.equal(DEFAULT_IMAGE_MODEL,'gpt-image-2.5-sunburst');assert.equal(imageModel({}),DEFAULT_IMAGE_MODEL);assert.equal(imageModel({DIARY_IMAGE_MODEL:'   '}),DEFAULT_IMAGE_MODEL);
});
test('명시한 모델은 보존하되 종료된 모델은 설정 수정 방법을 안내한다',()=>{
 assert.equal(imageModel({DIARY_IMAGE_MODEL:' gpt-image-2.5-flare '}),'gpt-image-2.5-flare');
 for(const model of ['gpt-image-1','dall-e-2','dall-e-3'])assert.throws(()=>imageModel({DIARY_IMAGE_MODEL:model}),/DIARY_IMAGE_MODEL=gpt-image-2.5-sunburst/);
});
test('종료 모델이 설정되어 있으면 유료 이미지 API를 호출하지 않는다',async t=>{
 let calls=0;const server=createApp({env:{DIARY_API_KEY:'test-only',DIARY_IMAGE_MODEL:'gpt-image-1'},fetcher:async()=>{calls++;throw new Error('must not fetch');}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(r=>server.close(r)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/illustration`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'산책',body:'공원을 걸었다.',scene:'공원 산책'})});const result=await response.json();assert.equal(response.status,502);assert.match(result.error,/서비스가 종료/);assert.match(result.error,/서버를 재시작/);assert.equal(calls,0);
});
test('model invalid_value를 인증 문제로 단정하지 않는다',async()=>{
 const error=await describeApiError(Response.json({error:{code:'invalid_value',param:'model',message:'Invalid model. Access another model.'}},{status:400}));assert.match(error.message,/모델 종료 여부/);assert.doesNotMatch(error.message,/조직 인증/);
});
