/** B-4.3: explicitly authorized fixed ten-ID production-local-cache import; no cloud database access. */
import * as fs from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { parse as parseEnv } from 'dotenv';
import { XMLParser } from 'fast-xml-parser';
import { main } from './bgg-relations-import.ts';
import { ImportFailure } from './lib/relation-import-engine.ts';
import { planRelationImport, cachedGameIssues } from '../src/lib/relation-import-plan.ts';
import { parseBggGameXml } from '../src/lib/bgg-parser.ts';
import { buildGameCatalog } from '../src/lib/game-catalog.ts';
import { detailRelations } from '../src/lib/detail-relations.ts';
import { relationDisplayItems } from '../src/lib/relation-display.ts';
import type { BggGameData } from '../src/lib/bgg-types.ts';

const expected='91e9bcb17d0047832d0d76cf33e5676f3ba54b4cd4e1918e2356819de0a176ad';
const ids=[340953,347147,347148,347149,348234,354504,358212,358213,359609,369493];
const source=fileURLToPath(new URL('../src/data/bgg-cache.json',import.meta.url));
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const artifactRoot='D:/CodexHome/visualizations/2026/10/28/01a18008-ff9e-7d40-b6b4-58c1c3393419';
const folder=join(artifactRoot,`bgg-b43-${new Date().toISOString().slice(0,10)}-${randomUUID()}`);
const file=source;
const backup=join(folder,`bgg-cache.pre-b43-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
const priorBackups=new Set(await fs.readdir(dirname(file))); 
const report:Record<string,any>={status:'PENDING',ids,folder,commands:[],http:[],rawValidation:[]};
const originalFetch=globalThis.fetch, originalLog=console.log;
const safeFail=(code:string):never=>{throw {safeCode:code};};
const model=(cache:Record<string,BggGameData>)=>{
    const catalog=buildGameCatalog(cache,[]), root=catalog.find(g=>g.bggId===205637)!;
    const rows=detailRelations(root,catalog,'zh-TW');
    const ui=relationDisplayItems(rows,'zh-TW');
    return {total:rows.length,countsByType:Object.fromEntries((['expansions','implementations','compilations'] as const).map(kind=>[kind,Object.fromEntries(['explicit','derived','unknown','conflict'].map(status=>[status,rows.filter(r=>r.directions[kind]?.directionStatus===status).length]))])),counts:Object.fromEntries(['explicit','derived','unknown','conflict'].map(s=>[s,rows.filter(r=>r.directions.expansions?.directionStatus===s).length])),
        targets:ids.map(id=>({id,direction:rows.find(r=>r.id===id)?.directions.expansions,directions:rows.find(r=>r.id===id)?.directions,ui:ui.find(r=>r.id===id)}))};
};
try {
    const before=await fs.readFile(source);
    if(sha(before)!==expected)safeFail('OFFICIAL_HASH_MISMATCH');
    const initial=JSON.parse(before.toString()) as Record<string,BggGameData>;
    const plan=planRelationImport(initial,205637,10);
    if(Object.keys(initial).length!==785)safeFail('COUNT_MISMATCH');
    if(plan.stats.uniqueTargets!==117||plan.stats.pendingImport!==30||plan.stats.alreadyCached!==87)safeFail('ROOT_PLAN_COUNTS_MISMATCH');
    try { await fs.access(source+'.import.lock'); safeFail('LOCK_PRESENT'); } catch(e) { if(!e||typeof e!=='object'||!('code' in e)||e.code!=='ENOENT')throw e; }
    if(JSON.stringify(plan.plannedIds)!==JSON.stringify(ids) || ids.some(id=>!plan.pendingIds.includes(id)))safeFail('PLAN_MISMATCH');
    const protectedBaseline=JSON.parse(await fs.readFile(join(artifactRoot,'bgg-b41-2026-11-03-d791ab72-e305-439c-bf13-4c7c7455a47a','integrity-and-tests-verified.json'),'utf8'));
    const protectedIntegrity=[];
    for(const entry of protectedBaseline.protectedFiles){
        const hash=sha(await fs.readFile(new URL('../'+entry.path,import.meta.url)));
        protectedIntegrity.push({path:entry.path,before:hash,expected:entry.after});
        if(hash!==entry.after)safeFail('PROTECTED_FILE_MISMATCH');
    }
    report.protectedIntegrity=protectedIntegrity;
    const beforeModel=model(initial);
    const beforeByType=Object.values(beforeModel.countsByType) as Record<string,number>[];
    if(beforeByType.reduce((n,c)=>n+c.derived,0)!==87||beforeByType.reduce((n,c)=>n+c.unknown,0)!==30)safeFail('A2_BASELINE_MISMATCH');
    await fs.mkdir(folder); // New directory only; never reuse a prior run.
    await fs.copyFile(source,backup,1);
    const backupBytes=await fs.readFile(backup);JSON.parse(backupBytes.toString());
    if(sha(backupBytes)!==expected)safeFail('BACKUP_HASH_MISMATCH');
    if(await fs.realpath(file)!==await fs.realpath(source))safeFail('TARGET_PATH_MISMATCH');
    report.preflight={officialSha256:expected,cacheSha256:sha(await fs.readFile(file)),plannedIds:plan.plannedIds,newDirectory:true,backupPath:backup,backupSha256:sha(backupBytes),cacheCount:Object.keys(initial).length};
    report.beforeModel=beforeModel;
    await fs.writeFile(join(folder,'preflight.json'),JSON.stringify(report,null,2),'utf8');
    // Read only the existing BGG credential into the execution environment, never log it.
    const priorToken=process.env.BGG_API_TOKEN;
    const priorInterval=process.env.BGG_IMPORT_INTERVAL_MS;
    process.env.BGG_IMPORT_INTERVAL_MS='2000';
    if(!priorToken){
        const env=parseEnv(await fs.readFile(new URL('../.env',import.meta.url),'utf8'));
        if(!env.BGG_API_TOKEN)safeFail('BGG_TOKEN_REQUIRED');
        process.env.BGG_API_TOKEN=env.BGG_API_TOKEN;
    }
    globalThis.fetch=async(input,init)=>{
        const url=new URL(String(input));const id=Number(url.searchParams.get('id'));
        if(url.origin!=='https://boardgamegeek.com'||url.pathname!=='/xmlapi2/thing'||!ids.includes(id)||url.searchParams.get('stats')!=='1')safeFail('REQUEST_SCOPE_VIOLATION');
        const event:any={id,sequence:report.http.length+1};report.http.push(event);
        let response:Response;
        try{response=await originalFetch(input,init);}catch{event.errorCode='TRANSPORT_FAILED';throw new Error('TRANSPORT_FAILED');}
        event.status=response.status;
        if(response.status===200){
            try {
            const xml=await response.clone().text();
            const item=new XMLParser({ignoreAttributes:false,attributeNamePrefix:''}).parse(xml)?.items?.item;
            const parsed=parseBggGameXml(xml);
            const links=item?.link===undefined?[]:Array.isArray(item.link)?item.link:[item.link];
            const types={expansions:'boardgameexpansion',implementations:'boardgameimplementation',compilations:'boardgamecompilation'} as const;
            const relationCounts:Record<string,number>={};let inboundPreserved=true;
            const inbound={true:0,false:0,missing:0,other:0};
            for(const [kind,type] of Object.entries(types)){
                const raw=links.filter((l:any)=>l.type===type);relationCounts[kind]=raw.length;
                const normalized=raw.map((l:any)=>{
                    const value=l.inbound===undefined?undefined:l.inbound==='true'||l.inbound===true?true:l.inbound==='false'||l.inbound===false?false:'UNRECOGNIZED';
                    inbound[value===true?'true':value===false?'false':value===undefined?'missing':'other']++;
                    return {id:Number(l.id),inbound:value};
                });
                if(JSON.stringify(normalized)!==JSON.stringify(parsed[kind as keyof typeof types].map(l=>({id:l.id,inbound:l.inbound}))))inboundPreserved=false;
            }
            report.rawValidation.push({id,rawId:Number(item?.id),rawType:item?.type,relationCounts,inbound,inboundPreserved,
                rawRelations:links.filter((l:any)=>Object.values(types).includes(l.type)).map((l:any)=>({type:l.type,id:Number(l.id),name:String(l.value??''),rawInboundAttribute:l.inbound===undefined?null:l.inbound===true||l.inbound==='true'?'true':l.inbound===false||l.inbound==='false'?'false':'UNRECOGNIZED',inboundPresence:l.inbound===undefined?'missing':'present'})),
                optionalRawPresence:{year:!!item?.yearpublished,image:!!item?.image,thumbnail:!!item?.thumbnail,minPlayers:!!item?.minplayers,maxPlayers:!!item?.maxplayers,minPlayTime:!!item?.minplaytime,maxPlayTime:!!item?.maxplaytime,averageRating:!!item?.statistics?.ratings?.average,averageWeight:!!item?.statistics?.ratings?.averageweight},
                parsed:{id:parsed.bggId,name:parsed.name,type:parsed.gameType,year:parsed.year,image:parsed.image??null,thumbnail:parsed.thumbnail??null,minPlayers:parsed.minPlayers,maxPlayers:parsed.maxPlayers,minPlayTime:parsed.minPlayTime,maxPlayTime:parsed.maxPlayTime,averageRating:parsed.averageRating??null,averageWeight:parsed.averageWeight??null,complexity:parsed.complexity},
                parserValid:cachedGameIssues(parsed,id).length===0});
            if(!inboundPreserved)throw new ImportFailure('DIRECTION_PRESERVATION_FAILED');
            } catch(error) { throw error instanceof ImportFailure ? error : new ImportFailure('RAW_VALIDATION_FAILED'); }
        }
        return response;
    };
    const args=['--root','205637','--execute','--limit','10','--ids',ids.join(','),'--stop-on-error'];
    const run=async(label:string)=>{
        const output:any[]=[];console.log=(value:any)=>{output.push(JSON.parse(value));};
        try{report.commands.push({label,command:`npm run bgg:relations:import -- ${args.map(a=>a.includes(' ')?JSON.stringify(a):a).join(' ')}`});await main(args);}
        finally{console.log=originalLog;}
        if(output.length!==1)safeFail('CLI_RESULT_MISSING');
        report[label]=output[0];
        await fs.writeFile(join(folder,`${label}.json`),JSON.stringify(output[0],null,2),'utf8');
        return output[0];
    };
    try{
        const first=await run('first-run');
        if(first.fatalErrorCode||first.results.length!==10||first.results.some((r:any)=>r.status!=='IMPORTED'))safeFail('IMPORT_INCOMPLETE');
        const after=await fs.readFile(file);const cache=JSON.parse(after.toString()) as Record<string,BggGameData>;
        const added=Object.keys(cache).filter(id=>!Object.hasOwn(initial,id)).map(Number);
        if(JSON.stringify(added.sort((a,b)=>a-b))!==JSON.stringify(ids)||Object.keys(initial).some(id=>JSON.stringify(initial[id])!==JSON.stringify(cache[id])))safeFail('UNEXPECTED_CACHE_CHANGE');
        const beforeRepeatHttp=report.http.length;
        const repeat=await run('second-run');
        if(report.http.length!==beforeRepeatHttp||repeat.plannedIds.length||JSON.stringify(repeat.skippedIds)!==JSON.stringify(ids)||sha(await fs.readFile(file))!==sha(after))safeFail('IDEMPOTENCY_FAILED');
        const backups=(await fs.readdir(dirname(file))).filter(name=>name.startsWith(basename(file)+'.')&&name.endsWith('.bak')&&!priorBackups.has(name));
        const backupProof=[];
        for(const name of backups){const bytes=await fs.readFile(join(dirname(file),name));const backup=JSON.parse(bytes.toString());
            backupProof.push({name,sha256:sha(bytes),count:Object.keys(backup).length,originalRecordsUnchanged:Object.keys(initial).every(id=>JSON.stringify(initial[id])===JSON.stringify(backup[id]))});}
        report.verification={addedIds:added,countBefore:Object.keys(initial).length,countAfter:Object.keys(cache).length,cacheSha256:sha(after),originalRecordsUnchanged:true,secondRunHttpRequests:0,backups:backupProof,lockAndTempsRemaining:(await fs.readdir(dirname(file))).filter(n=>n.startsWith(basename(file)+'.')&&(n.endsWith('.lock')||n.endsWith('.tmp')))};
        if(backups.length!==10||backupProof.some(b=>!b.originalRecordsUnchanged))safeFail('BACKUP_VERIFICATION_FAILED');
        report.afterModel=model(cache);
        report.implementationEvidence={rootSideSource:'unchanged-local-cache-not-new-root-XML',
            rootBefore:initial['205637'].implementations.filter(l=>l.id===359609).map(l=>({...l,inboundPresence:l.inbound===undefined?'missing':'present'})),
            rootAfter:cache['205637'].implementations.filter(l=>l.id===359609).map(l=>({...l,inboundPresence:l.inbound===undefined?'missing':'present'})),
            revisedSideSource:'new-thing-XML',revisedItemType:cache['359609'].gameType,
            revisedRawLinks:report.rawValidation.find((v:any)=>v.id===359609)?.rawRelations.filter((l:any)=>l.id===205637),
            revisedParsedLinks:cache['359609'].implementations.filter(l=>l.id===205637).map(l=>({...l,inboundPresence:l.inbound===undefined?'missing':'present'}))};
        const finalPlan=planRelationImport(cache,205637);
        report.finalPlan={stats:finalPlan.stats,pendingIds:finalPlan.pendingIds};
        if(Object.keys(cache).length!==795||finalPlan.stats.uniqueTargets!==117||finalPlan.stats.alreadyCached!==97||finalPlan.stats.pendingImport!==20)safeFail('POST_IMPORT_COUNTS_MISMATCH');
        report.status='PASS';
    }finally{if(priorToken===undefined&&!Reflect.deleteProperty(process.env,'BGG_API_TOKEN'))throw new TypeError('BGG_TOKEN_CLEANUP_FAILED');
        if(priorInterval===undefined)delete process.env.BGG_IMPORT_INTERVAL_MS;else process.env.BGG_IMPORT_INTERVAL_MS=priorInterval;}
}catch(error){report.status='FAIL';report.errorCode=error&&typeof error==='object'&&'safeCode'in error?error.safeCode:'VALIDATION_FAILED';process.exitCode=1;}
finally{
    globalThis.fetch=originalFetch;console.log=originalLog;
    report.officialSha256After=sha(await fs.readFile(source));
    report.productionCacheChanged=report.officialSha256After!==expected;
    if(report.protectedIntegrity){
        for(const entry of report.protectedIntegrity){
            entry.after=sha(await fs.readFile(new URL('../'+entry.path,import.meta.url)));
            entry.unchanged=entry.after===entry.before;
        }
        if(report.protectedIntegrity.some((entry:any)=>!entry.unchanged)){report.status='FAIL';report.errorCode='PROTECTED_FILE_CHANGED';process.exitCode=1;}
    }
    await fs.mkdir(folder,{recursive:true});
    await fs.writeFile(join(folder,'validation-report.json'),JSON.stringify(report,null,2),'utf8');
    originalLog(JSON.stringify({status:report.status,errorCode:report.errorCode,folder,officialSha256After:report.officialSha256After,backup,http:report.http,verification:report.verification},null,2));
}
