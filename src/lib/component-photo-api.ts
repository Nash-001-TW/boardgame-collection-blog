import { authorizeAdminRequest } from './auth/admin-request';
import { classifyStoredComponents } from './component-classifier-adapter';
import { photoBytes, thumbBytes, validatePhoto, type PhotoType } from './component-photo-image';
import { HttpError, requireAdminWriteLimit, response, type NotBggAdminBindings } from './notbgg-admin-api';

export interface PhotoStore {
    put(key: string, value: ArrayBuffer): Promise<unknown>;
    get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null>;
    delete(key: string): Promise<void>;
}
export interface PhotoBindings extends NotBggAdminBindings {
    COMPONENT_PHOTOS?: PhotoStore;
}
export const adminPhotoPath = '/api/admin/collection/component-photos';
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxBody = photoBytes + thumbBytes + 16384;

class PhotoTimeout extends Error {}
function deadline<T>(request: Promise<T>, stage: string, timeout = 10000): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([request, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PhotoTimeout(stage + ' timed out')), timeout);
    })]).finally(() => clearTimeout(timer));
}
function bad(status: number, code: string): never {
    throw new HttpError(status, code);
}

async function multipart(request: Request) {
    const type = request.headers.get('Content-Type') ?? '';
    if (!/^multipart\/form-data;/i.test(type)) bad(415, 'PHOTO_MULTIPART_REQUIRED');
    if (Number(request.headers.get('Content-Length')) > maxBody) bad(413, 'PHOTO_TOO_LARGE');
    if (!request.body) bad(400, 'PHOTO_INVALID_BODY');
    const reader = request.body.getReader();
    const bytes = new Uint8Array(maxBody);
    let length = 0;
    const end = Date.now() + 10000;
    try {
        for (;;) {
            const remaining = end - Date.now();
            if (remaining <= 0) bad(408, 'PHOTO_BODY_TIMEOUT');
            const part = await deadline(reader.read(), 'Photo request body', remaining);
            if (part.done) break;
            if (length + part.value.length > maxBody) bad(413, 'PHOTO_TOO_LARGE');
            bytes.set(part.value, length);
            length += part.value.length;
        }
    } catch (error) {
        void reader.cancel().catch(() => console.warn('Photo request cancellation failed'));
        throw error;
    } finally {
        reader.releaseLock();
    }
    try {
        return await new Response(bytes.subarray(0, length), { headers: { 'Content-Type': type } }).formData();
    } catch {
        return bad(400, 'PHOTO_INVALID_BODY');
    }
}

async function sha(value: BufferSource) {
    const bytes = await crypto.subtle.digest('SHA-256', value);
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function fieldInt(form: FormData, key: string, min: number) {
    const value = form.get(key);
    const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(number) || number < min) bad(400, 'PHOTO_INVALID_BODY');
    return number;
}
interface Receipt { digest: string; attempt: string; }
const writable = `SELECT d.id FROM v2_component_definitions d
    JOIN v2_collection_items c ON c.id=d.collection_item_id
    LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id
    WHERE d.id=? AND d.physical_creation_token IS NOT NULL AND m.archived_at IS NULL`;

async function queueOrphan(db: D1Database, key: string) {
    try {
        const queued = await deadline(db.prepare('INSERT OR IGNORE INTO v2_component_photo_orphans(object_key) VALUES (?)')
            .bind(key).run(), 'D1 photo cleanup queue');
        if (queued.success) return;
    } catch (error) {
        console.error('Component photo cleanup queue failed', { key, cause: error instanceof Error ? error.name : 'Unknown' });
        return;
    }
    console.error('Component photo cleanup queue unavailable', { key });
}
async function compensate(db: D1Database, store: PhotoStore, keys: string[]) {
    for (const key of keys) {
        try {
            await deadline(store.delete(key), 'R2 photo delete');
        } catch {
            console.error('Component photo compensation failed');
            await queueOrphan(db, key);
        }
    }
}

