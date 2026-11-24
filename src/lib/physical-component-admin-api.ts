import { authorizeAdminRequest } from './auth/admin-request';
import { HttpError, readJson, requireAdminWriteLimit, response, type NotBggAdminBindings } from './notbgg-admin-api';
import { logQuantityError, logQuantitySuccess } from './shared-quantity-commit';
import { writePhysicalComponent } from './physical-component-management';

export async function handlePhysicalComponentRequest(request: Request, bindings: NotBggAdminBindings) {
    let quantityAction: unknown;
    let operationId: string | undefined;
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
        quantityAction = body.action;
        operationId = request.headers.get('Idempotency-Key') ?? undefined;
        const data = await writePhysicalComponent(bindings.DB, bindings.PHYSICAL_COMPONENT_SIGNING_KEY,
            auth.admin.subject, request.headers.get('Idempotency-Key'), body);
        if ((body.action === 'quantity-commit' || body.action === 'quantity-status') && 'outcome' in data && data.outcome !== undefined) {
            if (data.outcome === 'COMMITTED') {
                if (body.action === 'quantity-commit') logQuantitySuccess(data.operationId, data.replayed);
                return response(200, { success: true, data });
            }
            const result = data.outcome === 'UNKNOWN' ? { ...data, code: 'D1_RESULT_UNKNOWN' }
                : { operationId: data.operationId, outcome: 'NOT_COMMITTED' as const, code: data.code };
            const status = body.action === 'quantity-status' ? 200
                : result.outcome === 'UNKNOWN' || result.code === 'EVIDENCE_UNAVAILABLE' ? 503 : 409;
            return response(status, { success: false, data: result, error: { code: result.code } });
        }
        return response(body.action === 'create' && 'replayed' in data && !data.replayed ? 201 : 200, { success: true, data });
    } catch (error) {
        if (error instanceof HttpError && error.status < 500) {
            return response(error.status, { success: false, error: { code: error.code } });
        }
        if (quantityAction === 'quantity-commit' || quantityAction === 'quantity-status') {
            logQuantityError('request', operationId, error);
            const code = 'D1_RESULT_UNKNOWN';
            return response(quantityAction === 'quantity-status' ? 200 : 503, {
                success: false, data: { operationId, outcome: 'UNKNOWN', code }, error: { code },
            });
        }
        if (quantityAction === 'quantity-preview') {
            logQuantityError('request', operationId, error);
            return response(503, { success: false, error: { code: 'EVIDENCE_UNAVAILABLE' } });
        }
        if (error instanceof HttpError) return response(error.status, { success: false, error: { code: error.code } });
        if (String(error).includes('PHYSICAL_TYPE_IN_USE')) {
            return response(409, { success: false, error: { code: 'PHYSICAL_TYPE_IN_USE' } });
        }
        console.error('Physical component operation failed', error);
        return response(503, { success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    }
}
