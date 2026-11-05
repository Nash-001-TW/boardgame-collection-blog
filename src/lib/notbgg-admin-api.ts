import { authorizeAdminRequest } from './auth/admin-request';
import { gameCatalogKey, isNotBggId } from './game-identity';
import type { NotBggId } from './game-identity';
import { NotBggRepository, NotBggRepositoryError } from './notbgg-repository';
import { NotBggValidationError, validateCreateNotBggGame, validateUpdateNotBggGame } from './notbgg-validation';
import { notBggGameViewModel } from './game-view-model';

export const adminRequestLimits = { bytes: 262144, fields: 32, nodes: 5000, depth: 8 } as const;
export interface NotBggAdminBindings extends Record<string, unknown> {
    DB?: D1Database;
    /** Required for writes; optional in the type so missing deployments fail closed. */
    NOTBGG_WRITE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
}
export class HttpError extends Error {
    constructor(public status: number, public code: string, public field?: string) { super(code); }
}
export function response(status: number, payload: unknown): Response {
    return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
        ...(status === 429 ? { 'Retry-After': '60' } : {}) } });
}
/** Shared write gate. Never turn missing, failed or malformed limiter decisions into permission. */
export async function requireAdminWriteLimit(bindings: NotBggAdminBindings, subject: string): Promise<void> {
    let decision: { success: boolean };
    try {
        const limiter = bindings.NOTBGG_WRITE_LIMITER;
        if (!limiter || typeof limiter.limit !== 'function' || !subject) throw new Error('Unavailable');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject));
        const key = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
        decision = await limiter.limit({ key });
    } catch {
        throw new HttpError(503, 'RATE_LIMITER_UNAVAILABLE');
    }
    if (decision?.success === true) return;
    if (decision?.success === false) throw new HttpError(429, 'RATE_LIMITED');
    throw new HttpError(503, 'RATE_LIMITER_UNAVAILABLE');
}
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'INVALID_BODY');
    return value as Record<string, unknown>;
}
function keys(row: Record<string, unknown>, allowed: string[]) {
    if (Object.keys(row).some(key => !allowed.includes(key))) throw new HttpError(400, 'UNKNOWN_FIELD');
}
function revision(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new HttpError(400, 'INVALID_REVISION');
    return value;
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'JSON_REQUIRED');
    const declared = request.headers.get('Content-Length');
    if (declared !== null && !/^\d+$/.test(declared)) throw new HttpError(400, 'INVALID_CONTENT_LENGTH');
    if (declared !== null && Number(declared) > adminRequestLimits.bytes) throw new HttpError(413, 'BODY_TOO_LARGE');
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, 'INVALID_JSON');
    let length = 0; const chunks: Uint8Array[] = [];
    try {
        for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            length += value.length;
            if (length > adminRequestLimits.bytes) { await reader.cancel(); throw new HttpError(413, 'BODY_TOO_LARGE'); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    let parsed: unknown;
    try {
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch { throw new HttpError(400, 'INVALID_JSON'); }
    let nodes = 0;
    function inspect(value: unknown, depth: number) {
        if (++nodes > adminRequestLimits.nodes || depth > adminRequestLimits.depth) throw new HttpError(400, 'BODY_COMPLEXITY');
        if (value && typeof value === 'object') {
            if (!Array.isArray(value) && Object.keys(value).length > adminRequestLimits.fields) throw new HttpError(400, 'TOO_MANY_FIELDS');
            for (const child of Object.values(value)) inspect(child, depth + 1);
        }
    }
    inspect(parsed, 0);
    return object(parsed);
}
function integerQuery(raw: string | null, fallback: number, min: number, max: number): number {
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, 'INVALID_QUERY');
    return value;
}

/** Every route invocation verifies Access itself, even if middleware was not run. No auth injection/bypass. */
export async function handleNotBggAdminRequest(request: Request, bindings: NotBggAdminBindings): Promise<Response> {
    try {
        const authorization = await authorizeAdminRequest(request, bindings);
        if (!('admin' in authorization)) throw new HttpError(authorization.status, authorization.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN');
        const url = new URL(request.url);
        const match = url.pathname.replace(/\/$/, '').match(/^\/api\/admin\/notbgg(?:\/([^/]+)(?:\/(history|archive))?)?$/);
        if (!match) throw new HttpError(404, 'NOT_FOUND');
        let id: NotBggId | undefined;
        if (match[1]) {
            let raw: string;
            try { raw = decodeURIComponent(match[1]); } catch { throw new HttpError(400, 'INVALID_ID'); }
            if (!isNotBggId(raw)) throw new HttpError(400, 'INVALID_ID'); id = raw;
        }
        const action = match[2];
        const allowed = !id ? ['GET', 'POST'] : action === 'archive' ? ['POST'] : action === 'history' ? ['GET'] : ['GET', 'PATCH'];
        if (!allowed.includes(request.method)) return new Response(null, { status: 405, headers: { Allow: allowed.join(', '), 'Cache-Control': 'no-store' } });
        const write = request.method !== 'GET';
        if (write) {
            if (request.headers.get('Origin') !== url.origin || request.headers.get('X-NotBGG-Request') !== '1'
                || !['same-origin', 'none', null].includes(request.headers.get('Sec-Fetch-Site'))) throw new HttpError(403, 'ORIGIN_REJECTED');
        }
        if (!bindings.DB) throw new HttpError(503, 'DATABASE_UNAVAILABLE');
        if (write) await requireAdminWriteLimit(bindings, authorization.admin.subject);
        const repo = new NotBggRepository(bindings.DB), actor = authorization.admin.subject;
        const ok = (data: unknown, status = 200) => response(status, { success: true, visibility: 'admin', data });
        if (request.method === 'GET') {
            if (!id) {
                for (const key of url.searchParams.keys()) if (!['q', 'limit', 'after', 'includeArchived'].includes(key)) throw new HttpError(400, 'INVALID_QUERY');
                const archived = url.searchParams.get('includeArchived');
                if (archived !== null && !['true', 'false'].includes(archived)) throw new HttpError(400, 'INVALID_QUERY');
                const after = url.searchParams.get('after');
                if (after && !isNotBggId(after)) throw new HttpError(400, 'INVALID_QUERY');
                const page = await repo.list({ query: url.searchParams.get('q') ?? '', limit: integerQuery(url.searchParams.get('limit'), 20, 1, 100),
                    includeArchived: archived === 'true', after: after as NotBggId | undefined || undefined });
                return ok({ items: page.items.map(game => ({ notBggId: game.notBggId, name: game.name, type: game.type,
                    accessoryCategories: game.accessoryCategories, createdAt: game.createdAt, updatedAt: game.updatedAt,
                    revision: game.revision, archivedAt: game.archivedAt })), nextCursor: page.nextCursor });
            }
            if (action === 'history') {
                for (const key of url.searchParams.keys()) if (!['afterRevision', 'limit'].includes(key)) throw new HttpError(400, 'INVALID_QUERY');
                const limit = integerQuery(url.searchParams.get('limit'), 20, 1, 100), afterRevision = integerQuery(url.searchParams.get('afterRevision'), 0, 0, Number.MAX_SAFE_INTEGER);
                const rows = await repo.getRevisionHistory(id, { limit: limit + 1, afterRevision });
                return ok({ items: rows.slice(0, limit).map(row => ({ ...row, operation: row.revision === 1 ? 'create' : row.snapshot.archivedAt ? 'archive' : 'update' })),
                    nextRevision: rows.length > limit ? rows[limit - 1].revision : null });
            }
            const game = await repo.getByNotBggId(id); if (!game) throw new HttpError(404, 'NOT_FOUND');
            return ok({ admin: game, public: notBggGameViewModel(game) });
        }
        const body = await readJson(request);
        if (!id) {
            const data = validateCreateNotBggGame(body);
            if (data.type === 'boardgameaccessory' && !data.accessoryCategories.length) throw new NotBggValidationError('accessoryCategories', 'Select at least one category');
            await repo.validateRelatedGames(data.relatedGameIds);
            const key = request.headers.get('Idempotency-Key');
            if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY');
            const scope = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(actor));
            const scopedKey = Array.from(new Uint8Array(scope), n => n.toString(16).padStart(2, '0')).join('') + ':' + key;
            const result = await repo.create(data, { actor, idempotencyKey: scopedKey });
            return ok({ admin: result.game, public: notBggGameViewModel(result.game), replayed: result.replayed }, result.replayed ? 200 : 201);
        }
        if (action === 'archive') {
            keys(body, ['expectedRevision']);
            const game = await repo.archive(id, { actor, expectedRevision: revision(body.expectedRevision) });
            return ok({ admin: game, public: notBggGameViewModel(game) });
        }
        keys(body, ['expectedRevision', 'changes']); const expectedRevision = revision(body.expectedRevision);
        const current = await repo.getByNotBggId(id); if (!current) throw new HttpError(404, 'NOT_FOUND');
        if(current.linkStatus==='linked' && body.changes && typeof body.changes==='object' && 'type' in body.changes && body.changes.type!==current.type)throw new HttpError(409,'LINKED_TYPE_CHANGE');
        if (current.revision !== expectedRevision) throw new HttpError(409, 'REVISION_CONFLICT');
        const data = validateUpdateNotBggGame(object(body.changes), current);
        if (data.type === 'boardgameaccessory' && !data.accessoryCategories.length) throw new NotBggValidationError('accessoryCategories', 'Select at least one category');
        const existing = new Set(current.relatedGameIds.map(gameCatalogKey));
        await repo.validateRelatedGames(data.relatedGameIds.filter(ref => !existing.has(gameCatalogKey(ref))), id);
        const game = await repo.update(id, data, { actor, expectedRevision });
        return ok({ admin: game, public: notBggGameViewModel(game) });
    } catch (error) {
        if (error instanceof HttpError) return response(error.status, { success: false, error: { code: error.code, field: error.field } });
        if (error instanceof NotBggValidationError) return response(400, { success: false, error: { code: 'VALIDATION', field: error.field } });
        if (error instanceof NotBggRepositoryError) {
            const statuses = { INVALID_ARGUMENT: 400, INVALID_REFERENCE: 400, NOT_FOUND: 404, CONFLICT: 409, ARCHIVED: 409, IDEMPOTENCY_CONFLICT: 409, STORAGE: 500 };
            return response(statuses[error.code], { success: false, error: { code: error.code === 'STORAGE' ? 'SERVICE_UNAVAILABLE' : error.code,
                field: error.code === 'INVALID_REFERENCE' ? 'relatedGameIds' : undefined } });
        }
        return response(500, { success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    }
}
