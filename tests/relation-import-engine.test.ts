import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createGameRequester, executeRelationImport, commitCache, validateGameXml, ImportFailure } from '../scripts/lib/relation-import-engine.ts';
import { parseRelationImportArgs } from '../scripts/bgg-relations-import.ts';
import { planRelationImport } from '../src/lib/relation-import-plan.ts';
const source = new URL('../src/data/bgg-cache.json', import.meta.url);
const sourceHashAtStart = createHash('sha256').update(await fs.readFile(source)).digest('hex');
const actual = JSON.parse(await fs.readFile(source, 'utf8'));
const game = (id: number, expansions: {id:number;name:string}[] = []) => ({...actual['205637'], bggId:id, name:`Game ${id}`, expansions, implementations:[], compilations:[]});
const xml = (id=2, extra='') => `<items><item type="boardgameexpansion" id="${id}"><name type="primary" value="Game ${id}"/><description>Fixture</description><yearpublished value="2020"/><minplayers value="1"/><maxplayers value="4"/><minplaytime value="30"/><maxplaytime value="60"/>${extra}</item></items>`;
const response = (status=200, body=xml(), headers={}) => new Response(body,{status,headers});
const error = (code: string) => (e: unknown) => e instanceof ImportFailure && e.code === code;
const mock = (fn: (...args:any[])=>any) => fn as typeof fetch;
const options = (fetcher: typeof fetch) => ({token:'SYNTHETIC-ONLY', intervalMs:0, fetch:fetcher, sleep:async()=>{}});
async function fixture(run: (file:string, original:string)=>Promise<void>) {
    const dir=await fs.mkdtemp(join(process.cwd(),'.bgg-b2-test-'));
    const file=join(dir,'cache.json'); const original=JSON.stringify({'1':game(1,[{id:2,name:'Two'},{id:3,name:'Three'}])});
    await fs.writeFile(file,original);
    try {await run(file,original);} finally {await fs.rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
test('B2 execute explicitly required; conflicting modes rejected',()=>{
    assert.throws(()=>parseRelationImportArgs(['--root','1']));
    assert.throws(()=>parseRelationImportArgs(['--root','1','--execute','--dry-run']));
    const args=parseRelationImportArgs(['--root','1','--execute','--limit','5']); assert.equal(args.help,false);
    if(!args.help){ assert.equal(args.execute,true); assert.equal(args.dryRun,false); }
});
test('B2 dry plan never calls HTTP or changes input',()=>{
    const cache={'1':game(1)};const before=JSON.stringify(cache);planRelationImport(cache,1);assert.equal(JSON.stringify(cache),before);
});
for(const status of [202,429,500,503]) test(`B2 ${status} retries bounded and respects Retry-After`,async()=>{
    let calls=0;const waits:number[]=[];
    const get=createGameRequester({...options(mock(async()=>++calls===1?response(status,'',{ 'Retry-After':'180' }):response())),intervalMs:2000,sleep:async ms=>{waits.push(ms);}});
    assert.equal((await get(2)).bggId,2);assert.equal(calls,2);assert.deepEqual(waits,[180000,2000]);
});
test('B2 Retry-After HTTP date and exhausted retry budget',async()=>{
    let calls=0;const waits:number[]=[];
    const get=createGameRequester({...options(mock(async()=>{calls++;return response(429,'',{'Retry-After':new Date(Date.now()+30000).toUTCString()});})),maxAttempts:2,sleep:async ms=>{waits.push(ms);}});
    await assert.rejects(get(2),error('RETRY_EXHAUSTED'));assert.equal(calls,2);assert.ok(waits[0]>28000);
});
test('B2 real abort timeout is retried without real HTTP',async()=>{
    let calls=0;
    const get=createGameRequester({...options(mock(async(_url,init)=>{
        calls++;if(calls>1)return response();
        return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('synthetic')),{once:true}));
    })),timeoutMs:10});
    const keepAlive=setTimeout(()=>{},1000);
    try{assert.equal((await get(2)).bggId,2);assert.equal(calls,2);}finally{clearTimeout(keepAlive);}
});
test('B2 404 permanent; no retries',async()=>{
    let calls=0;await assert.rejects(createGameRequester(options(mock(async()=>{calls++;return response(404);} )))(2),error('HTTP_404'));assert.equal(calls,1);
});
for(const [name,body,code] of [['invalid XML','<items>','XML_INVALID'],['wrong ID',xml(3),'ID_MISMATCH'],['empty','<items/>','XML_ITEM_INVALID'],['unknown type',xml().replace('boardgameexpansion','unknown'),'GAME_TYPE_INVALID']]) test(`B2 rejects ${name} without retry`,async()=>{
    let calls=0;await assert.rejects(createGameRequester(options(mock(async()=>{calls++;return response(200,body);} )))(2),error(code));assert.equal(calls,1);
});
test('B2 parser preserves true false and absent directions',()=>{
    const data=validateGameXml(xml(2,'<link type="boardgameexpansion" id="8" value="Eight" inbound="true"/><link type="boardgameexpansion" id="9" value="Nine" inbound="false"/><link type="boardgameexpansion" id="10" value="Ten"/>'),2);
    assert.deepEqual(data.expansions.map(x=>x.inbound),[true,false,undefined]);
});
test('B2 isolated full flow, backup, limit, depth one and idempotency',async()=>fixture(async(file,original)=>{
    const called:number[]=[];const request=options(mock(async(url)=>{const id=Number(new URL(url).searchParams.get('id'));called.push(id);return response(200,xml(id,'<link type="boardgameexpansion" id="99" value="Not queued"/>'));}));
    const first=await executeRelationImport(file,1,1,request);assert.deepEqual(first.results,[{id:2,status:'IMPORTED'}]);assert.deepEqual(first.remainingIds,[3]);
    const files=await fs.readdir(join(file,'..'));const backups=files.filter(x=>x.endsWith('.bak'));assert.equal(backups.length,1);assert.equal(await fs.readFile(join(file,'..',backups[0]),'utf8'),original);
    await executeRelationImport(file,1,undefined,request);await executeRelationImport(file,1,undefined,request);
    assert.deepEqual(called,[2,3]);assert.equal(JSON.parse(await fs.readFile(file,'utf8'))['99'],undefined);
    assert.equal(files.some(x=>x.endsWith('.tmp')),false);
}));
test('B2 complete existing data is not downloaded or overwritten',async()=>fixture(async(file)=>{
    const cache=JSON.parse(await fs.readFile(file,'utf8'));cache['2']=game(2);await fs.writeFile(file,JSON.stringify(cache));
    const get=options(mock(async(url)=>{assert.equal(Number(new URL(url).searchParams.get('id')),3);return response(200,xml(3));}));
    await executeRelationImport(file,1,undefined,get);assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8'))['2'],cache['2']);
}));
test('B2 malformed temporary JSON preserves original',async()=>fixture(async(file,original)=>{
    await assert.rejects(commitCache(file,original,{'2':game(2)},{beforeValidate:async temp=>{await fs.writeFile(temp,'broken');}}));
    assert.equal(await fs.readFile(file,'utf8'),original);
}));
test('B2 Windows replacement refusal preserves original and backup; no unlink fallback',async()=>fixture(async(file,original)=>{
    await assert.rejects(commitCache(file,original,{'2':game(2)},{replace:async()=>{throw Object.assign(new Error(),{code:'EPERM'});}}),error('CACHE_REPLACE_EPERM'));
    assert.equal(await fs.readFile(file,'utf8'),original);
    assert.equal((await fs.readdir(join(file,'..'))).filter(x=>x.endsWith('.bak')).length,1);
}));
test('B2 failed item continues, rerun retries only failures',async()=>fixture(async(file)=>{
    const first=await executeRelationImport(file,1,undefined,options(mock(async url=>Number(new URL(url).searchParams.get('id'))===2?response(404):response(200,xml(3)))));
    assert.equal(first.results[0].status,'FAILED');assert.equal(first.results[1].status,'IMPORTED');
    const next=await executeRelationImport(file,1,undefined,options(mock(async()=>response())));assert.deepEqual(next.plannedIds,[2]);
}));
test('B2 cancellation keeps committed success and resumes remaining item',async()=>fixture(async(file)=>{
    const controller=new AbortController();
    const first=await executeRelationImport(file,1,undefined,{...options(mock(async url=>{
        const id=Number(new URL(url).searchParams.get('id'));if(id===3)controller.abort();return response(200,xml(id));
    })),signal:controller.signal});
    assert.equal(first.interrupted,true);assert.deepEqual(first.remainingIds,[3]);
    const next=await executeRelationImport(file,1,undefined,options(mock(async()=>response(200,xml(3)))));assert.deepEqual(next.plannedIds,[3]);
}));
test('B2 concurrent writers rejected before HTTP; lock released after commit failure',async()=>fixture(async(file)=>{
    let release!:()=>void;let entered!:()=>void;
    const ready=new Promise<void>(r=>entered=r);const gate=new Promise<void>(r=>release=r);
    const running=executeRelationImport(file,1,1,options(mock(async()=>{entered();await gate;return response();})));
    await ready;
    await assert.rejects(executeRelationImport(file,1,1,options(mock(()=>{throw new Error('must not call');}))),error('CACHE_LOCKED'));
    release();await running;
    const failed=await executeRelationImport(file,1,1,options(mock(async()=>response(200,xml(3)))),{replace:async()=>{throw new Error();}});
    assert.equal(failed.fatalErrorCode,'CACHE_REPLACE_IO_FAILED');assert.deepEqual(failed.remainingIds,[3]);
    assert.equal((await fs.readdir(join(file,'..'))).some(x=>x.endsWith('.lock')),false);
}));
test('B2 external cache edit blocks commit without overwrite',async()=>fixture(async(file,original)=>{
    await fs.writeFile(file,'{}');await assert.rejects(commitCache(file,original,{'2':game(2)}),error('CACHE_CHANGED'));assert.equal(await fs.readFile(file,'utf8'),'{}');
}));
test('B2 official cache hash remains unchanged',async()=>{
    assert.equal(createHash('sha256').update(await fs.readFile(source)).digest('hex'),sourceHashAtStart);
});
test('B2 parseable but altered temporary JSON is rejected',async()=>fixture(async(file,original)=>{
    await assert.rejects(commitCache(file,original,{'2':game(2)},{beforeValidate:async temp=>{await fs.writeFile(temp,'{}');}}),error('TEMP_VERIFY_FAILED'));
    assert.equal(await fs.readFile(file,'utf8'),original);
}));
test('B2 storage failure stops subsequent downloads, preserving partial report',async()=>fixture(async(file,original)=>{
    let calls=0;const result=await executeRelationImport(file,1,undefined,options(mock(async()=>{calls++;return response();})),{replace:async()=>{throw Object.assign(new Error(),{code:'EIO'});}});
    assert.equal(calls,1);assert.equal(result.fatalErrorCode,'CACHE_REPLACE_EIO');assert.deepEqual(result.remainingIds,[2,3]);
    assert.equal(await fs.readFile(file,'utf8'),original);
}));
test('B2 backup open failure leaves original intact',async()=>fixture(async(file,original)=>{
    const outside=join(file,'..');
    await assert.rejects(commitCache(file,original,{'2':game(2)},{beforeValidate:async temp=>{
        await fs.mkdir(temp.replace(/\.tmp$/,'.bak'));
    }}));assert.equal(await fs.readFile(file,'utf8'),original);
    assert.ok((await fs.readdir(outside)).some(x=>x.endsWith('.bak')));
}));
test('B2 abort during backoff prevents all further requests',async()=>{
    const controller=new AbortController();let calls=0;
    const get=createGameRequester({...options(mock(async()=>{calls++;return response(202);})),signal:controller.signal,sleep:async()=>{controller.abort();}});
    await assert.rejects(get(2));assert.equal(calls,1);
});
test('B2 sequential requests include inter-game minimum delay',async()=>{
    const waits:number[]=[];const get=createGameRequester({...options(mock(async url=>response(200,xml(Number(new URL(url).searchParams.get('id')))))),intervalMs:3210,sleep:async ms=>{waits.push(ms);}});
    await get(2);await get(3);assert.deepEqual(waits,[3210]);
});
test('B3A fixed ID scope reruns skip success without downloading the next target',async()=>fixture(async(file)=>{
    let calls=0;const request={...options(mock(async()=>{calls++;return response();})),targetIds:[2]};
    const first=await executeRelationImport(file,1,1,request);assert.deepEqual(first.plannedIds,[2]);
    const second=await executeRelationImport(file,1,1,request);assert.deepEqual(second.plannedIds,[]);assert.deepEqual(second.skippedIds,[2]);assert.equal(calls,1);assert.deepEqual(second.remainingIds,[3]);
}));
test('B3A unknown scoped ID stops before HTTP',async()=>fixture(async(file)=>{
    await assert.rejects(executeRelationImport(file,1,1,{...options(mock(()=>{throw new Error();})),targetIds:[99]}),error('TARGET_SCOPE_INVALID'));
}));
test('B3A authentication error stops remaining targets',async()=>fixture(async(file,original)=>{
    let calls=0;const result=await executeRelationImport(file,1,undefined,options(mock(async()=>{calls++;return response(401);} )));
    assert.equal(calls,1);assert.equal(result.fatalErrorCode,'HTTP_401');assert.equal(await fs.readFile(file,'utf8'),original);
}));
test('B3A CLI accepts cache path and fixed IDs without changing default argument shape',()=>{
    const args=parseRelationImportArgs(['--root','1','--execute','--cache-path','isolated/cache.json','--ids','2,3']);
    if(args.help)throw new Error();assert.equal(args.cachePath,'isolated/cache.json');assert.deepEqual(args.targetIds,[2,3]);
    assert.throws(()=>parseRelationImportArgs(['--root','1','--dry-run','--ids','2,2']));
});
test('B3C stop-on-error prevents later downloads after a permanent item failure',async()=>fixture(async(file,original)=>{
    let calls=0;const result=await executeRelationImport(file,1,undefined,{...options(mock(async()=>{calls++;return response(404);})),stopOnFailure:true});
    assert.equal(calls,1);assert.equal(result.fatalErrorCode,'HTTP_404');assert.equal(await fs.readFile(file,'utf8'),original);
    const args=parseRelationImportArgs(['--root','1','--execute','--stop-on-error']);if(args.help)throw new Error();assert.equal(args.stopOnFailure,true);
}));

for (const primary of ['HTTP_404','CACHE_REPLACE_EIO']) test(`B43F lock cleanup cannot replace ${primary}`,async()=>fixture(async(file,original)=>{
    const result=await executeRelationImport(file,1,1,{...options(mock(async()=>primary==='HTTP_404'?response(404):response())),stopOnFailure:true},{
        ...(primary==='CACHE_REPLACE_EIO'?{replace:async()=>{throw Object.assign(new Error(),{code:'EIO'});}}:{}),
        unlink:async path=>{if(String(path).endsWith('.import.lock'))throw Object.assign(new Error(),{code:'EACCES'});await fs.unlink(path);}
    });
    assert.equal(result.fatalErrorCode,primary);assert.equal(result.results[0].errorCode,primary);
    assert.ok(result.storageDiagnostics.some(d=>d.stage==='CLEANUP'&&d.code==='EACCES'));
    assert.equal(await fs.readFile(file,'utf8'),original);
    assert.ok((await fs.readdir(join(file,'..'))).some(x=>x.endsWith('.import.lock'))); // Expected injected residue, removed by fixture teardown only.
}));
