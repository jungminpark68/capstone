import test from 'node:test';
import assert from 'node:assert/strict';
import {diaryDetailModel,diaryImageSource} from '../public/diary-view.js';

function diaryFixture(){
 return {title:'공원에서 보낸 오후',body:'손녀의 자전거 타기를 응원했다.',date:'2026-11-20',
  sceneRecord:{id:'park',dateStatus:'known',eventDate:'2026-11-20',timeOfDay:'afternoon',place:{name:'호수공원',type:'park'},activity:'자전거 타기',
   people:[{id:'me',name:'나',action:'벤치에서 응원',visual:'보라색 옷'},{id:'child',name:'손녀',action:'자전거 타기',visual:'노란색 옷'}],
   objects:[{name:'자전거',count:1}],topic:'자전거 타기',topicSource:'derived_from_activity',emotion:{text:'뿌듯했어요.',status:'provided'},memoryCue:'처음 혼자 탄 날',memoryCueStatus:'provided',collectionStatus:{objects:'provided'},importanceRating:3,importanceStatus:'provided'},
  experiences:{selectedEventId:'park',events:[{id:'hospital',title:'병원 방문',scene:'오전에 진료를 받았다.'}],importance:{eventId:'park',value:5,status:'provided'}},
  generation:{usedInformation:{selectedEventId:'park',facts:[{text:'손녀는 자전거를 탄다.'}]}},conversation:{turns:[{question:'그때 기분은?',answer:'뿌듯했어요.',phase:'selected_event_details'}]}};
}

test('saved diary uses selected-event facts and rating without mutating stored data',()=>{
 const entry=diaryFixture(),before=structuredClone(entry),view=diaryDetailModel(entry);
 assert.equal(view.rating.value,5);
 assert.deepEqual(view.metadata[1].lines,['나: 벤치에서 응원','손녀: 자전거 타기']);
 assert.equal(view.metadata[2].lines[1],'자전거 (1개)');
 assert.deepEqual(view.otherEvents.map(event=>event.id),['hospital']);
 assert.deepEqual(view.generation.facts,['손녀는 자전거를 탄다.']);
 assert.deepEqual(entry,before);
});

test('legacy text-only diary stays readable without fabricated metadata or stars',()=>{
 const view=diaryDetailModel({date:'2025-01-02',title:'옛 일기',body:'산책했다.'});
 assert.equal(view.record,null);assert.equal(view.image,'');assert.deepEqual(view.metadata,[]);
 assert.deepEqual(view.rating,{status:'not_asked',value:null});assert.deepEqual(view.conversation,[]);
});

test('rating of a different event cannot appear on the selected diary',()=>{
 const entry=diaryFixture();entry.experiences.importance.eventId='hospital';
 entry.sceneRecord.importanceRating=null;entry.sceneRecord.importanceStatus='not_asked';
 entry.conversation.importance={eventId:'hospital',value:4,status:'provided'};
 assert.deepEqual(diaryDetailModel(entry).rating,{status:'not_asked',value:null});
});

test('skipped importance and unknown fields override stale stored values',()=>{
 const entry=diaryFixture();entry.experiences.importance={eventId:'park',status:'skipped',value:null};
 Object.assign(entry.sceneRecord,{dateStatus:'unknown',eventDate:null,timeOfDay:'unknown',memoryCueStatus:'declined',objects:[]});
 entry.sceneRecord.collectionStatus={place:'unknown',time:'unknown',objects:'none'};
 const view=diaryDetailModel(entry);
 assert.deepEqual(view.rating,{status:'skipped',value:null});
 assert.match(view.metadata[0].lines[0],/날짜는 기억나지/);
 assert.equal(view.metadata[0].lines[1],'기억나지 않아요.');
 assert.equal(view.metadata[2].lines[1],'없다고 말씀하셨어요.');
 assert.equal(view.metadata[4].lines[0],'답변을 건너뛰었어요.');
});

test('missing object information is distinguished from an explicit none answer',()=>{
 const entry=diaryFixture();entry.sceneRecord.objects=[];entry.sceneRecord.collectionStatus.objects='not_asked';
 assert.equal(diaryDetailModel(entry).metadata[2].lines[1],'아직 확인하지 않았어요.');
});

test('mismatched scene record is not used as the currently selected event',()=>{
 const entry=diaryFixture();entry.experiences.selectedEventId='other';
 const view=diaryDetailModel(entry);
 assert.equal(view.record,null);assert.equal(view.rating.value,null);
 assert.equal(view.generation.eventId,'park');
});

test('recorded selection and generation snapshot support older structured entries',()=>{
 const entry=diaryFixture();const snapshot=entry.sceneRecord;
 delete entry.sceneRecord;delete entry.experiences;
 entry.generation.recordAtGeneration=snapshot;
 const view=diaryDetailModel(entry);assert.equal(view.record.id,'park');assert.equal(view.rating.value,3);
 assert.deepEqual(view.otherEvents,[]);
});

test('saved image accepts embedded raster images and rejects remote or executable sources',()=>{
 for(const type of ['jpeg','png','webp'])assert.equal(diaryImageSource(`data:image/${type};base64,YWJj`),`data:image/${type};base64,YWJj`);
 for(const src of ['https://example.com/image.png','javascript:alert(1)','data:image/svg+xml;base64,YWJj','data:image/png;base64,<script>'])assert.equal(diaryImageSource(src),'');
});
