import argparse
import hashlib
import csv
import html
from itertools import combinations
import json
import random
from collections import defaultdict
from pathlib import Path
from . import LABELS
from .common import read_jsonl, validate_examples, file_sha


def prediction_map(rows, examples, manifest_sha=None):
    expected = {(example["id"], fact["id"]) for example in examples for fact in example["facts"]}
    predictions = {}
    for row in rows:
        key = (row.get("example_id"), row.get("fact_id"))
        if key not in expected or key in predictions or row.get("error") or row.get("label") not in LABELS:
            raise ValueError("Invalid, duplicate, failed or unexpected prediction")
        if manifest_sha and row.get("manifest_sha256") != manifest_sha:
            raise ValueError("Prediction was made against a different manifest")
        predictions[key] = row
    if set(predictions) != expected:
        raise ValueError("Incomplete test coverage; do not compare only successful API/model responses")
    identities = {(row.get("backend"), row.get("model")) for row in rows}
    if len(identities) != 1:
        raise ValueError("A prediction run must identify one model and backend")
    return predictions


def metrics(examples, predictions):
    matrix = {gold: {pred: 0 for pred in LABELS} for gold in LABELS}
    false_pass, error_images, normal_images, false_alarm, deferred = 0, 0, 0, 0, 0
    kind_counts = defaultdict(lambda: {"gold_errors": 0, "found_errors": 0})
    for example in examples:
        gold = [fact["label"] for fact in example["facts"]]
        pred = [predictions[(example["id"], fact["id"])]["label"] for fact in example["facts"]]
        for fact, g, p in zip(example["facts"], gold, pred):
            matrix[g][p] += 1
            if g == "contradicted":
                kind_counts[fact.get("kind", "other")]["gold_errors"] += 1
                kind_counts[fact.get("kind", "other")]["found_errors"] += p == "contradicted"
        if "contradicted" in gold:
            error_images += 1
            false_pass += all(label == "supported" for label in pred)
        if all(label == "supported" for label in gold):
            normal_images += 1
            false_alarm += "contradicted" in pred
        deferred += "uncertain" in pred
    classes = {}
    for label in LABELS:
        tp = matrix[label][label]
        support = sum(matrix[label].values())
        guessed = sum(matrix[g][label] for g in LABELS)
        precision = tp / guessed if guessed else 0.
        recall = tp / support if support else 0.
        classes[label] = {"precision": precision, "recall": recall, "f1": 2*precision*recall/(precision+recall) if precision+recall else 0., "support": support}
    total = sum(sum(row.values()) for row in matrix.values())
    return {"images": len(examples), "facts": total, "groups": len({example['group_id'] for example in examples}), "confusion": matrix, "classes": classes,
            "macro_f1": sum(value['f1'] for value in classes.values()) / 3, "accuracy": sum(matrix[label][label] for label in LABELS) / total if total else None,
            "error_fact_recall": classes['contradicted']['recall'], "error_images": error_images,
            "error_image_false_pass_rate": false_pass/error_images if error_images else None,
            "normal_image_false_alarm_rate": false_alarm/normal_images if normal_images else None,
            "image_abstention_rate": deferred/len(examples) if examples else None,
            "error_recall_by_kind": {kind: {**counts, "recall": counts['found_errors']/counts['gold_errors']} for kind, counts in kind_counts.items()}}


def paired_bootstrap(examples, first, second, iterations=500, seed=42):
    groups = defaultdict(list)
    for example in examples:
        groups[example["group_id"]].append(example)
    keys, rng, differences = list(groups), random.Random(seed), []
    if len(keys) < 2:
        return {"macro_f1_difference_ci95": None, "reason": "Fewer than two independent test groups"}
    for _ in range(iterations):
        sample = [row for _ in keys for row in groups[rng.choice(keys)]]
        differences.append(metrics(sample, second)["macro_f1"] - metrics(sample, first)["macro_f1"])
    differences.sort()
    return {"resampling_unit": "event_image_family", "iterations": iterations,
            "macro_f1_difference": metrics(examples, second)["macro_f1"] - metrics(examples, first)["macro_f1"],
            "macro_f1_difference_ci95": [differences[int(.025*(iterations-1))], differences[int(.975*(iterations-1))]]}


