import test from 'node:test';
import assert from 'node:assert/strict';
import {newSession,currentImage,makeEntry,restorable,localDate} from '../public/state.js';
const image='data:image/jpeg;base64,YQ==';
function sample(){const state=newSession('2026-10-29');state.stage='review';state.draft={title:'산책',body:'공원에서 꽃을 봤다.',scene:'공원 산책'};return state;}
test('글만 있는 일기도 저장할 수 있고 제목과 본문이 비면 거부한다',()=>{const entry=makeEntry(sample(),'id');assert.equal(entry.image,'');assert.equal(entry.imageKind,null);const state=sample();state.draft.body=' ';assert.throws(()=>makeEntry(state,'id'));});
test('글을 다듬어도 그림을 다시 만들 필요가 없고 장면을 바꾸면 기존 그림을 쓰지 않는다',()=>{const state=sample();state.image=image;state.imageScene=state.draft.scene;assert.equal(currentImage(state),image);state.draft.body='공원에서 예쁜 꽃을 봤다.';state.draft.title='꽃 구경';assert.equal(makeEntry(state,'id').image,image);state.draft.scene='집에서 쉬는 모습';assert.equal(currentImage(state),'');assert.equal(makeEntry(state,'id').imageKind,null);});
test('원본 사진은 완성 일기 데이터에 포함하지 않는다',()=>{const state=sample();state.photos=[image];state.turns=[{question:'오늘은요?',answer:'산책했어요.'}];const entry=makeEntry(state,'id');assert.equal('photos' in entry,false);assert.equal('turns' in entry,false);});
test('임시 저장 복원 형식을 확인하고 잘못된 값을 거부한다',()=>{assert.equal(restorable(sample()),true);for(const value of [null,{},{...sample(),stage:'unknown'},{...sample(),photos:['https://example.com']},{...sample(),turns:[null]}])assert.ok(!restorable(value));assert.equal(localDate(new Date(2026,9,29)),'2026-10-29');});
