import { authorizeAdminRequest } from './auth/admin-request';
import { readJson,response,HttpError,requireAdminWriteLimit,type NotBggAdminBindings } from './notbgg-admin-api';
import { NotBggLinkRepository,LinkCommandError,type LinkCommand } from './notbgg-link-repository';
import { isNotBggId } from './game-identity';
export async function handleNotBggLinkRequest(request:Request,bindings:NotBggAdminBindings):Promise<Response>{
 try{
  const auth=await authorizeAdminRequest(request,bindings);if(!('admin'in auth))throw new HttpError(auth.status,auth.status===401?'UNAUTHENTICATED':'FORBIDDEN');
  const url=new URL(request.url),match=url.pathname.match(/^\/api\/admin\/notbgg\/([^/]+)\/link(?:\/(compare|history))?\/?$/);
  if(!match)throw new HttpError(404,'NOT_FOUND');let id:string;try{id=decodeURIComponent(match[1]);}catch{throw new HttpError(400,'INVALID_ID');}if(!isNotBggId(id))throw new HttpError(400,'INVALID_ID');
  if(!['GET','POST'].includes(request.method)||match[2]&&request.method!=='GET')throw new HttpError(405,'METHOD_NOT_ALLOWED');
  if(request.method==='POST'&&(request.headers.get('Origin')!==url.origin||request.headers.get('X-NotBGG-Request')!=='1'||!['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site'))))throw new HttpError(403,'ORIGIN_REJECTED');
  if(!bindings.DB)throw new HttpError(503,'DATABASE_UNAVAILABLE');const repo=new NotBggLinkRepository(bindings.DB),ok=(data:unknown)=>response(200,{success:true,visibility:'admin',data});
  if(request.method==='GET'){
   if(match[2]==='compare')return ok(await repo.comparison(id,Number(url.searchParams.get('bggId'))));
   if(match[2]==='history')return ok(await repo.history(id,Number(url.searchParams.get('after')??0),Number(url.searchParams.get('limit')??20)));
   return ok(await repo.state(id));
  }
  await requireAdminWriteLimit(bindings,auth.admin.subject);
  const body=await readJson(request);if(Object.keys(body).some(k=>!['action','expectedEventId','expectedProfileRevision','reason','bggId','linkId','primarySource'].includes(k)))throw new HttpError(400,'UNKNOWN_FIELD');
  return ok(await repo.execute(id,body as unknown as LinkCommand,auth.admin.subject));
 }catch(error){if(error instanceof HttpError)return response(error.status,{success:false,error:{code:error.code}});
  if(error instanceof LinkCommandError){const status=error.code==='SCHEMA_NOT_READY'?503:['NOT_FOUND','TARGET_NOT_FOUND'].includes(error.code)?404:['CONFLICT','ARCHIVED','INVALID_TRANSITION'].includes(error.code)?409:error.code==='STORAGE'?500:400;return response(status,{success:false,error:{code:error.code==='STORAGE'?'SERVICE_UNAVAILABLE':error.code}});}
  return response(500,{success:false,error:{code:'SERVICE_UNAVAILABLE'}});
 }
}