export async function handleComponentPhotoWrite(request: Request, bindings: PhotoBindings,
    defer: (task: Promise<void>) => void = () => undefined) {
    try {
        const auth = await authorizeAdminRequest(request, bindings);
        if (!('admin' in auth)) bad(auth.status, auth.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN');
        if (request.method !== 'POST') bad(405, 'METHOD_NOT_ALLOWED');
        if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-NotBGG-Request') !== '1'
            || !['same-origin', 'none', null].includes(request.headers.get('Sec-Fetch-Site'))) bad(403, 'ORIGIN_REJECTED');
        const db = bindings.DB;
        const store = bindings.COMPONENT_PHOTOS;
        if (!db || !store) bad(503, 'PHOTO_SERVICE_UNAVAILABLE');
        await deadline(requireAdminWriteLimit(bindings, auth.admin.subject), 'Photo rate limiter');
        const operation = request.headers.get('Idempotency-Key');
        if (!operation || !/^[A-Za-z0-9_-]{16,128}$/.test(operation)) bad(400, 'PHOTO_IDEMPOTENCY_REQUIRED');
        const form = await multipart(request);
        const action = form.get('action');
        const allowed = ['action', 'definitionId', 'photoId', 'revision',
            ...(action === 'upload' ? ['photo', 'thumb', 'isPublic'] : [])];
        if (![...form.keys()].every(key => allowed.includes(key) && form.getAll(key).length === 1)
            || (action !== 'upload' && action !== 'remove')) bad(400, 'PHOTO_INVALID_BODY');
        const definition = fieldInt(form, 'definitionId', 1);
        const photoId = fieldInt(form, 'photoId', 0);
        const revision = fieldInt(form, 'revision', 0);
        if ((!photoId) !== (!revision) || (action === 'remove' && !photoId)) bad(400, 'PHOTO_INVALID_BODY');
        const visibility = action === 'upload' ? fieldInt(form, 'isPublic', 0) : 0;
        if (visibility > 1) bad(400, 'PHOTO_INVALID_BODY');
        const image = action === 'upload' ? await validatePhoto(form.get('photo'), photoBytes, 1600) : null;
        const thumb = action === 'upload' ? await validatePhoto(form.get('thumb'), thumbBytes, 224) : null;
        if (image && thumb && image.type !== thumb.type) bad(415, 'PHOTO_INVALID_TYPE');
        const digest = await sha(new TextEncoder().encode(JSON.stringify([action, definition, photoId, revision, visibility,
            image?.type, image && await sha(image.buffer), thumb && await sha(thumb.buffer)])));
        const actor = auth.admin.subject;
        const primary = db.withSession?.('first-primary') ?? db;
        const receipt = () => deadline(primary.prepare('SELECT digest, attempt FROM v2_component_photo_commands WHERE actor=? AND operation_id=?')
            .bind(actor, operation).first<Receipt>(), 'D1 photo receipt');
        const success = (replayed: boolean) => response(200, { success: true, data: { replayed } });
        const replay = (row: Receipt) => row.digest === digest ? success(true) : bad(409, 'PHOTO_IDEMPOTENCY_CONFLICT');
        const prior = await receipt();
        if (prior) return replay(prior);

        const current = await deadline(primary.prepare(`SELECT p.id, p.revision FROM (${writable}) d
            LEFT JOIN v2_component_photos p ON p.definition_id=d.id AND p.language_code IS NULL`)
            .bind(definition).first<{ id: number | null; revision: number | null }>(), 'D1 photo revision');
        if (!current) bad(404, 'PHOTO_COMPONENT_NOT_FOUND');
        if ((current.id ?? 0) !== photoId || (current.revision ?? 0) !== revision) {
            const concurrent = await receipt();
            if (concurrent) return replay(concurrent);
            bad(409, 'PHOTO_REVISION_CONFLICT');
        }
        const [classification] = await deadline(classifyStoredComponents(primary, [definition],
            { secret: bindings.PHYSICAL_COMPONENT_SIGNING_KEY }), 'D1 photo component verification');
        if (!classification || classification.reason === 'EVIDENCE_UNAVAILABLE')
            bad(503, 'PHOTO_EVIDENCE_UNAVAILABLE');
        const signature = classification.evidence.physicalSignature;
        if (classification.classification !== 'PHYSICAL_COMPONENT' || !signature)
            bad(409, 'PHOTO_COMPONENT_INELIGIBLE');
        const guarded = writable + ` AND EXISTS (SELECT 1 FROM v2_physical_component_sources source
            WHERE source.definition_id=d.id AND source.collection_item_id=c.id AND source.record_scope=c.record_scope
              AND source.creation_token=d.physical_creation_token AND source.signature=?)`;

        const attempt = crypto.randomUUID();
        const thumbKey = crypto.randomUUID();
        const keys: string[] = [];
        let mutation: D1PreparedStatement;
        if (image && thumb) {
            const values = [attempt, thumbKey, image.type, image.width, image.height, image.byteSize, visibility];
            mutation = photoId ? db.prepare(`UPDATE v2_component_photos
                SET object_key=?, thumb_key=?, content_type=?, width=?, height=?, byte_size=?, is_public=?, revision=revision+1,
                    created_at=CURRENT_TIMESTAMP
                WHERE id=? AND revision=? AND definition_id IN (${guarded})`)
                .bind(...values, photoId, revision, definition, signature)
                : db.prepare(`INSERT INTO v2_component_photos(definition_id,object_key,thumb_key,content_type,width,height,byte_size,is_public)
                    SELECT d.id,?,?,?,?,?,?,? FROM (${guarded}) d
                    WHERE NOT EXISTS (SELECT 1 FROM v2_component_photos p WHERE p.definition_id=d.id AND p.language_code IS NULL)`)
                    .bind(...values, definition, signature);
            for (const [key, bytes] of [[attempt, image.buffer], [thumbKey, thumb.buffer]] as const) {
                keys.push(key);
                const put = Promise.resolve().then(() => store.put(key, bytes));
                try {
                    await deadline(put, 'R2 photo put');
                } catch (error) {
                    if (error instanceof PhotoTimeout) {
                        // A put that outlives its deadline may become visible after an immediate delete.
                        await queueOrphan(db, key);
                        defer(put.then(() => compensate(db, store, [key]), () => undefined));
                        await compensate(db, store, keys.slice(0, -1));
                    } else {
                        await compensate(db, store, keys);
                    }
                    throw error;
                }
            }
        } else {
            mutation = db.prepare(`DELETE FROM v2_component_photos
                WHERE id=? AND revision=? AND definition_id IN (${guarded})`).bind(photoId, revision, definition, signature);
        }

        // The receipt and photo (including cleanup triggers) commit together. A duplicate operation
        // key rolls back the entire losing batch, even on a different component.
        const commit = Promise.resolve().then(() => db.batch([mutation, db.prepare(`INSERT INTO v2_component_photo_commands
            (actor,operation_id,digest,attempt) SELECT ?,?,?,? WHERE changes()=1`).bind(actor, operation, digest, attempt)]));
        let committed: D1Result[];
        try {
            committed = await deadline(commit, 'D1 photo commit');
        } catch (error) {
            // A primary receipt distinguishes a committed write from an uncommitted attempt.
            // If the deadline expires, do not compensate while the write may still be in flight.
            const reconcile = async () => {
                const observed = await receipt();
                if (observed?.attempt !== attempt) await compensate(db, store, keys);
                return observed;
            };
            if (error instanceof PhotoTimeout) {
                defer(commit.then(reconcile, reconcile)
                    .then(() => undefined, () => console.error('Component photo commit outcome unknown', { attempt })));
                bad(503, 'PHOTO_RESULT_UNKNOWN');
            }
            const observed = await reconcile();
            if (observed?.attempt === attempt) return success(false);
            if (observed) return replay(observed);
            bad(503, 'PHOTO_SERVICE_UNAVAILABLE');
        }
        if (!committed.every(result => result.success) || committed[1]?.meta.changes !== 1) {
            const observed = await receipt();
            if (observed?.attempt === attempt) return success(false);
            await compensate(db, store, keys);
            if (observed) return replay(observed);
            if (!committed.every(result => result.success)) bad(503, 'PHOTO_SERVICE_UNAVAILABLE');
            bad(409, 'PHOTO_REVISION_CONFLICT');
        }
        return success(false);
    } catch (error) {
        if (!(error instanceof HttpError)) console.error('Component photo write failed', error instanceof Error ? error.name : 'Unknown');
        return response(error instanceof HttpError ? error.status : 503,
            { success: false, error: { code: error instanceof HttpError ? error.code : 'PHOTO_SERVICE_UNAVAILABLE' } });
    }
}

