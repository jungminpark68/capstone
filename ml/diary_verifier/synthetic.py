"""Controlled schematic scenes for a synthetic-only Kaggle verification lab.

Ground truth comes from the rendered scene graph, not from a model or a prompt.
Graphs, case names and labels are metadata and never enter the encoder context.
"""
import argparse
import base64
import copy
import hashlib
import html
import json
import random
from collections import Counter,defaultdict
from pathlib import Path
from PIL import Image,ImageDraw
from .common import write_jsonl,read_jsonl,validate_examples,file_sha
from .prepare import split_groups

GENERATOR_VERSION='controlled-schematic-v1'
CASE_LABELS={
 'correct':'정상', 'role_swap':'두 인물의 행동 교환', 'missing_person':'인물 누락',
 'extra_person':'인물 한 명 추가', 'missing_object':'행동에 필요한 사물 누락',
 'wrong_count':'사과 수량 변경', 'wrong_place':'배경 변경', 'spatial_swap':'두 인물의 좌우 교환',
 'wrong_color':'사과 색 변경', 'occluded_actor':'인물·행동 가림', 'occluded_objects':'사과·수량 가림'}
COLORS={'blue':('#487acb','파란색'),'yellow':('#e4bb45','노란색'),'purple':('#9865b1','보라색'),
        'orange':('#e38d49','주황색'),'red':('#cd5d65','빨간색'),'green':('#5c9e7a','초록색')}
ACTIONS={'bike':('자전거를 타고 있다','자전거'),'read':('펼친 책을 양손에 들고 있다','책'),
         'cup':('컵을 한 손에 들고 있다','컵'),'bench':('벤치에 앉아 있다','벤치')}


def make_event(seed):
    rng=random.Random(seed)
    colors=rng.sample(list(COLORS),2);actions=rng.sample(list(ACTIONS),2)
    return {'seed':seed,'place':rng.choice(['park','home']),
        'actors':[{'id':name,'color':colors[i],'action':actions[i],'x':x+rng.randint(-6,6),'y':266+rng.randint(-4,4),
                   'scale':rng.choice([.9,1.0]),'present':True,'has_object':True,'occluded':False}
                  for i,(name,x) in enumerate([('A',90),('B',284)])],
        'apple_count':rng.randint(1,3),'apple_color':rng.choice(['red','green']),'apples_occluded':False,'extra_person':False}


def variant(event,case):
    if case not in CASE_LABELS:raise ValueError('Unknown synthetic case: '+case)
    actual=copy.deepcopy(event);rng=random.Random(event['seed']+173)
    if case=='role_swap':actual['actors'][0]['action'],actual['actors'][1]['action']=actual['actors'][1]['action'],actual['actors'][0]['action']
    elif case=='missing_person':actual['actors'][rng.randrange(2)]['present']=False
    elif case=='extra_person':actual['extra_person']=True
    elif case=='missing_object':actual['actors'][rng.randrange(2)]['has_object']=False
    elif case=='wrong_count':actual['apple_count']=rng.choice([n for n in [1,2,3,4] if n!=event['apple_count']])
    elif case=='wrong_place':actual['place']='home' if event['place']=='park' else 'park'
    elif case=='spatial_swap':actual['actors'][0]['x'],actual['actors'][1]['x']=actual['actors'][1]['x'],actual['actors'][0]['x']
    elif case=='wrong_color':actual['apple_color']='green' if event['apple_color']=='red' else 'red'
    elif case=='occluded_actor':actual['actors'][rng.randrange(2)]['occluded']=True
    elif case=='occluded_objects':actual['apples_occluded']=True
    return actual


def _head(draw,x,y,r=12):
    draw.ellipse((x-r,y-r,x+r,y+r),fill='#f0c8a8',outline='#534b46',width=2)
    draw.arc((x-r,y-r,x+r,y+4),180,360,fill='#6b665f',width=5)
    draw.ellipse((x-5,y-1,x-3,y+1),fill='#443e3a');draw.ellipse((x+3,y-1,x+5,y+1),fill='#443e3a')
    draw.arc((x-4,y+2,x+4,y+7),0,180,fill='#784d48',width=1)


