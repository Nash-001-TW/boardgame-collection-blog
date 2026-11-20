import { authorizeAdminRequest } from './auth/admin-request';
import { HttpError,response,readJson,requireAdminWriteLimit,type NotBggAdminBindings } from './notbgg-admin-api';
import { readCollectionCopies,writeCollectionCopy } from './collection-copies';
import type { CollectionScope } from './collection-v2-management';
import { writeCopyCondition } from './purchase-admin';

export async function handleCollectionCopiesRequest(request:Request,bindings:NotBggAdminBindings){
    try{
        const auth=await authorizeAdminRequest(request,bindings);
        if(!('admin' in auth))throw new HttpError(auth.status,auth.status===401?'UNAUTHENTICATED':'FORBIDDEN');
        const url=new URL(request.url),match=url.pathname.match(/^\/api\/admin\/collection\/([1-9][0-9]*)\/copies\/?$/);
        if(!match||!Number.isSafeInteger(Number(match[1])))throw new HttpError(404,'NOT_FOUND');
        const collectionId=Number(match[1]),scope=url.searchParams.get('scope')??'production';
        if(scope!=='production'&&scope!=='test')throw new HttpError(400,'INVALID_SCOPE');
        if(!bindings.DB)throw new HttpError(503,'DATABASE_UNAVAILABLE');
        if(request.method==='GET')return response(200,{success:true,data:await readCollectionCopies(bindings.DB,collectionId,scope,Number(url.searchParams.get('after')??0))});
        if(request.method!=='POST'&&request.method!=='PATCH')throw new HttpError(405,'METHOD_NOT_ALLOWED');
        if(request.headers.get('Origin')!==url.origin||request.headers.get('X-NotBGG-Request')!=='1'
            ||!['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site')))throw new HttpError(403,'ORIGIN_REJECTED');
        await requireAdminWriteLimit(bindings,auth.admin.subject);
        const body=await readJson(request);
        const result=body.action==='condition'&&request.method==='PATCH'
            ?await writeCopyCondition(bindings.DB,collectionId,scope,auth.admin.subject,request.headers.get('Idempotency-Key'),body)
            :await writeCollectionCopy(bindings.DB,collectionId,scope as CollectionScope,auth.admin.subject,
            request.headers.get('Idempotency-Key'),body,request.method==='PATCH');
        return response(request.method==='POST'&&!result.replayed?201:200,{success:true,data:result});
    }catch(error){
        if(error instanceof HttpError)return response(error.status,{success:false,error:{code:error.code}});
        console.error('Collection copy operation failed',error);
        return response(503,{success:false,error:{code:'SERVICE_UNAVAILABLE'}});
    }
}
