import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const [html,css,js,conversation]=await Promise.all(['public/index.html','public/style.css','public/app.js','public/conversation.js'].map(p=>readFile(new URL(p,root),'utf8')));
await writeFile(new URL('demo.html',root),html.replace('<link rel="stylesheet" href="/style.css">',()=>`<style>${css}</style>`).replace('<script type="module" src="/app.js"></script>',()=>`<script>${conversation.replaceAll('export ', '')}\n${js.replace("import {localReply} from './conversation.js';",'').replace('const STANDALONE=false;','const STANDALONE=true;')}</script>`));
console.log('demo.html created');