def _actor(draw,actor):
    if not actor['present']:return
    x,y,s=actor['x'],actor['y'],actor['scale'];shirt=COLORS[actor['color']][0]
    def p(dx,dy):return (round(x+dx*s),round(y+dy*s))
    def line(points,color='#414b60',width=6):draw.line([p(*v) for v in points],fill=color,width=width)
    action=actor['action'];obj=actor['has_object']
    if action=='bike':
        if obj:
            for dx in [-35,35]:
                cx,cy=p(dx,-1);r=round(21*s);draw.ellipse((cx-r,cy-r,cx+r,cy+r),fill='#f2f1ea',outline='#41464c',width=4)
                for a,b in [((-17,-15),(17,15)),((-17,15),(17,-15))]:draw.line([(cx+a[0]*s,cy+a[1]*s),(cx+b[0]*s,cy+b[1]*s)],fill='#b8bab5',width=1)
            for pts in [[(-35,-1),(-7,-37),(15,-1),(-35,-1)],[(-7,-37),(23,-37),(35,-1),(15,-1)],[(23,-37),(23,-55),(33,-58)]]:line(pts,'#bc6651',3)
            line([(-17,-41),(-1,-41)],'#4f4642',4)
        line([(-8,-49),(12,-26),(2,-4)]);line([(-8,-49),(-24,-23),(-35,-13)])
        draw.polygon([p(-19,-78),p(0,-88),p(10,-53),p(-12,-43)],fill=shirt,outline='#4c514f')
        line([(-11,-75),(6,-58),(24,-55)],'#d4aa8d',5);_head(draw,*p(-5,-104),round(12*s))
    elif action=='bench':
        if obj:
            draw.rounded_rectangle((*p(-45,-63),*p(45,-50)),radius=3,fill='#a07e56',outline='#66543d',width=2)
            draw.rounded_rectangle((*p(-46,-35),*p(46,-27)),radius=3,fill='#ae8d60',outline='#66543d',width=2)
            line([(-37,-27),(-37,9)],'#66543d',4);line([(37,-27),(37,9)],'#66543d',4)
        line([(-5,-36),(21,-18),(21,6)]);line([(5,-36),(32,-16),(32,6)])
        draw.rounded_rectangle((*p(-15,-83),*p(15,-35)),radius=6,fill=shirt,outline='#4c514f',width=2)
        line([(-15,-72),(-23,-48),(-8,-40)],'#d4aa8d',5);line([(15,-72),(25,-48),(9,-40)],'#d4aa8d',5)
        _head(draw,*p(0,-102),round(12*s))
    else:
        line([(-7,-43),(-10,0)]);line([(7,-43),(12,0)])
        draw.rounded_rectangle((*p(-15,-81),*p(15,-40)),radius=6,fill=shirt,outline='#4c514f',width=2)
        _head(draw,*p(0,-100),round(12*s))
        if action=='read':
            line([(-15,-70),(-24,-48),(-15,-44)],'#d4aa8d',5);line([(15,-70),(24,-48),(15,-44)],'#d4aa8d',5)
            if obj:
                draw.polygon([p(-22,-61),p(0,-57),p(22,-61),p(22,-38),p(0,-34),p(-22,-38)],fill='#f6f0da',outline='#476b85')
                line([(0,-57),(0,-34)],'#7d9db1',2)
                for dx in [-16,5]:
                    for dy in [-51,-45]:line([(dx,dy),(dx+10,dy)],'#aeb6ad',1)
        else:
            line([(-15,-70),(-23,-43)],'#d4aa8d',5);line([(15,-70),(29,-60)],'#d4aa8d',5)
            if obj:
                draw.ellipse((*p(29,-70),*p(44,-56)),outline='#526e89',width=3)
                draw.rounded_rectangle((*p(21,-75),*p(35,-54)),radius=3,fill='#e4eff2',outline='#526e89',width=2)


