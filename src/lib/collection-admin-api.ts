import { authorizeAdminRequest } from './auth/admin-request';
import { readJson,HttpError,response,requireAdminWriteLimit,type NotBggAdminBindings } from './notbgg-admin-api';
import { CollectionV2Repository } from './collection-v2-repository';
import { CollectionWriteError,type CollectionScope } from './collection-v2-management';
import { SiteGameRelations } from './site-game-relations';
import { isNotBggId,parseGameRef } from './game-identity';
const keys=(body:Record<string,unknown>,allowed:string[])=>{if(Object.keys(body).some(k=>!allowed.includes(k)))throw new HttpError(400,'UNKNOWN_FIELD');};
/** Independent Access verification on every API invocation, using D3's bounded JSON reader and CSRF convention. */
export async function handleCollectionAdminRequest(request:Request,bindings:NotBggAdminBindings):Promise<Response>{
 try{
  const auth=await authorizeAdminRequest(request,bindings);if(!('admin'in auth))throw new HttpError(auth.status,auth.status===401?'UNAUTHENTICATED':'FORBIDDEN');
  const url=new URL(request.url),write=request.method!=='GET',actor=auth.admin.subject;
  if(!['GET','POST','PATCH'].includes(request.method))return response(405,{error:{code:'METHOD_NOT_ALLOWED'}});
  if(write&&(request.headers.get('Origin')!==url.origin||request.headers.get('X-NotBGG-Request')!=='1'||!['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site'))))throw new HttpError(403,'ORIGIN_REJECTED');
  if(!bindings.DB)throw new HttpError(503,'DATABASE_UNAVAILABLE');
  if(write)await requireAdminWriteLimit(bindings,actor);
  const repo=new CollectionV2Repository(bindings.DB).management,ok=(data:unknown,status=200)=>response(status,{success:true,visibility:'admin',data});
  const rel=url.pathname.match(/^\/api\/admin\/notbgg\/([^/]+)\/relations(?:\/(\d+))?\/?$/);
  if(rel){const id=decodeURIComponent(rel[1]);if(!isNotBggId(id))throw new HttpError(400,'INVALID_ID');const relations=new SiteGameRelations(bindings.DB);
   if(request.method==='GET'&&!rel[2])return ok(await relations.list(id));
   const body=await readJson(request);
   if(request.method==='POST'&&!rel[2]){keys(body,['target','relationType','notes']);return ok({relationId:await relations.add(id,parseGameRef(body.target),body.relationType,body.notes??null,actor)},201);}
   if(request.method==='POST'&&rel[2]){keys(body,[]);await relations.archive(id,Number(rel[2]),actor);return ok({archived:true});}throw new HttpError(405,'METHOD_NOT_ALLOWED');
  }
  const match=url.pathname.match(/^\/api\/admin\/collection(?:\/(search|\d+)(?:\/(archive))?)?\/?$/);if(!match)throw new HttpError(404,'NOT_FOUND');
  const scope=url.searchParams.get('scope')??'production';if(!['production','test'].includes(scope))throw new HttpError(400,'INVALID_SCOPE');const s=scope as CollectionScope;
  const id=match[1]&&match[1]!=='search'?Number(match[1]):null;
  if(request.method==='GET'){
   if(match[1]==='search')return ok(await repo.search(url.searchParams.get('q')??''));
   if(id){const d=await repo.detail(id,s);if(!d)throw new HttpError(404,'NOT_FOUND');return ok(d);}
   const after=Number(url.searchParams.get('after')??0),limit=Number(url.searchParams.get('limit')??20);
   const view=url.searchParams.get('view');
   if(url.searchParams.has('page'))return ok(await repo.listNumbered(s,{
    view:view??'records',limit,query:url.searchParams.get('q')??'',source:url.searchParams.get('source'),
    status:url.searchParams.get('status'),archive:url.searchParams.get('archive'),wishlist:url.searchParams.get('wishlist'),
    page:Number(url.searchParams.get('page')),sort:url.searchParams.get('sort')??'updated',
    tab:url.searchParams.get('tab')??'all',
    players:url.searchParams.has('players')?Number(url.searchParams.get('players')):null,
   }));
   if(view!==null)return ok(await repo.listPage(s,{
    view,after,limit,query:url.searchParams.get('q')??'',source:url.searchParams.get('source'),
    status:url.searchParams.get('status'),archive:url.searchParams.get('archive'),
    wishlist:url.searchParams.get('wishlist'),
   }));
   return ok(await repo.list(s,after,limit));
  }
  const body=await readJson(request);
  if(!match[1]&&request.method==='POST'){
   keys(body,['ref','data','createCopy']);const key=request.headers.get('Idempotency-Key');if(!key||!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new HttpError(400,'INVALID_IDEMPOTENCY_KEY');
   const result=await repo.create(parseGameRef(body.ref),body.data,{actor,idempotencyKey:key,scope:s,createCopy:body.createCopy as boolean});return ok(result,result.replayed?200:201);
  }
  if(id&&!match[2]&&request.method==='PATCH'&&(Object.hasOwn(body,'revision')||Object.hasOwn(body,'changes'))){
   keys(body,['revision','changes']);
   return ok(await repo.patchFields(id,body.changes,{actor,scope:s,revision:body.revision}));
  }
  if(id&&((match[2]==='archive'&&request.method==='POST')||(!match[2]&&request.method==='PATCH'))){keys(body,match[2]?['expectedRevision']:['expectedRevision','data','createCopy']);
   return ok(await repo.update(id,body.data,{actor,scope:s,expectedRevision:body.expectedRevision as number,createCopy:body.createCopy as boolean|undefined},!!match[2]));}
  throw new HttpError(405,'METHOD_NOT_ALLOWED');
 }catch(error){if(error instanceof HttpError)return response(error.status,{success:false,error:{code:error.code}});
  if(error instanceof CollectionWriteError){const status=error.code==='NOT_FOUND'?404:['CONFLICT','ARCHIVED','IDEMPOTENCY_CONFLICT','DUPLICATE_RELATION'].includes(error.code)?409:error.code==='STORAGE'?500:400;return response(status,{success:false,error:{code:error.code==='STORAGE'?'SERVICE_UNAVAILABLE':error.code}});}
  // Identity/JSON validation failures get a controlled 400; SQL/internal exceptions stay generic.
  if(error instanceof Error&&/Invalid (?:game reference|NotBGG|serialized)/.test(error.message))return response(400,{success:false,error:{code:'INVALID_REFERENCE'}});
  return response(500,{success:false,error:{code:'SERVICE_UNAVAILABLE'}});
 }
}
