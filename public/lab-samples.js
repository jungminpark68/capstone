import {sampleSvg} from './verification-samples.js';
import {sceneFacts} from './diary-record.js';

export const exampleRecord={schemaVersion:1,id:'example-park-01',title:'손녀와 공원에서 보낸 오후',activity:'손녀와 공원 나들이, 자전거 타기',eventDate:'2026-11-12',dateStatus:'known',timeOfDay:'afternoon',
 place:{id:'place-lake-park',name:'호수공원',type:'park'},
 people:[{id:'person-self',name:'할머니',alias:'A',visual:'흰머리, 둥근 안경, 연보라색 옷',action:'벤치에 앉아 쉬고 있다'},{id:'person-granddaughter',name:'손녀',alias:'B',visual:'검은색 묶은 머리, 노란색 옷',action:'자전거를 타고 있다'}],
 objects:[{id:'object-1',name:'벤치',count:1},{id:'object-2',name:'자전거',count:1}],
 scene:'오후에 손녀와 호수공원에 갔어요. 나는 벤치에 앉아 쉬었고, 손녀는 자전거를 탔어요. 두 사람과 벤치 하나, 자전거 하나를 그 장면에 남기고 싶어요.',
 memoryCue:'손녀가 자전거 타던 오후',memoryCueStatus:'provided',relation:'',confirmed:true,scope:'single_experienced_scene',source:{kind:'user_confirmation'}};

const sampleReasons={
 matching:['나무와 야외 산책로가 있는 공원 장면이에요.','설정된 두 주요 인물이 함께 등장해요.','A의 표현 설정을 한 인물이 벤치에 앉아 있어요.','B의 표현 설정을 한 인물이 자전거를 타고 있어요.','벤치 하나가 표현되어 있어요.','자전거 하나가 표현되어 있어요.'],
 swapped:['공원 배경은 유지되어 있어요.','주요 인물 두 명은 모두 등장해요.','벤치에 앉은 인물은 B이고, A는 자전거를 타요. 행동 주체가 바뀌었어요.','B는 벤치에 앉아 있어요. 자전거를 타는 인물은 A예요.','벤치 하나가 있어요.','자전거 하나가 있어요.'],
 missing:['공원 배경은 유지되어 있어요.','A만 보이며 필수 인물 B가 빠졌어요.','A는 벤치에 앉아 있어요.','B가 등장하지 않아, B가 자전거를 타는 조건을 충족하지 못해요.','벤치 하나가 있어요.','타는 사람 없이 자전거 하나가 있어요.'],
 occluded:['공원 배경은 유지되어 있어요.','설정된 주요 인물 두 명은 보여요.','A는 벤치에 앉아 있어요.','풀숲에 B의 하체와 연결 부위가 가려져, 실제로 타는 자세인지 판단하기 어려워요.','벤치 하나가 보여요.','가려진 일부를 제외하고 자전거 한 대의 형태가 보여요.']
};
export const labSamples=[
 {id:'matching',name:'내용 일치',caption:'이야기의 인물과 행동이 그대로 담긴 예시',labels:['supported','supported','supported','supported','supported','supported']},
 {id:'swapped',name:'행동 주체 교환',caption:'사람과 사물은 있지만 누가 무엇을 했는지가 바뀐 예시',labels:['supported','supported','contradicted','contradicted','supported','supported']},
 {id:'missing',name:'인물 누락',caption:'반드시 등장해야 하는 손녀가 빠진 예시',labels:['supported','contradicted','supported','contradicted','supported','supported']},
 {id:'occluded',name:'가려진 행동',caption:'명확한 오류로 단정하지 않고 판단을 보류하는 예시',labels:['supported','supported','supported','uncertain','supported','supported']}
];
export function samplePredictions(id){
 const sample=labSamples.find(item=>item.id===id);
 return sceneFacts(exampleRecord).map((fact,index)=>({factId:fact.id,label:sample.labels[index],reason:sampleReasons[id][index]}));
}
export function sampleImage(id){return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sampleSvg(id))}`;}
