import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSession,localReply,localDraft,validateDraft} from '../diary.js';
import {createApp} from '../server.js';
test('사진 없는 시작과 다중 사진 시작',()=>{
 assert.match(localReply({turns:[],photos:[]}).question,/오늘 기억/);
 assert.match(localReply({turns:[],photos:['a','b']}).question,/사진/);
});
test('이미 말한 동행자를 다시 묻지 않고 충분하면 조기 마무리',()=>{
 const turns=[{question:'오늘은요?',answer:'딸과 공원에서 산책했어요.'}];const reply=localReply({turns});assert.match(reply.question,/눈에/);assert.doesNotMatch(reply.question,/누구|장면/);
 turns.push({question:reply.question,answer:'벚꽃이 예뻐서 행복했어요.'});assert.equal(localReply({turns}).ready,true);
});
test('음식 이름과 건너뛴 질문을 반복하지 않는다',()=>{
 const turns=[{question:'오늘은요?',answer:'친구와 국수를 먹었어요.'}];const reply=localReply({turns});assert.doesNotMatch(reply.question,/어떤 음식|누구|장면/);turns.push({question:reply.question,answer:''});assert.notEqual(localReply({turns}).question,reply.question);
});
test('피로 의사에는 휴식 또는 추가 질문 없이 마무리',()=>{
 assert.equal(localReply({turns:[{question:'오늘은요?',answer:'그만하고 싶어요.'}]}).rest,true);
 assert.equal(localReply({turns:[{question:'오늘은요?',answer:'산책했어요.'},{question:'풍경은요?',answer:'피곤해요. 그만할래요.'}]}).ready,true);
});
test('발언만 보존하고 빈 이야기와 잘못된 입력은 거부',()=>{
 assert.equal(localDraft([{answer:'공원에 갔어요.'},{answer:''}]).body,'공원에 갔어요.');assert.throws(()=>localDraft([]));
 for(const input of [null,{turns:[{answer:1}]},{turns:[],photos:Array(6).fill('x')},{turns:[],photos:['https://example.com/image']}])assert.throws(()=>validateSession(input));
 assert.throws(()=>validateDraft({title:'t',body:'b',scene:''}));
});
async function running(t,options){const server=createApp(options);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;return async(path,body)=>{const r=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};}
test('HTTP: 체험 대화와 초안, 키 없는 그림 생성 안내',async t=>{
 const req=await running(t,{env:{}});assert.equal((await req('/api/config')).data.aiEnabled,false);
 const q=await req('/api/question',{turns:[]});assert.equal(q.status,200);
 const draft=await req('/api/draft',{turns:[{question:q.data.question,answer:'집에서 책을 읽었어요.'}]});assert.equal(draft.data.body,'집에서 책을 읽었어요.');
 const image=await req('/api/illustration',draft.data);assert.equal(image.status,503);assert.match(image.data.error,/DIARY_API_KEY/);
 assert.equal((await req('/api/draft',{turns:[]})).status,400);
});
test('AI 계약: 다중 사진 전달 및 확인한 이야기로 삽화 생성',async t=>{
 const calls=[],photo='data:image/jpeg;base64,YQ==';
 const req=await running(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async(url,options)=>{const payload=JSON.parse(options.body);calls.push({url,payload});if(url.endsWith('/images/generations'))return Response.json({data:[{b64_json:'YQ=='}]});return Response.json({choices:[{message:{content:JSON.stringify(payload.messages[0].content.includes('대화 동반자')?{question:'어떤 꽃이 기억나세요?',ready:false,rest:false}:{title:'산책',body:'공원에서 꽃을 봤다.',scene:'공원에서 꽃을 보는 장면'})}}]});}});
 const session={turns:[{question:'오늘은요?',answer:'공원에서 꽃을 봤어요.'}],photos:[photo,photo]};
 assert.equal((await req('/api/question',session)).data.question,'어떤 꽃이 기억나세요?');assert.equal(calls[0].payload.messages[1].content.filter(c=>c.type==='image_url').length,2);
 const draft=await req('/api/draft',session);assert.equal(draft.data.mode,'ai');const image=await req('/api/illustration',draft.data);assert.equal(image.data.image,photo);assert.match(calls[2].payload.prompt,/공원에서 꽃/);assert.equal(calls[2].payload.model,'gpt-image-2.5-sunburst');
});
test('실제 AI 응답의 종료 신호 전달, 빈 대화 조기 종료 방지',async t=>{
 const req=await running(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async()=>Response.json({choices:[{message:{content:JSON.stringify({question:'일기를 정리할게요.',ready:true})}}]})});
 assert.equal((await req('/api/question',{turns:[]})).data.ready,false);
 assert.equal((await req('/api/question',{turns:[{question:'오늘은요?',answer:'산책했어요.'}]})).data.ready,true);
});
test('인증 및 잘못된 이미지 응답을 성공으로 처리하지 않는다',async t=>{
 const denied=await running(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async()=>new Response('denied',{status:401})});assert.match((await denied('/api/question',{turns:[]})).data.error,/키/);
 const broken=await running(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async()=>Response.json({data:[]})});assert.equal((await broken('/api/illustration',{title:'t',body:'b',scene:'s'})).status,502);
});

test('상세 오류 분류와 민감한 원문 비노출',async t=>{
 const {describeApiError}=await import('../api-errors.js');
 const billing=await describeApiError(Response.json({error:{code:'billing_hard_limit_reached',message:'Billing limit reached'}},{status:400}));assert.match(billing.message,/결제/);assert.match(billing.message,/code=billing_hard_limit_reached/);
 const unsupported=await describeApiError(Response.json({error:{code:'unsupported_parameter',param:'quality',message:'Unsupported option with sk-secret and private prompt'}},{status:400}));assert.match(unsupported.message,/param=quality/);assert.doesNotMatch(unsupported.message,/sk-secret|private prompt/);
 const plain=await describeApiError(new Response('private upstream response',{status:400}));assert.match(plain.message,/HTTP 400/);assert.doesNotMatch(plain.message,/private/);
 const req=await running(t,{env:{DIARY_API_KEY:'test-only'},fetcher:async()=>Response.json({error:{code:'billing_hard_limit_reached'}},{status:400})});const result=await req('/api/illustration',{title:'산책',body:'산책했다.',scene:'공원 산책'});assert.match(result.data.error,/code=billing_hard_limit_reached/);
});
