import {d7aBuiltPreview} from './helpers/d7a-built-preview.ts';
import {migrateIsolatedD1} from './helpers/notbgg-local-d1.ts';
import {NotBggRepository} from '../src/lib/notbgg-repository.ts';
import {NotBggLinkRepository} from '../src/lib/notbgg-link-repository.ts';
import {readFile,writeFile} from 'node:fs/promises';
const results:any=[];
for(const setting of [undefined,false]){
 const local=await d7aBuiltPreview(setting);try{
  await migrateIsolatedD1(local.db);const repo=new NotBggRepository(local.db),links=new NotBggLinkRepository(local.db),game=(await repo.create({name:'D7A route identity',type:'boardgame'},{actor:'synthetic',idempotencyKey:'matrix-source'})).game;
  await links.execute(game.notBggId,{action:'propose',bggId:194655,expectedProfileRevision:1,expectedEventId:0,reason:'synthetic'},'synthetic');const s=await links.state(game.notBggId);await links.execute(game.notBggId,{action:'confirm',linkId:s.link!.id,expectedProfileRevision:1,expectedEventId:s.expectedEventId,reason:'synthetic'},'synthetic');
  for(const path of ['/games/santorini','/games/santorini/','/games/santorini/index.html','/games/santorini.html','/en/games/santorini']){
   let url='https://d7a.invalid'+path;const chain=[];for(let i=0;i<6;i++){const response=await local.fetch(url),body=await response.text();chain.push({url,status:response.status,location:response.headers.get('Location'),workerRan:response.headers.has('x-d7a-queries'),primaryContent:body.includes('D7A route identity'),staticBggContent:body.includes('Santorini'),canonical:body.match(/<link[^>]+rel="canonical"[^>]+>/)?.[0]});if(![301,302,303,307,308].includes(response.status)||!response.headers.get('Location'))break;url=new URL(response.headers.get('Location')!,url).href;}
   results.push({workerFirst:setting===false?'disabled negative control':'configured',path,chain});
  }
  if(setting===undefined){const response=await local.fetch('https://d7a.invalid/games'),html=await response.text();results.push({styleAudit:{headEnd:html.indexOf('</head>'),bodyStart:html.indexOf('<body'),firstStylesheet:html.search(/<link[^>]+rel="stylesheet"/),stylesheetTags:html.match(/<link[^>]+rel="stylesheet"[^>]*>/g),linkHeader:response.headers.get('Link')}});}
 }finally{await local.dispose();}
}
const evidence=JSON.parse(await readFile('docs/d7a-local-evidence.json','utf8'));evidence.routeMatrix=results;await writeFile('docs/d7a-local-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(results,null,2));