def compare_runs(manifest,prediction_paths,out,bootstrap=500):
    if bootstrap<20:raise ValueError('Use at least 20 bootstrap samples')
    examples = validate_examples(read_jsonl(manifest))
    if not examples:
        raise SystemExit("No test examples: do not manufacture performance figures")
    runs, predictions = {}, {}
    for path in prediction_paths:
        name = Path(path).stem
        if name in runs:
            raise ValueError("Prediction file stems must be unique")
        rows = read_jsonl(path)
        predictions[name] = prediction_map(rows, examples, file_sha(manifest))
        runs[name] = {"model": rows[0]['model'], "backend": rows[0]['backend'], **metrics(examples, predictions[name]),
                      "latency_scopes":sorted({row.get('latency_scope','unspecified') for row in rows}),
                      "total_inference_seconds": sum(row.get('latency_seconds', 0) for row in rows), "prediction_sha256": file_sha(path),
                      "api_usage_totals":{key:sum(row['usage'][key] for row in rows if isinstance(row.get('usage'),dict) and isinstance(row['usage'].get(key),(int,float))) if any(isinstance(row.get('usage'),dict) and isinstance(row['usage'].get(key),(int,float)) for row in rows) else None for key in ['prompt_tokens','completion_tokens','total_tokens']}}
    first = next(iter(runs))
    scope='software_test_fixture_only' if any(run['backend'].startswith('software_test_fixture') for run in runs.values()) else 'collected_fixed_test_set_only'
    if scope!='software_test_fixture_only' and any(run['backend'].startswith('synthetic_controlled') for run in runs.values()):scope='synthetic_controlled_test_only'
    report = {"scope": scope, "manifest_sha256": file_sha(manifest), "runs": runs,
              "paired_against_first_run": {name: paired_bootstrap(examples, predictions[first], predictions[name], bootstrap) for name in runs if name != first},
              "paired_comparisons": {f'{second} minus {first_name}':paired_bootstrap(examples,predictions[first_name],predictions[second],bootstrap) for first_name,second in combinations(runs,2)},
              "note": "No clinical efficacy claim. Synthetic stress-set prevalence is not a generator's production error rate. Single-rater labels are provisional. Probabilities are uncalibrated. Cached-feature head latency is not comparable to end-to-end API/encoder latency."}
    Path(out).parent.mkdir(parents=True,exist_ok=True)
    Path(out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report_artifacts(report,Path(out))
    return report


def write_report_artifacts(report,target):
    metrics_names=['macro_f1','accuracy','error_fact_recall','error_image_false_pass_rate','normal_image_false_alarm_rate','image_abstention_rate','total_inference_seconds','images','facts','groups']
    csv_path=target.with_suffix('.csv')
    with csv_path.open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(['run','model','backend',*metrics_names,'latency_scope'])
        for name,run in report['runs'].items():writer.writerow([name,run['model'],run['backend'],*[run.get(key) for key in metrics_names],'; '.join(run['latency_scopes'])])
    def number(value):return 'N/A' if value is None else f'{value:.4f}'
    headings=['모델','Macro-F1','오류 검출률','오류 정상 통과율','정상 오경보율','보류 비율','처리 시간 합계(초)']
    rows=[]
    for name,run in report['runs'].items():
        rows.append([name,*[number(run.get(key)) for key in ['macro_f1','error_fact_recall','error_image_false_pass_rate','normal_image_false_alarm_rate','image_abstention_rate','total_inference_seconds']]])
    def table(head,values):
        return '<table><thead><tr>'+''.join('<th>'+html.escape(str(v))+'</th>' for v in head)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+html.escape(str(v))+'</td>' for v in row)+'</tr>' for row in values)+'</tbody></table>'
    scope_note='소프트웨어 시험용 임의 자료의 출력입니다. 실제 모델 성능으로 보고하지 않습니다.' if report['scope']=='software_test_fixture_only' else '사람이 정답을 붙인 동일 시험 자료에서 비교한 결과입니다.'
    if report['scope']=='synthetic_controlled_test_only':scope_note='코드로 그린 합성 도식 장면의 실험 성능입니다. 정답은 렌더링 규칙에서 계산했으며 실제 그림일기 성능·생성 모델 오류율·인지 효과와 구분합니다.'
    page=['<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>기억잇다 판정기 성능 비교</title><style>body{font:16px/1.7 system-ui;color:#263f33;background:#f8f7f0;max-width:1200px;margin:auto;padding:30px}table{border-collapse:collapse;background:white;display:block;overflow:auto;margin:20px 0}th,td{padding:12px;border:1px solid #d6dfd0;text-align:left}small{color:#586958}h2{margin-top:36px}</style><h1>그림일기 판정기 성능 비교</h1><p>'+scope_note+' 값은 0~1 비율입니다. 캐시된 특징의 처리 시간에는 인코더 실행 시간이 포함되지 않습니다.</p>',table(headings,rows)]
    for name,run in report['runs'].items():
        page+=['<h2>'+html.escape(name)+'</h2><p>'+html.escape(run['model'])+' · '+html.escape(', '.join(run['latency_scopes']))+'</p>',table(['정답 / 예측',*LABELS],[[gold,*[run['confusion'][gold][pred] for pred in LABELS]] for gold in LABELS])]
        page.append(table(['오류 유형','오류 항목 수','찾아낸 수','재현율'],[[kind,stats['gold_errors'],stats['found_errors'],number(stats['recall'])] for kind,stats in run['error_recall_by_kind'].items()]))
    page.append('<h2>모델 간 사건 묶음 단위 신뢰구간</h2><pre>'+html.escape(json.dumps(report['paired_comparisons'],ensure_ascii=False,indent=2))+'</pre><p><small>자료 범위 안의 기술 평가입니다. 생성 모델 전체의 오류율이나 인지 개선 효과를 의미하지 않습니다. 사람 정답의 독립 검토 상태도 함께 확인하세요.</small></p></html>')
    target.with_suffix('.html').write_text(''.join(page),encoding='utf-8')
    markdown=['# 기억잇다 판정기 성능 비교','', '| '+' | '.join(headings)+' |','|'+'|'.join(['---']*len(headings))+'|']
    markdown+=['| '+' | '.join(row)+' |' for row in rows]
    markdown+=['','판단 보류를 정답으로 바꾸지 않습니다. 시간 비교에는 각 실행의 latency_scope를 함께 확인합니다.','',report['note']]
    target.with_suffix('.md').write_text('\n'.join(markdown)+'\n',encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description="Evaluate and export JSON/CSV/HTML reports on fixed human-labelled data")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--predictions", nargs="+", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--bootstrap", type=int, default=500)
    args=parser.parse_args()
    report=compare_runs(args.manifest,args.predictions,args.out,args.bootstrap)
    print(json.dumps({name: {key: value[key] for key in ['macro_f1','error_fact_recall','error_image_false_pass_rate','image_abstention_rate']} for name, value in report["runs"].items()}, indent=2))


if __name__ == "__main__":
    main()
