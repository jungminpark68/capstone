import http from 'node:http';
import {describeApiError} from './api-errors.js';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {validateSession,localReply,contextOf,localDraft,validateDraft} from './diary.js';
import {questionPrompt,draftPrompt,imagePrompt} from './prompts.js';
const files={'/':['public/index.html','text/html'],'/app.js':['public/app.js','text/javascript'],'/conversation.js':['public/conversation.js','text/javascript'],'/storage.js':['public/storage.js','text/javascript'],'/state.js':['public/state.js','text/javascript'],'/style.css':['public/style.css','text/css'],'/demo.html':['demo.html','text/html']};
export function createApp({env=process.env,fetcher=fetch}={}) {
 const ai=Boolean(env.DIARY_API_KEY?.trim());
 async function api(path,payload,timeout=45000){
  const r=await fetcher('https://api.openai.com/v1'+path,{method:'POST',signal:AbortSignal.timeout(timeout),headers:{Authorization:`Bearer ${env.DIARY_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!r.ok)throw await describeApiError(r);return r.json();
 }
 async function chat(system,session){const result=await api('/chat/completions',{model:env.DIARY_MODEL||'gpt-4o-mini',response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:[{type:'text',text:JSON.stringify({turns:session.turns,context:contextOf(session.turns)})},...session.photos.map(url=>({type:'image_url',image_url:{url,detail:'low'}}))]}]});return JSON.parse(result.choices[0].message.content);}
 return http.createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   if(req.method==='GET'&&req.url==='/api/config')return send(200,{aiEnabled:ai});
   if(req.method==='POST'&&['/api/question','/api/draft','/api/illustration'].includes(req.url)){
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8000000)return send(413,{error:'사진 용량이 너무 커요. 사진 수를 줄여주세요.'});chunks.push(chunk);}
    let data,session,draft;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(req.url==='/api/illustration')draft=validateDraft(data);else session=validateSession(data);}catch(e){return send(400,{error:e instanceof SyntaxError?'잘못된 요청 형식이에요.':e.message});}
    if(req.url==='/api/question'){
     if(!ai)return send(200,{...localReply(session),mode:'local'});
     const result=await chat(questionPrompt,session);
     if(typeof result.question!=='string'||!result.question.trim()||result.question.length>500||typeof result.ready!=='boolean')throw new Error('AI 질문 형식이 올바르지 않아요. 다시 시도해 주세요.');
     return send(200,{question:result.question,ready:result.ready&&session.turns.some(t=>t.answer.trim()),rest:result.rest===true,mode:'ai'});
    }
    if(req.url==='/api/draft'){
     try{localDraft(session.turns);}catch(e){return send(400,{error:e.message});}
     if(!ai)return send(200,localDraft(session.turns));
     return send(200,{...validateDraft(await chat(draftPrompt,session)),mode:'ai'});
    }
    if(!ai)return send(503,{error:'AI 그림 생성에는 .env 파일의 DIARY_API_KEY 설정이 필요해요. 글 초안은 유지돼요.'});
    const result=await api('/images/generations',{model:env.DIARY_IMAGE_MODEL||'gpt-image-1',prompt:imagePrompt(draft),size:'1024x1024',quality:'low',output_format:'jpeg'},120000);
    const b64=result.data?.[0]?.b64_json;if(typeof b64!=='string'||!b64||b64.length>15000000||!/^[A-Za-z0-9+/]+=*$/.test(b64))throw new Error('AI 그림 응답이 올바르지 않아요. 다시 시도해 주세요.');
    return send(200,{image:`data:image/jpeg;base64,${b64}`,mode:'ai'});
   }
   if(req.method==='GET'&&files[req.url]){const [path,type]=files[req.url];const body=await readFile(new URL(path,import.meta.url));res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-cache'});return res.end(body);}
   send(404,{error:'찾을 수 없어요.'});
  }catch(e){send(502,{error:e.name==='TimeoutError'?'생성이 오래 걸려 중단됐어요. 다시 시도해 주세요.':e instanceof SyntaxError?'AI 응답 형식이 올바르지 않아요.':e.message?.startsWith('API ')||e.message?.startsWith('모델 ')||e.message?.startsWith('AI ')?e.message:'AI에 연결하지 못했어요. 네트워크 연결을 확인해 주세요.'});}
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const server=createApp();server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port is already in use. Close the previous server or change PORT in .env.':`Server error: ${e.code}`);process.exitCode=1;});
 server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log(`Open http://localhost:${process.env.PORT||3000} in your browser. Keep this window open.`));
}
