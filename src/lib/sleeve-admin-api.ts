import { authorizeAdminRequest } from './auth/admin-request';
import { HttpError, response, readJson, requireAdminWriteLimit, type NotBggAdminBindings } from './notbgg-admin-api';
import { readSleeveAdmin, writeSleeveAdmin } from './sleeve-admin';
import { readSleeveWorkflow, writeSleeveWorkflow } from './sleeve-workflow';

export async function handleSleeveAdminRequest(request: Request, bindings: NotBggAdminBindings) {
    try {
        const authorization = await authorizeAdminRequest(request,bindings);
        if (!('admin' in authorization)) throw new HttpError(authorization.status,authorization.status===401?'UNAUTHENTICATED':'FORBIDDEN');
        if (!bindings.DB) throw new HttpError(503,'DATABASE_UNAVAILABLE');
        if (request.method === 'GET') {
            const params=new URL(request.url).searchParams;
            return response(200,{success:true,data:params.get('view')==='workflow'
                ?await readSleeveWorkflow(bindings.DB,Number(params.get('collection')),bindings.PHYSICAL_COMPONENT_SIGNING_KEY)
                :await readSleeveAdmin(bindings.DB,params,bindings.PHYSICAL_COMPONENT_SIGNING_KEY)});
        }
        if (request.method !== 'POST') throw new HttpError(405,'METHOD_NOT_ALLOWED');
        if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-NotBGG-Request') !== '1'
            || !['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site'))) throw new HttpError(403,'ORIGIN_REJECTED');
        await requireAdminWriteLimit(bindings,authorization.admin.subject);
        const body=await readJson(request);
        const data = body.action==='requirement'||body.action==='requirements-batch'||body.action==='apply'
            ?await writeSleeveWorkflow(bindings.DB,bindings.PHYSICAL_COMPONENT_SIGNING_KEY,authorization.admin.subject,request.headers.get('Idempotency-Key'),body)
            :await writeSleeveAdmin(bindings.DB,authorization.admin.subject,request.headers.get('Idempotency-Key'),body);
        return response(data.replayed?200:201,{success:true,data});
    } catch (error) {
        if (error instanceof HttpError) return response(error.status,{success:false,error:{code:error.code}});
        console.error('Sleeve admin failure',error);
        return response(503,{success:false,error:{code:'SERVICE_UNAVAILABLE'}});
    }
}
