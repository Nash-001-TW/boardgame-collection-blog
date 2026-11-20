import {authorizeAdminRequest} from './auth/admin-request';
import {HttpError,response,readJson,requireAdminWriteLimit,type NotBggAdminBindings} from './notbgg-admin-api';
import {readBggSync,syncBggBatch,type SyncDependencies} from './bgg-sync-admin';
import {readRelationAdmin,writeRelation} from './relation-admin';
export async function handleBggAdminRequest(request:Request,bindings:NotBggAdminBindings,deps:SyncDependencies={}){
 try{
  const auth=await authorizeAdminRequest(request,bindings);if(!('admin'in auth))throw new HttpError(auth.status,auth.status===401?'UNAUTHENTICATED':'FORBIDDEN');if(!bindings.DB)throw new HttpError(503,'DATABASE_UNAVAILABLE');
  const params=new URL(request.url).searchParams;
  if(request.method==='GET')return response(200,{success:true,data:params.get('view')==='relations'?await readRelationAdmin(bindings.DB,params):await readBggSync(bindings.DB,params)});
  if(request.method!=='POST')throw new HttpError(405,'METHOD_NOT_ALLOWED');
  if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-NotBGG-Request')!=='1'||!['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site')))throw new HttpError(403,'ORIGIN_REJECTED');
  await requireAdminWriteLimit(bindings,auth.admin.subject);const body=await readJson(request);
  if(body.action==='sync'&&Object.keys(body).some(k=>!['action','ids'].includes(k)))throw new HttpError(400,'INVALID_BGG_QUERY');
  const result=body.action==='sync'?await syncBggBatch(bindings.DB,bindings.BGG_API_TOKEN,auth.admin.subject,request.headers.get('Idempotency-Key'),body.ids,deps):await writeRelation(bindings.DB,auth.admin.subject,request.headers.get('Idempotency-Key'),body);
  return response(result.replayed?200:201,{success:true,data:result});
 }catch(error){if(error instanceof HttpError)return response(error.status,{success:false,error:{code:error.code}});return response(503,{success:false,error:{code:'BGG_SERVICE_UNAVAILABLE'}});}
}
