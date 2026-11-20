export const sampleScene = '손녀와 공원에 갔어요. 할머니는 벤치에 앉아 쉬고, 손녀는 자전거를 탔어요. 두 사람을 주인공으로 남긴 장면이에요.';
export const sampleCharacters = '이 예시에서 할머니는 흰머리와 둥근 안경, 연보라색 옷으로 표현한다. 손녀는 검은색 묶은 머리와 노란색 옷으로 표현한다. 실제 신원이나 가족관계를 외형만으로 추정하는 예시가 아니다.';
export const sampleFacts = ['배경은 공원이다.','할머니는 벤치에 앉아 있다.','손녀는 자전거를 타고 있다.','주요 등장인물 두 명이 모두 표현되어 있다.'];

const matching = [
 {label:'supported',reason:'나무와 산책로, 야외 벤치가 있는 공원 장면으로 구성되어 있어요.',region:[28,60,662,365]},
 {label:'supported',reason:'예시 인물 설정의 흰머리·안경·보라색 옷을 한 할머니가 벤치에 앉아 있어요.',region:[163,182,137,196]},
 {label:'supported',reason:'예시 인물 설정의 검은 머리·노란색 옷을 한 손녀가 자전거 위에 앉아 있어요.',region:[392,180,216,235]},
 {label:'supported',reason:'이야기의 두 주인공인 할머니와 손녀가 모두 등장해요.',region:[152,171,465,246]}
];

export const verificationSamples = [
 {id:'matching',name:'이야기와 맞는 그림',short:'일치 예시',description:'확인한 장면의 인물과 행동이 그대로 담긴 경우',results:matching},
 {id:'swapped',name:'역할이 바뀐 그림',short:'역할 교환',description:'인물과 사물은 있지만, 누가 무엇을 했는지가 바뀐 경우',results:[
  matching[0],
  {label:'contradicted',reason:'벤치에는 노란색 옷의 손녀가 앉아 있고, 할머니는 자전거를 타고 있어요. 기록과 역할이 달라요.',region:[157,179,457,235]},
  {label:'contradicted',reason:'자전거를 타는 인물이 보라색 옷과 흰머리의 할머니로 바뀌어 있어요.',region:[392,176,218,240]},
  matching[3]
 ]},
 {id:'occluded',name:'일부가 가려진 그림',short:'판단 보류',description:'손녀의 자세가 가려져, 자전거를 타는지 확인하기 어려운 경우',results:[
  matching[0],matching[1],
  {label:'uncertain',reason:'풀숲이 손녀의 하체와 자전거의 연결 부분을 가리고 있어요. 타고 있는지 옆에 서 있는지 이 그림만으로 확정하지 않아요.',region:[402,243,221,162]},
  matching[3]
 ]}
];

function person(older, pose, x, y, scale=1) {
 const hair=older?'#f5f0e8':'#40382f', shirt=older?'#a49cbd':'#eac477', trousers=older?'#707985':'#8e997d';
 const legs=pose==='seated' ? '<path d="M-15 84L32 94L39 135M9 85L49 93L55 135"/>' : '<path d="M5 82L-22 111L10 139M24 82L44 105L13 139"/>';
 const arms=pose==='seated' ? '<path d="M-16 36L-27 63L0 79M18 35L34 61L22 80"/>' : '<path d="M-16 35L9 63L61 64M15 34L33 57L65 61"/>';
 return `<g transform="translate(${x} ${y}) scale(${scale})"><ellipse cx="14" cy="143" rx="53" ry="8" fill="#65765c" opacity=".09"/>
 <g fill="none" stroke="${trousers}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round">${legs}</g>
 <g fill="none" stroke="#675d55" stroke-width="8" stroke-linecap="round"><path d="M${pose==='seated'?'34 137L51 138M50 137L68 138':'6 141L24 140M13 140L30 139'}"/></g>
 <path d="M-20 26Q0 18 21 29L31 81Q9 96-28 83Z" fill="${shirt}"/><path d="M-8 25L0 43L11 26" stroke="#fff" stroke-opacity=".35" stroke-width="2" fill="none"/>
 <g fill="none" stroke="${shirt}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">${arms}</g>
 <g fill="none" stroke="#ddb491" stroke-width="7" stroke-linecap="round">${pose==='seated'?'<path d="M-4 78L5 79M20 80L29 80"/>':'<path d="M57 64L69 63"/>'}</g>
 <path d="M-6 17V29Q1 35 9 27V16" fill="#dfb38d"/>
 ${older?'<circle cx="-15" cy="-22" r="16" fill="#e5dfd8"/><path d="M-26-6Q-33-35-5-37Q28-34 26-6Z" fill="#eae5df"/>':'<path d="M-26 0Q-30-35-2-35Q28-34 26 1Z" fill="#40382f"/><circle cx="27" cy="-13" r="15" fill="#40382f"/><path d="M25-23L34-14" stroke="#d4a373" stroke-width="5"/>'}
 <ellipse cy="-1" rx="24" ry="27" fill="#eac2a0"/>
 <path d="M-25-7Q-26-35-1-33Q23-34 25-7Q5-13-3-23Q-9-12-25-7" fill="${hair}"/>
 <g fill="#5a4a40"><ellipse cx="-9" cy="0" rx="1.8" ry="2.2"/><ellipse cx="9" cy="0" rx="1.8" ry="2.2"/></g>
 ${older?'<g fill="none" stroke="#7f786e" stroke-width="1.7"><circle cx="-10" cy="0" r="9"/><circle cx="10" cy="0" r="9"/><path d="M-1-1H1M-19-1L-24-3M19-1L24-3"/></g>':''}
 <ellipse cx="-15" cy="10" rx="5" ry="3" fill="#cf8e7c" opacity=".35"/><ellipse cx="15" cy="10" rx="5" ry="3" fill="#cf8e7c" opacity=".35"/><path d="M-5 13Q0 18 6 13" fill="none" stroke="#a57562" stroke-width="1.8" stroke-linecap="round"/>
 </g>`;
}