def render_scene(scene):
    rng=random.Random(scene['seed']);image=Image.new('RGB',(384,384));draw=ImageDraw.Draw(image)
    if scene['place']=='park':
        draw.rectangle((0,0,384,190),fill='#d6e9ef');draw.rectangle((0,190,384,384),fill='#bad19f')
        for x in [28,355]:
            height=rng.randint(105,132);draw.rectangle((x-6,height,x+5,232),fill='#967454')
            draw.ellipse((x-38,height-56,x+38,height+24),fill='#80a977')
        draw.polygon([(0,281),(384,292),(384,315),(0,306)],fill='#e4d7b8')
        cx=rng.randint(80,280);draw.ellipse((cx,30,cx+55,49),fill='#f5f7ef')
    else:
        draw.rectangle((0,0,384,191),fill='#eee3d0');draw.rectangle((0,191,384,384),fill='#d7bb94')
        draw.rectangle((28,35,126,128),fill='#c3dbe4',outline='#a28465',width=5)
        draw.line((77,35,77,128),fill='#f9f4e7',width=5);draw.line((28,81,126,81),fill='#f9f4e7',width=5)
        draw.rectangle((277,48,351,131),fill='#a18770',outline='#75614d',width=3)
        for y in [77,103]:draw.line((279,y,349,y),fill='#705d48',width=3)
        draw.ellipse((10,252,373,300),fill='#c8a789')
    # The apple table is separated from every actor/action region.
    draw.rounded_rectangle((113,335,271,344),radius=3,fill='#9f7958',outline='#68543e',width=2)
    draw.line((126,344,126,373),fill='#795d42',width=4);draw.line((258,344,258,373),fill='#795d42',width=4)
    for i in range(scene['apple_count']):
        x=192+(i-(scene['apple_count']-1)/2)*27
        draw.ellipse((x-10,314,x+10,335),fill='#c95458' if scene['apple_color']=='red' else '#87ad53',outline='#655f43',width=2)
        draw.line((x,315,x+1,309),fill='#71523f',width=2);draw.ellipse((x+1,309,x+8,313),fill='#567849')
    for actor in scene['actors']:_actor(draw,actor)
    if scene['extra_person']:
        color=next(key for key in COLORS if key not in {a['color'] for a in scene['actors']})
        _actor(draw,{'id':'C','color':color,'action':'cup','x':187,'y':214,'scale':.72,'present':True,'has_object':True})
    def cover(box):
        draw.rounded_rectangle(box,radius=3,fill='#6a8873',outline='#4c675b',width=3)
        for x in range(int(box[0])+9,int(box[2]),15):draw.line((x,box[1]+3,x,box[3]-3),fill='#7f9a83',width=2)
    for actor in scene['actors']:
        if actor['occluded']:cover((actor['x']-68,actor['y']-139,actor['x']+69,actor['y']+29))
    if scene['apples_occluded']:cover((108,303,276,378))
    return image


def event_facts(expected):
    a,b=expected['actors'];place='공원' if expected['place']=='park' else '집 안'
    object_name=ACTIONS[a['action']][1];particle='이' if (ord(object_name[-1])-44032)%28 else '가'
    return [
      {'id':'fact-1','kind':'place','text':f'배경은 {place}이다.'},
      {'id':'fact-2','kind':'people_count','text':'주요 인물은 두 명이다.'},
      {'id':'fact-3','kind':'actor_action','text':f"A는 {ACTIONS[a['action']][0]}."},
      {'id':'fact-4','kind':'actor_action','text':f"B는 {ACTIONS[b['action']][0]}."},
      {'id':'fact-5','kind':'object','text':f"{object_name}{particle} 그림에 보인다."},
      {'id':'fact-6','kind':'object_count','text':f"탁자 위 사과는 {expected['apple_count']}개이다."},
      {'id':'fact-7','kind':'relation','text':'A는 B보다 왼쪽에 있다.'},
      {'id':'fact-8','kind':'object_attribute','text':f"탁자 위 사과는 {'빨간색' if expected['apple_color']=='red' else '초록색'}이다."}]


