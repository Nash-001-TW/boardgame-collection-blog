import {authorizeAdminRequest} from './auth/admin-request';
import {HttpError,response,readJson,requireAdminWriteLimit,type NotBggAdminBindings} from './notbgg-admin-api';
import {readPurchase,readPurchases,writePurchase} from './purchase-admin';
export async function handlePurchaseAdminRequest(request:Request,bindings:NotBggAdminBindings){
 try{
  const auth=await authorizeAdminRequest(request,bindings);if(!('admin'in auth))throw new HttpError(auth.status,auth.status===401?'UNAUTHENTICATED':'FORBIDDEN');
  if(!bindings.DB)throw new HttpError(503,'DATABASE_UNAVAILABLE');
  const url=new URL(request.url);
  if(request.method==='GET')return response(200,{success:true,data:url.searchParams.has('id')?await readPurchase(bindings.DB,Number(url.searchParams.get('id'))):await readPurchases(bindings.DB,url.searchParams)});
  if(request.method!=='POST')throw new HttpError(405,'METHOD_NOT_ALLOWED');
  if(request.headers.get('Origin')!==url.origin||request.headers.get('X-NotBGG-Request')!=='1'||!['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site')))throw new HttpError(403,'ORIGIN_REJECTED');
  await requireAdminWriteLimit(bindings,auth.admin.subject);
  const data=await writePurchase(bindings.DB,auth.admin.subject,request.headers.get('Idempotency-Key'),await readJson(request));
  return response(data.replayed?200:201,{success:true,data});
 }catch(error){if(error instanceof HttpError)return response(error.status,{success:false,error:{code:error.code}});console.error('Purchase admin failure',error);return response(503,{success:false,error:{code:'SERVICE_UNAVAILABLE'}});}
}