export function sampleSvg(id='matching') {
 const swapped=id==='swapped', occluded=id==='occluded';
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 480" role="img" aria-label="${swapped?'손녀가 벤치에 앉고 할머니가 자전거를 타는':occluded?'풀숲에 손녀의 자세가 가려진':'할머니가 벤치에 앉고 손녀가 자전거를 타는'} 도식화된 예시 삽화">
 <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#f2efe6"/><stop offset="1" stop-color="#f8f3e8"/></linearGradient><filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter></defs>
 <rect width="720" height="480" fill="url(#sky)"/><circle cx="539" cy="77" r="32" fill="#edcf91" opacity=".8"/>
 <path d="M0 322Q133 279 264 320Q391 272 720 310V480H0Z" fill="#dde2c7"/><path d="M0 376Q209 320 366 369T720 349V480H0Z" fill="#c8d3b2"/>
 <path d="M113 480Q150 365 375 356Q564 345 720 422V480Z" fill="#e6d9bf"/>
 <g stroke="#a59a7e" stroke-width="13" stroke-linecap="round"><path d="M90 337V131M91 237L52 203M92 210L128 173M651 322V125M652 215L611 180M651 185L680 154"/></g>
 <g fill="#bccda7"><ellipse cx="65" cy="158" rx="53" ry="62"/><ellipse cx="114" cy="118" rx="62" ry="77"/><ellipse cx="137" cy="182" rx="45" ry="59"/></g>
 <g fill="#b5c89d"><ellipse cx="616" cy="137" rx="52" ry="66"/><ellipse cx="665" cy="104" rx="61" ry="71"/><ellipse cx="699" cy="160" rx="49" ry="62"/></g>
 <g fill="#d0dab9" opacity=".75"><ellipse cx="80" cy="118" rx="38" ry="53"/><ellipse cx="642" cy="91" rx="37" ry="46"/></g>
 <path d="M316 126Q326 116 337 126M345 109Q355 99 366 109" fill="none" stroke="#a4aa96" stroke-width="2.5" stroke-linecap="round"/>
 <ellipse cx="239" cy="374" rx="129" ry="14" fill="#6a7e58" opacity=".12"/>
 <g stroke="#8a8b76" stroke-width="8" stroke-linecap="round"><path d="M133 305V369M324 304V369"/></g>
 <g stroke="#b48d66" stroke-width="15" stroke-linecap="round"><path d="M122 278H331M122 302H331M115 328H340"/></g>
 <path d="M119 335H339" stroke="#9b7858" stroke-width="5"/>
 <g transform="translate(486 345)"><ellipse cy="44" rx="125" ry="10" fill="#65765c" opacity=".12"/>
 <g fill="none" stroke="#707c73" stroke-width="5"><circle cx="-65" cy="25" r="40"/><circle cx="75" cy="25" r="40"/></g>
 <g stroke="#b9c3ad" stroke-width="1.5"><path d="M-65-15V65M-105 25H-25M35 25H115M75-15V65M-93-3L-37 53M47-3L103 53M-93 53L-37-3M47 53L103-3"/></g>
 <path d="M-65 25L-20-35L0 25H-65M-20-35H56L0 25M75 25L45-72H68" fill="none" stroke="#b77662" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
 <path d="M-35-40H-6M61-72H78" stroke="#6d7468" stroke-width="7" stroke-linecap="round"/><circle cy="25" r="8" fill="#8d8c77"/><path d="M-9 25H12" stroke="#6d7468" stroke-width="3"/>
 </g>
 ${person(!swapped,'seated',214,swapped?246:224,swapped?.83:1)}
 ${id==='missing'?'':person(swapped,'riding',swapped?463:476,swapped?214:239,swapped?1:.83)}
 ${occluded?'<g><path d="M393 364Q390 312 429 307Q434 263 478 281Q506 250 539 289Q588 274 607 321Q642 327 623 375Z" fill="#8fa77e"/><circle cx="444" cy="327" r="28" fill="#a7bc91"/><circle cx="503" cy="307" r="35" fill="#a0b88c"/><circle cx="559" cy="330" r="30" fill="#9cb387"/></g>':''}
 <g stroke="#8da176" stroke-width="3" stroke-linecap="round"><path d="M56 401V383M71 409V392M646 404V379M663 398V385"/></g><g fill="#cf9b89"><circle cx="56" cy="382" r="5"/><circle cx="71" cy="391" r="4"/><circle cx="646" cy="378" r="6"/><circle cx="663" cy="384" r="4"/></g>
 <rect width="720" height="480" filter="url(#paper)" opacity=".055"/>
 </svg>`;
}
