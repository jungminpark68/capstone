// Never forward the upstream message: it can echo prompts, images, or credentials.
export async function describeApiError(response) {
 let error={};try{error=(await response.json())?.error||{};}catch{}
 const evidence=[error.code,error.type,error.message].filter(x=>typeof x==='string').join(' ').toLowerCase();
 const messages={401:'API 키가 유효한지 확인해 주세요.',403:'모델 접근 권한이나 조직 인증을 확인해 주세요.',429:'API 잔액 또는 호출 한도를 확인하고 잠시 뒤 다시 시도해 주세요.'};
 let message=messages[response.status]||`AI 서비스 요청이 실패했어요 (HTTP ${response.status}).`;
 if(/billing|insufficient_quota|credit|balance/.test(evidence))message='API 결제 한도 또는 크레딧이 부족해요. 키가 속한 프로젝트의 결제 설정을 확인해 주세요.';
 else if(/verif|organization.*must/.test(evidence))message='모델 사용을 위해 OpenAI 조직 인증이 필요한지 확인해 주세요.';
 else if(/moderation|content_policy|safety/.test(evidence))message='AI 서비스가 이 내용의 생성을 제한했어요. 장면 설명을 확인해 주세요.';
 else if(error.param==='model'&&error.code==='invalid_value')message='AI API가 설정된 모델 값을 거부했어요. 모델 종료 여부와 서버의 모델 설정을 확인해 주세요.';
 else if(/model_not_found|does not exist|model.*access/.test(evidence))message='모델 이름과 해당 프로젝트의 모델 사용 권한을 확인해 주세요.';
 else if(/unsupported|invalid_value|invalid_parameter|unknown_parameter/.test(evidence))message='AI 모델이 요청 옵션을 지원하지 않거나 설정값이 맞지 않아요.';
 // Show only short technical identifiers, never a provider's free-form message.
 const safe=value=>typeof value==='string'&&/^[a-z][a-z0-9_.\[\]-]{0,79}$/.test(value)&&!/^sk-/.test(value)?value:null;
 const detail=[['code',safe(error.code)],['param',safe(error.param)]].filter(([,v])=>v).map(([k,v])=>`${k}=${v}`);
 return new Error(`${message} [HTTP ${response.status}${detail.length?'; '+detail.join('; '):''}]`);
}