def truth_labels(expected,actual):
    def label(value,hidden=False):return 'uncertain' if hidden else 'supported' if value else 'contradicted'
    actors=actual['actors'];a,b=actors
    labels=[label(actual['place']==expected['place']),label(sum(int(p['present']) for p in actors)+int(actual['extra_person'])==2,any(p['occluded'] for p in actors))]
    for target,shown in zip(expected['actors'],actors):labels.append(label(shown['present'] and shown['action']==target['action'] and shown['has_object'],shown['occluded'] and shown['present']))
    object_action=expected['actors'][0]['action']
    holders=[p for p in actors if p['present'] and p['has_object'] and p['action']==object_action]
    visible=any(not p['occluded'] for p in holders)
    # The additional C holds a cup as drawn, independent of A and B.
    visible=visible or actual['extra_person'] and object_action=='cup'
    labels.append(label(bool(holders) or actual['extra_person'] and object_action=='cup',bool(holders) and not visible))
    labels.append(label(actual['apple_count']==expected['apple_count'],actual['apples_occluded']))
    labels.append(label(a['present'] and b['present'] and a['x']<b['x'],any(p['occluded'] and p['present'] for p in actors)))
    labels.append(label(actual['apple_color']==expected['apple_color'],actual['apples_occluded']))
    return labels


def make_example(seed,case,image_folder,event_id=None):
    expected=make_event(seed);actual=variant(expected,case);image=render_scene(actual)
    import io
    buffer=io.BytesIO();image.save(buffer,format='PNG');raw=buffer.getvalue();digest=hashlib.sha256(raw).hexdigest()
    image_folder=Path(image_folder);image_folder.mkdir(parents=True,exist_ok=True);(image_folder/(digest+'.png')).write_bytes(raw)
    a,b=expected['actors'];scene=f"{'공원' if expected['place']=='park' else '집 안'}에서 A는 {ACTIONS[a['action']][0]}. B는 {ACTIONS[b['action']][0]}."
    characters='\n'.join(f"{p['id']}: {COLORS[p['color']][1]} 상의의 사람" for p in expected['actors'])
    event_id=event_id or f'synthetic-{seed}'
    return {'id':event_id+'-'+case,'event_id':event_id,'group_id':event_id,'image':'images/'+digest+'.png','image_sha256':digest,
      'scene':scene,'characters':characters,'facts':[{**fact,'label':label} for fact,label in zip(event_facts(expected),truth_labels(expected,actual))],
      'annotation_status':'renderer_scene_graph','data_purpose':'synthetic_controlled','synthetic_case':case,'synthetic_expected':expected,'synthetic_actual':actual}


def create_dataset(out,events=30,seed=42):
    out=Path(out)
    if events<6:raise ValueError('Use at least 6 independent base events for this synthetic lab')
    if (out/'dataset-info.json').exists():raise ValueError('Choose a new dataset directory')
    rows=[make_example(seed+1009*index,case,out/'images',f'synthetic-{seed}-{index:04d}') for index in range(events) for case in CASE_LABELS]
    validate_examples(rows);parts=split_groups(rows,seed)
    for name,items in parts.items():write_jsonl(out/(name+'.jsonl'),items)
    info={'schema_version':1,'data_purpose':'synthetic_controlled','annotation_source':'renderer_scene_graph_v1','generator_version':GENERATOR_VERSION,
          'seed':seed,'base_events':events,'images':len(rows),'facts':sum(len(row['facts']) for row in rows),'cases':CASE_LABELS,
          'splits':{name:{'images':len(items),'groups':len({r['group_id'] for r in items}),'labels':dict(Counter(f['label'] for r in items for f in r['facts']))} for name,items in parts.items()},
          'warning':'Controlled schematic test only. Not human-reviewed diary data, a generator error rate, or clinical efficacy evidence.'}
    (out/'dataset-info.json').write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf-8')
    preview=[next(row for row in rows if row['synthetic_case']==case) for case in CASE_LABELS]
    write_gallery(preview,out,out/'cases-preview.html')
    return info


