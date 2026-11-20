import {readFile, writeFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
let html=await read('public/verification-lab.html');
const css=await read('public/verification-lab.css');
const files=['public/verification-core.js','public/verification-samples.js','public/diary-record.js','public/generation-plan.js','public/lab-samples.js','public/verification-lab.js'];
const scripts=[];
for(const file of files){
 let source=await read(file);
 source=source.replace(/^import[^\n]*\n/gm,'').replace(/\bexport\s+(?=(?:const|function|class)\b)/g,'')
  .replace("const labStandalone=location.protocol==='file:';",'const labStandalone=true;');
 scripts.push(source);
}
html=html.replace('<link rel="stylesheet" href="/verification-lab.css">',()=>`<style>${css}</style>`)
 .replace('<script type="module" src="/verification-lab.js"></script>',()=>`<script type="module">${scripts.join('\n').replace(/<\/script/gi,'<\\/script')}</script>`);
await writeFile(new URL('verification-demo.html',root),html);
console.log('Built verification-demo.html (offline examples; real VLM requires the server).');
