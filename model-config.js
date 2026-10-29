// OpenAI's official SDK marks gpt-image-1 as shut down on 2026-10-23.
// https://github.com/openai/openai-node/blob/master/src/resources/images.ts
export const DEFAULT_IMAGE_MODEL='gpt-image-2.5-sunburst';
export function imageModel(env){
 const selected=env.DIARY_IMAGE_MODEL?.trim()||DEFAULT_IMAGE_MODEL;
 if(['gpt-image-1','dall-e-2','dall-e-3'].includes(selected)){
  throw new Error(`AI 이미지 모델 ${selected}은 서비스가 종료됐어요. .env에서 DIARY_IMAGE_MODEL=${DEFAULT_IMAGE_MODEL}로 바꾸고 서버를 재시작해 주세요.`);
 }
 return selected;
}
