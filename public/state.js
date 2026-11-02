import {validDate,calendarEvent} from './calendar.js';
export function localDate(date=new Date()){
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function readableDate(value){const date=new Date(`${value}T12:00:00`);return Number.isNaN(date.getTime())?value:date.toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'short'});}
export function newSession(date=localDate()){
 return {version:1,date,stage:'conversation',photos:[],turns:[],question:'',answer:'',todayEvents:[],tomorrowText:'',planCandidates:[],plansReviewed:false,plansSaved:false,draft:null,image:'',imageScene:'',updatedAt:new Date().toISOString()};
}
export function currentImage(state){return typeof state?.image==='string'&&/^data:image\/jpeg;base64,/.test(state.image)&&state.draft?.scene?.trim()===state.imageScene?state.image:'';}
export function makeEntry(state,id){
 if(!state?.draft?.title?.trim()||!state.draft.body?.trim())throw new Error('일기의 제목과 내용을 확인해 주세요.');
 const image=currentImage(state);
 return {id,date:state.date,title:state.draft.title.trim(),body:state.draft.body.trim(),scene:state.draft.scene?.trim()||'',image,imageKind:image?'ai':null,savedAt:new Date().toISOString()};
}
export function restorable(value){
 return value?.version===1&&validDate(value.date)&&(!value.todayEvents||validEvents(value.todayEvents))&&(!value.planCandidates||validCandidates(value.planCandidates))&&(value.tomorrowText===undefined||typeof value.tomorrowText==='string'&&value.tomorrowText.length<=2000)&&typeof value.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.date)&&['photos','conversation','rest','tomorrow','review','result'].includes(value.stage)&&Array.isArray(value.turns)&&value.turns.length<=8&&value.turns.every(t=>typeof t?.answer==='string'&&typeof t?.question==='string')&&Array.isArray(value.photos)&&value.photos.every(p=>typeof p==='string'&&p.startsWith('data:image/jpeg;base64,'))&&typeof value.question==='string'&&typeof value.answer==='string'&&(!['review','result'].includes(value.stage)||value.draft&&typeof value.draft.title==='string'&&typeof value.draft.body==='string'&&typeof value.draft.scene==='string');
}

function validEvents(events){try{return Array.isArray(events)&&events.length<=20&&events.every(e=>Boolean(calendarEvent(e)));}catch{return false;}}

function validCandidates(events){return Array.isArray(events)&&events.length<=5&&events.every(e=>e&&typeof e.id==='string'&&['title','date','time','location'].every(key=>typeof e[key]==='string')&&e.title.length<=100&&e.location.length<=200);}