export async function handleComponentPhotoRead(request: Request, bindings: PhotoBindings, key: string, admin: boolean) {
    const error = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
    try {
        if (admin) {
            const auth = await authorizeAdminRequest(request, bindings);
            if (!('admin' in auth)) return error(auth.status);
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') return error(405);
        if (!keyPattern.test(key)) return error(404);
        const db = bindings.DB;
        const store = bindings.COMPONENT_PHOTOS;
        if (!db || !store) return error(503);
        const eligibility = admin ? '' : `JOIN v2_component_definitions d ON d.id=p.definition_id
            JOIN v2_collection_items c ON c.id=d.collection_item_id
            JOIN v2_games g ON g.id=c.game_id
            LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id
            LEFT JOIN notbgg_games n ON n.game_id=g.id`;
        const visibility = admin ? '' : `AND p.is_public=1 AND c.record_scope='production'
            AND m.archived_at IS NULL AND n.archived_at IS NULL AND (g.bgg_id IS NOT NULL OR n.seq IS NOT NULL)`;
        const row = await deadline(db.prepare(`SELECT p.content_type FROM v2_component_photos p ${eligibility}
            WHERE (p.object_key=? OR p.thumb_key=?) ${visibility} LIMIT 1`).bind(key, key)
            .first<{ content_type: PhotoType }>(), 'D1 photo read');
        if (!row) return error(404);
        if (!['image/webp', 'image/jpeg'].includes(row.content_type)) return error(503);
        const object = await deadline(store.get(key), 'R2 photo read');
        if (!object) return error(503); // The current D1 row refers to a missing object.
        const headers = new Headers({
            'Cache-Control': admin ? 'private, no-store' : 'public, max-age=300, must-revalidate',
            'X-Content-Type-Options': 'nosniff',
        });
        const etag = '"' + key + '"';
        const matches = !admin && request.headers.get('If-None-Match')?.split(',')
            .some(tag => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag);
        if (!admin) headers.set('ETag', etag);
        if (matches || request.method === 'HEAD') {
            void object.body.cancel().catch(() => console.warn('Photo stream cancellation failed'));
            if (matches) return new Response(null, { status: 304, headers });
        }
        headers.set('Content-Type', row.content_type);
        return new Response(request.method === 'HEAD' ? null : object.body, { headers });
    } catch (cause) {
        console.error('Component photo read failed', cause instanceof Error ? cause.name : 'Unknown');
        return error(503);
    }
}
