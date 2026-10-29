import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const sources=['public/index.html','public/style.css','public/conversation.js','public/storage.js','public/state.js','public/app.js'];
const [html,css,...scripts]=await Promise.all(sources.map(path=>readFile(new URL(path,root),'utf8')));
const script=scripts.join('\n').replace(/^import .+;\n/gm,'').replace(/^export /gm,'').replace('const STANDALONE=false;','const STANDALONE=true;');
await writeFile(new URL('demo.html',root),html.replace('<link rel="stylesheet" href="/style.css">',()=>`<style>${css}</style>`).replace('<script type="module" src="/app.js"></script>',()=>`<script>${script}</script>`));
console.log('demo.html created');
