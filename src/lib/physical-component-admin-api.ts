import { authorizeAdminRequest } from './auth/admin-request';
import { HttpError, readJson, requireAdminWriteLimit, response, type NotBggAdminBindings } from './notbgg-admin-api';
import { writePhysicalComponent } from './physical-component-management';

export async function handlePhysicalComponentRequest(request: Request, bindings: NotBggAdminBindings) {
    try {
        const auth = await authorizeAdminRequest(request, bindings);
        if (!('admin' in auth)) throw new HttpError(auth.status, auth.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN');
        if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        if (request.headers.get('Origin') !== new URL(request.url).origin
            || request.headers.get('X-NotBGG-Request') !== '1'
            || !['same-origin', 'none', null].includes(request.headers.get('Sec-Fetch-Site'))) {
            throw new HttpError(403, 'ORIGIN_REJECTED');
        }
        if (!bindings.DB) throw new HttpError(503, 'DATABASE_UNAVAILABLE');
        await requireAdminWriteLimit(bindings, auth.admin.subject);
        const body = await readJson(request);
        const data = await writePhysicalComponent(bindings.DB, bindings.PHYSICAL_COMPONENT_SIGNING_KEY,
            auth.admin.subject, request.headers.get('Idempotency-Key'), body);
        return response(body.action === 'create' && 'replayed' in data && !data.replayed ? 201 : 200, { success: true, data });
    } catch (error) {
        if (error instanceof HttpError) return response(error.status, { success: false, error: { code: error.code } });
        if (String(error).includes('PHYSICAL_TYPE_IN_USE')) {
            return response(409, { success: false, error: { code: 'PHYSICAL_TYPE_IN_USE' } });
        }
        console.error('Physical component operation failed', error);
        return response(503, { success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    }
}
