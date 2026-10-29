export {contextOf,localReply} from './public/conversation.js';
export function validateSession(input) {
 if(!input||!Array.isArray(input.turns)||input.turns.length>8||input.turns.some(t=>!t||typeof t.question!=='string'||t.question.length>500||typeof t.answer!=='string'||t.answer.length>2000))throw new Error('대화 형식이 올바르지 않아요.');
 const photos=input.photos??[];
 if(!Array.isArray(photos)||photos.length>5||photos.some(p=>typeof p!=='string'||p.length>1500000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(p)))throw new Error('사진은 JPEG 형식으로 최대 5장까지 사용할 수 있어요.');
 return {turns:input.turns,photos};
}
export function localDraft(turns) {
 const answers=turns.map(t=>t.answer.trim()).filter(Boolean);
 if(!answers.length)throw new Error('한 가지 이야기라도 들려주세요.');
 return {title:'오늘의 소중한 기억',body:answers.join('\n'),scene:answers.join(' ').slice(0,3000),mode:'local'};
}
export function validateDraft(draft) {
 const out={};for(const [key,max] of [['title',200],['body',8000],['scene',3000]]){if(typeof draft?.[key]!=='string'||!draft[key].trim()||draft[key].length>max)throw new Error('제목, 일기, 그림 설명을 확인해 주세요.');out[key]=draft[key].trim();}return out;
}