def write_gallery(examples,root,out,predictions=None,title='합성 테스트 케이스'):
    lookup=predictions or {};cards=[]
    labels={'supported':'일치','contradicted':'불일치','uncertain':'판단 불가'}
    for row in examples:
        image=base64.b64encode((Path(root)/row['image']).read_bytes()).decode()
        facts=[]
        for fact in row['facts']:
            predicted=lookup.get((row['id'],fact['id']))
            pred=labels.get(predicted,'미판정');wrong=predicted is not None and predicted!=fact['label']
            facts.append('<tr'+(' class="wrong"' if wrong else '')+'><td>'+html.escape(fact['text'])+'</td><td>'+labels[fact['label']]+'</td><td>'+pred+'</td></tr>')
        cards.append('<article><h2>'+html.escape(CASE_LABELS[row['synthetic_case']])+'</h2><img src="data:image/png;base64,'+image+'"><p>'+html.escape(row['characters']).replace('\n','<br>')+'</p><table><tr><th>확인 사실</th><th>규칙 정답</th><th>모델 예측</th></tr>'+''.join(facts)+'</table></article>')
    page='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(title)+'</title><style>body{font:16px/1.65 system-ui;background:#f6f5ed;color:#2d4438;max-width:1200px;margin:auto;padding:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:20px}article{background:white;border:1px solid #dce2d5;border-radius:15px;padding:20px;min-width:0}img{width:100%;max-width:384px;display:block;margin:auto}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #dde5d8;padding:8px;text-align:left}.wrong{background:#fff0e7}h2{font-size:20px}</style><h1>'+html.escape(title)+'</h1><p>코드로 그린 도식형 합성 장면입니다. 정답은 렌더링 구성·가림 규칙에서 계산하며, 예측 열은 실제 모델을 실행한 경우에만 채웁니다. 실제 그림일기 성능과 구분합니다.</p><div class="grid">'+''.join(cards)+'</div></html>'
    Path(out).write_text(page,encoding='utf-8')


def case_report(manifest,prediction_paths,out):
    import csv
    from .evaluate import prediction_map
    rows=read_jsonl(manifest);reports={};gallery=[]
    for path in prediction_paths:
        raw=read_jsonl(path);lookup=prediction_map(raw,rows,file_sha(manifest));counts=defaultdict(Counter)
        for row in rows:
            count=counts[row['synthetic_case']];count['images']+=1
            for fact in row['facts']:
                label=lookup[(row['id'],fact['id'])]['label'];count['facts']+=1;count['correct']+=label==fact['label']
                if fact['label']=='contradicted':count['errors']+=1;count['found_errors']+=label=='contradicted'
                if fact['label']=='uncertain':count['uncertain']+=1;count['found_uncertain']+=label=='uncertain'
        name=Path(path).stem
        reports[name]={case:{**count,'fact_accuracy':count['correct']/count['facts'],'error_recall':count['found_errors']/count['errors'] if count['errors'] else None,'uncertain_recall':count['found_uncertain']/count['uncertain'] if count['uncertain'] else None} for case,count in counts.items()}
        selected=[]
        for case in CASE_LABELS:
            candidates=[row for row in rows if row['synthetic_case']==case]
            if candidates:selected.append(max(candidates,key=lambda r:sum(lookup[(r['id'],f['id'])]['label']!=f['label'] for f in r['facts'])))
        destination=Path(out).parent/(name+'-cases.html')
        write_gallery(selected,Path(manifest).parent,destination,{key:value['label'] for key,value in lookup.items()},name+' · 오류 유형별 예측 확인')
        gallery.append(str(destination))
    Path(out).write_text(json.dumps({'scope':'synthetic_controlled_test_only','runs':reports,'galleries':gallery},ensure_ascii=False,indent=2),encoding='utf-8')
    with Path(out).with_suffix('.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(['model','case','images','facts','fact_accuracy','error_recall','uncertain_recall'])
        for model,types in reports.items():
            for case,stats in types.items():writer.writerow([model,case,stats['images'],stats['facts'],stats['fact_accuracy'],stats['error_recall'],stats['uncertain_recall']])
    return gallery


def always_supported_baseline(manifest,out):
    rows=read_jsonl(manifest)
    predictions=[{'example_id':row['id'],'fact_id':fact['id'],'label':'supported','backend':'synthetic_controlled_heuristic','model':'always-supported-control',
                  'manifest_sha256':file_sha(manifest),'error':None,'latency_seconds':0,'latency_scope':'constant_rule_not_a_model_runtime'} for row in rows for fact in row['facts']]
    write_jsonl(out,predictions)
    return predictions


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',required=True);parser.add_argument('--events',type=int,default=30);parser.add_argument('--seed',type=int,default=42)
    args=parser.parse_args();print(json.dumps(create_dataset(args.out,args.events,args.seed),ensure_ascii=False,indent=2))


if __name__=='__main__':main()
