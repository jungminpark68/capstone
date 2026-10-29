export function contextOf(turns) {
  const text=turns.map(t=>t.answer).join(' ');
  return {text,hasStory:turns.some(t=>t.answer.trim()),
    company:/혼자|딸|아들|친구|남편|아내|가족|손주|손녀|손자|동생|언니|누나|형|오빠|부부|이웃|어머니|아버지|같이|함께/.test(text),
    feeling:/기분|행복|즐거|즐겁|좋았|좋아|좋더|뿌듯|편안|편했|속상|슬펐|슬프|외로|쓸쓸|고마|감사|재밌|재미있|기뻤|기쁘|신났|불안|걱정|아쉬/.test(text),
    detail:/꽃|나무|바람|햇살|햇빛|새소리|이야기|대화|장미|벚꽃|김치|국수|비빔밥|찌개|불고기|커피|빵|책을|책이|독서|영화|노래|맛있|맛없/.test(text),
    activity:/산책|공원|걷|걸었|먹|식사|음식|밥|요리|만들|갔|다녀|만났|봤|보았|읽|청소|쉬었|쉬고|운동|시장|병원|집에서|집에/.test(text),
    stop:/쉬고 싶|그만|여기까지|피곤|지쳤|기억 안|기억이 안|모르겠|생각이 안/.test(turns.at(-1)?.answer||'')};
}
export function localReply({turns,photos=[]}) {
  const c=contextOf(turns);
  if(!turns.length)return {question:photos.length?'사진에 담긴 오늘의 이야기를 들려주시겠어요?':'오늘 기억에 남는 일이 있나요? 식사나 집에서 보낸 시간도 좋아요.',ready:false};
  if(c.stop)return c.hasStory&&turns.some(t=>t.answer.trim()&&!/쉬고 싶|그만|여기까지|피곤|지쳤|기억.*안|모르겠/.test(t.answer))?{question:'들려주신 이야기로 오늘의 일기를 정리해 볼게요.',ready:true}:{question:'괜찮아요. 잠시 쉬었다가 이어가도 좋아요.',ready:false,rest:true};
  if(c.hasStory&&((c.activity&&c.feeling&&(c.detail||c.text.length>=30))||turns.length>=6))return {question:'들려주신 이야기로 오늘의 일기를 정리해 볼게요.',ready:true};
  const choices=[];
  if(!c.detail){if(/산책|공원|걷|걸었/.test(c.text))choices.push('걸으면서 무엇이 가장 눈에 들어오셨나요?');else if(/먹|식사|음식|밥/.test(c.text))choices.push('어떤 음식을 드셨나요?');else if(/시장|장보|장 봤/.test(c.text))choices.push('시장에서 무엇을 보고 오셨나요?');}
  if(c.hasStory&&!c.feeling)choices.push('그 시간을 보내고 나니 기분이 어떠셨어요?');
  if(!c.activity)choices.push('오늘 하신 일 중 한 가지만 편하게 들려주시겠어요?');
  if(!c.detail)choices.push('그때 기억에 남는 것이 하나 있었나요?');
  const question=choices.find(q=>!turns.some(t=>t.question===q));
  if(question)return {question,ready:false};
  return c.hasStory?{question:'들려주신 이야기로 오늘의 일기를 정리해 볼게요.',ready:true}:{question:'답하기 어려우면 잠시 쉬어도 괜찮아요.',ready:false,rest:true};
}
