export const VERIFICATION_LABELS = Object.freeze({
 supported: {title:'이야기와 일치', short:'일치'},
 contradicted: {title:'내용이 다름', short:'불일치'},
 uncertain: {title:'판단하기 어려움', short:'판단 보류'}
});

export function factList(lines) {
 const texts = Array.isArray(lines) ? lines : String(lines || '').split(/\r?\n/);
 const facts = texts.map(text => String(text).trim()).filter(Boolean);
 if (!facts.length || facts.length > 16) throw new Error('검사할 사실을 한 줄에 하나씩, 1~16개 적어주세요.');
 if (facts.some(text => text.length > 300)) throw new Error('각 사실은 300자 이내로 적어주세요.');
 if (new Set(facts).size !== facts.length) throw new Error('같은 사실이 중복되어 있어요. 한 번씩만 적어주세요.');
 return facts.map((text, index) => ({id:`fact-${index + 1}`, text}));
}

export function summarizeVerification(results) {
 if (!Array.isArray(results) || !results.length || results.some(result => !Object.hasOwn(VERIFICATION_LABELS, result.label))) {
  throw new Error('검증 결과가 비어 있거나 올바르지 않아요.');
 }
 const counts = {supported:0, contradicted:0, uncertain:0};
 for (const result of results) counts[result.label]++;
 return {
  status:counts.contradicted ? 'review' : counts.uncertain ? 'uncertain' : 'supported',
  counts,
  total:results.length
 };
}

export function validateVerificationResults(value, facts) {
 const invalid = () => { throw new Error('AI 검증 응답이 사실 목록과 맞지 않아요. 판정을 확정하지 않았어요. 다시 시도해 주세요.'); };
 if (!value || !Array.isArray(value.results) || value.results.length !== facts.length) invalid();
 const allowed = new Set(facts.map(fact => fact.id));
 const found = new Map();
 for (const result of value.results) {
  if (!result || !allowed.has(result.factId) || found.has(result.factId) ||
      !Object.hasOwn(VERIFICATION_LABELS, result.label) ||
      typeof result.reason !== 'string' || !result.reason.trim() || result.reason.length > 800) invalid();
  found.set(result.factId, {factId:result.factId, label:result.label, reason:result.reason.trim()});
 }
 return facts.map(fact => found.get(fact.id) || invalid());
}

export function correctionRequest(scene, facts, results) {
 const corrections = results.filter(result => result.label === 'contradicted')
  .map(result => facts.find(fact => fact.id === result.factId)?.text).filter(Boolean);
 if (!corrections.length) return '';
 return `확인한 장면: ${scene}\n\n다음 사실과 그림이 일치하도록 수정해 주세요.\n${corrections.map(text => `- ${text}`).join('\n')}\n\n나머지 확인된 사실은 유지하고, 판단하기 어려운 정보는 새로 지어내지 마세요. 수정 후에는 다시 확인이 필요합니다.`;
}
