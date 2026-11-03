const DB_NAME='memory-diary';
let connection;
function database(){
 if(!connection)connection=new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(new Error('이 브라우저에서 저장 기능을 사용할 수 없어요.'));return;}
  const request=indexedDB.open(DB_NAME,2);
  request.onupgradeneeded=()=>{const db=request.result;for(const name of ['entries','drafts','meta','events'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'id'});};
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();connection=null;};resolve(db);};
  request.onerror=()=>{connection=null;reject(request.error);};
  request.onblocked=()=>{connection=null;reject(new Error('다른 창을 닫고 다시 시도해 주세요.'));};
 });
 return connection;
}
async function transact(store,mode,action){
 const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let result;const request=action(tx.objectStore(store));request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||request.error);tx.onabort=()=>reject(tx.error||new Error('저장하지 못했어요.'));});
}
export const getDraft=()=>transact('drafts','readonly',s=>s.get('working'));
export const putDraft=data=>transact('drafts','readwrite',s=>s.put({...data,id:'working'}));
export const removeDraft=()=>transact('drafts','readwrite',s=>s.delete('working'));
export const putEntry=data=>transact('entries','readwrite',s=>s.put(data));
export const removeEntry=id=>transact('entries','readwrite',s=>s.delete(id));
export async function listEntries(){await migrateLegacy();const items=await transact('entries','readonly',s=>s.getAll());return items.sort((a,b)=>b.date.localeCompare(a.date)||(b.savedAt||'').localeCompare(a.savedAt||''));}
export async function migrateLegacy(){
 if(await transact('meta','readonly',s=>s.get('legacy-v2')))return;
 let legacy;try{legacy=JSON.parse(localStorage.getItem('memory-diary-v2')||'[]');}catch{return;}
 if(!Array.isArray(legacy))return;
 for(const [i,item] of legacy.entries()){
  if(!item||typeof item.title!=='string'||typeof item.body!=='string'||typeof item.date!=='string')continue;
  const id=typeof item.id==='string'?item.id:`legacy-${i}`;
  if(!await transact('entries','readonly',s=>s.get(id)))await putEntry({...item,id});
 }
 await transact('meta','readwrite',s=>s.put({id:'legacy-v2',done:true}));
 // Preserve the original localStorage copy; do not delete user data during migration.
}

export const listEvents=()=>transact('events','readonly',s=>s.getAll());
export const putEvent=data=>transact('events','readwrite',s=>s.put(data));
export const removeEvent=id=>transact('events','readwrite',s=>s.delete(id));
export async function updateEvent(id,changes,{requireExisting=false}={}){
 const db=await database();return new Promise((resolve,reject)=>{
  const tx=db.transaction('events','readwrite'),store=tx.objectStore('events');let result,missing=false;
  const request=store.get(id);request.onsuccess=()=>{if(requireExisting&&!request.result){missing=true;tx.abort();return;}result={...request.result,...changes,id};store.put(result);};
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(missing?new Error('다른 창에서 지운 일정이에요. 달력을 다시 열어주세요.'):tx.error||new Error('일정을 수정하지 못했어요.'));
 });
}
export async function resetAppData(){
 const db=await database();await new Promise((resolve,reject)=>{
  const tx=db.transaction(['entries','drafts','events','meta'],'readwrite');
  for(const name of ['entries','drafts','events','meta'])tx.objectStore(name).clear();
  // Do not resurrect cleared records from a legacy localStorage copy.
  tx.objectStore('meta').put({id:'legacy-v2',done:true});
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('기록을 초기화하지 못했어요.'));
 });
 for(const key of ['memory-diary-v2','memory-diary-large-type'])try{localStorage.removeItem(key);}catch{}
}
export async function putEvents(events){
 const db=await database();return new Promise((resolve,reject)=>{
  const tx=db.transaction('events','readwrite'),store=tx.objectStore('events');let added=0;
  // Read and write in one transaction so another tab cannot race this check.
  const request=store.getAll();request.onsuccess=()=>{
   const existing=request.result;
   for(const event of events){if(existing.some(old=>old.date===event.date&&old.title===event.title&&old.time===event.time&&old.location===event.location))continue;store.put(event);existing.push(event);added++;}
  };
  tx.oncomplete=()=>resolve(added);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('일정을 저장하지 못했어요.'));
 });
}
