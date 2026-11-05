import { formatNotBggId, gameCatalogKey, isBggId, isNotBggId, parseGameRef } from './game-identity';
import type { GameRef, NotBggId } from './game-identity';
import type { CreateNotBggGameInput, UpdateNotBggGameInput, NotBggGame, NotBggEditableFields } from './notbgg-contract';
import { validateCreateNotBggGame, validateUpdateNotBggGame } from './notbgg-validation';

export type NotBggRepositoryErrorCode = 'INVALID_ARGUMENT' | 'INVALID_REFERENCE' | 'NOT_FOUND' | 'CONFLICT' | 'ARCHIVED' | 'IDEMPOTENCY_CONFLICT' | 'STORAGE';
export class NotBggRepositoryError extends Error {
    constructor(public readonly code: NotBggRepositoryErrorCode, message: string, options?: ErrorOptions) { super(message, options); }
}
export interface NotBggWriteContext { actor: string; expectedRevision: number }
export interface NotBggCreateContext { actor: string; idempotencyKey: string }
export interface NotBggRevision { revision: number; actor: string; createdAt: string; snapshot: NotBggGame }
export interface NotBggListOptions { includeArchived?: boolean; limit?: number; after?: NotBggId; query?: string }

const columns = {
    name: 'name', type: 'type', description: 'description', yearPublished: 'year_published', minAge: 'min_age',
    minPlayers: 'min_players', maxPlayers: 'max_players', minPlaytime: 'min_playtime', maxPlaytime: 'max_playtime',
    recommendedPlayers: 'recommended_players_json', alternateNames: 'alternate_names_json', designers: 'designers_json',
    artists: 'artists_json', publishers: 'publishers_json', categories: 'categories_json', mechanics: 'mechanics_json',
    families: 'families_json', referenceUrls: 'reference_urls_json', imageUrl: 'image_url', thumbnailUrl: 'thumbnail_url',
    editorNotes: 'editor_notes', contents: 'contents'
} as const;
const entries = Object.entries(columns) as [keyof typeof columns, string][];
type Row = Record<string, unknown> & { seq: number; game_id: number; created_at: string; updated_at: string; revision: number; archived_at: string | null };
const select = `SELECT n.*,
 (SELECT json_group_array(category) FROM (SELECT category FROM notbgg_accessory_categories WHERE seq=n.seq ORDER BY category)) AS accessory_json,
 (SELECT json_group_array(json(ref)) FROM (
   SELECT CASE WHEN g.bgg_id IS NOT NULL THEN json_object('source','bgg','bggId',g.bgg_id)
     ELSE json_object('source','notbgg','notBggId',printf('NotBGG:%06d',target.seq)) END AS ref
   FROM site_game_relations r JOIN v2_games g ON g.id=r.target_game_id
   LEFT JOIN notbgg_games target ON target.game_id=g.id
   WHERE r.source_game_id=n.game_id AND r.relation_type='accessory_for' AND r.relation_source='manual' AND r.archived_at IS NULL ORDER BY r.target_game_id)) AS related_json,
 l.status AS link_status,l.candidate_bgg_id AS linked_bgg_id,l.linked_at,l.primary_source
 FROM notbgg_games n LEFT JOIN notbgg_bgg_links l ON l.seq=n.seq AND l.status IN ('pending','linked')`;

function sequence(id: NotBggId): number {
    if (!isNotBggId(id)) throw new NotBggRepositoryError('INVALID_ARGUMENT', 'Invalid NotBGG ID');
    return Number(id.slice(7));
}
function actorName(value: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new NotBggRepositoryError('INVALID_ARGUMENT', 'A trusted actor is required');
    return value.trim();
}
const dbValues = (data: NotBggEditableFields) => entries.map(([key, column]) => {
    const value = data[key]; return column.endsWith('_json') && value !== null ? JSON.stringify(value) : value as string | number | null;
});
const v2Type = (type: NotBggEditableFields['type']) => type === 'boardgame' ? 'base' : type === 'boardgameexpansion' ? 'expansion' : 'accessory';
function decode(row: Row): NotBggGame {
    const data: Record<string, unknown> = {};
    for (const [key, column] of entries) data[key] = column.endsWith('_json') && row[column] !== null ? JSON.parse(String(row[column])) : row[column];
    data.accessoryCategories = JSON.parse(String(row.accessory_json));
    data.relatedGameIds = JSON.parse(String(row.related_json));
    const linked = row.link_status === 'linked';
    return { ...validateCreateNotBggGame(data), gameId: row.game_id, notBggId: formatNotBggId(row.seq), source: 'notbgg',
        createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision, archivedAt: row.archived_at,
        linkStatus: linked ? 'linked' : row.link_status === 'pending' ? 'pending' : 'unlinked',
        linkedBggId: linked ? Number(row.linked_bgg_id) : null, linkedAt: linked ? String(row.linked_at) : null,
        primarySource: linked && row.primary_source === 'bgg' ? 'bgg' : 'notbgg' };
}

/** Backend-only storage. Caller must authorize context.actor; no Astro, env binding, cache or network imports. */
export class NotBggRepository {
    constructor(private readonly db: D1Database) {}

    async getByNotBggId(id: NotBggId): Promise<NotBggGame | null> {
        const row = await this.db.prepare(`${select} WHERE n.seq=?`).bind(sequence(id)).first<Row>();
        return row ? decode(row) : null; // A permanent reservation alone is NEVER a valid game.
    }
    async getByInternalGameId(gameId: number): Promise<NotBggGame | null> {
        if (!isBggId(gameId)) throw new NotBggRepositoryError('INVALID_ARGUMENT', 'Invalid internal game ID');
        const row = await this.db.prepare(`${select} WHERE n.game_id=?`).bind(gameId).first<Row>();
        return row ? decode(row) : null;
    }
    async list(options: NotBggListOptions = {}): Promise<{ items: NotBggGame[]; nextCursor: NotBggId | null }> {
        const limit = options.limit ?? 50;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (options.includeArchived !== undefined && typeof options.includeArchived !== 'boolean')) {
            throw new NotBggRepositoryError('INVALID_ARGUMENT', 'Invalid list options');
        }
        const after = options.after === undefined ? 0 : sequence(options.after);
        if (options.query !== undefined && (typeof options.query !== 'string' || options.query.length > 300)) throw new NotBggRepositoryError('INVALID_ARGUMENT', 'Invalid search');
        const query = options.query?.trim() ?? '';
        let condition = ''; const args: (string | number)[] = [after];
        if (query.startsWith('NotBGG:')) { condition = 'AND n.seq=?'; args.push(sequence(query as NotBggId)); }
        else if (query) { condition = "AND n.name LIKE ? ESCAPE '\\'"; args.push(`%${query.replace(/[\\%_]/g, '\\$&')}%`); }
        const rows = await this.db.prepare(`${select} WHERE n.seq>? ${options.includeArchived ? '' : 'AND n.archived_at IS NULL'} ${condition} ORDER BY n.seq LIMIT ?`)
            .bind(...args, limit + 1).all<Row>();
        const items = rows.results.slice(0, limit).map(decode);
        return { items, nextCursor: rows.results.length > limit ? items.at(-1)!.notBggId : null };
    }
    async getRevisionHistory(id: NotBggId, page?: { afterRevision: number; limit: number }): Promise<NotBggRevision[]> {
        const seq = sequence(id);
        if (!await this.getByNotBggId(id)) throw new NotBggRepositoryError('NOT_FOUND', 'Game not found');
        if (page && (!Number.isSafeInteger(page.afterRevision) || page.afterRevision < 0 || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 101)) throw new NotBggRepositoryError('INVALID_ARGUMENT', 'Invalid history page');
        const rows = await this.db.prepare(`SELECT revision,actor,created_at,snapshot_json FROM notbgg_game_revisions WHERE seq=? ${page ? 'AND revision>? ' : ''}ORDER BY revision${page ? ' LIMIT ?' : ''}`)
            .bind(...(page ? [seq, page.afterRevision, page.limit] : [seq])).all<{ revision: number; actor: string; created_at: string; snapshot_json: string }>();
        return rows.results.map(row => ({ revision: row.revision, actor: row.actor, createdAt: row.created_at, snapshot: JSON.parse(row.snapshot_json) as NotBggGame }));
    }

    /** Reference lookup only. Never imports/cache-fetches or creates missing BGG identities. */
    async validateRelatedGames(refs: readonly GameRef[], sourceId?: NotBggId): Promise<void> {
        if (!Array.isArray(refs) || refs.length > 100) throw new NotBggRepositoryError('INVALID_ARGUMENT', 'Invalid references');
        for (const value of refs) {
            const ref = parseGameRef(value);
            if (ref.source === 'notbgg' && ref.notBggId === sourceId) throw new NotBggRepositoryError('INVALID_REFERENCE', 'Self reference');
            const found = ref.source === 'bgg'
                ? await this.db.prepare('SELECT id FROM v2_games WHERE bgg_id=?').bind(ref.bggId).first()
                : await this.db.prepare('SELECT game_id FROM notbgg_games WHERE seq=? AND archived_at IS NULL').bind(sequence(ref.notBggId)).first();
            if (!found) throw new NotBggRepositoryError('INVALID_REFERENCE', 'Target is not registered or is archived');
        }
    }

    private children(seq: number, data: NotBggEditableFields, actor: string, now: string): D1PreparedStatement[] {
        const statements: D1PreparedStatement[] = [];
        for (const category of data.accessoryCategories) statements.push(this.db.prepare('INSERT INTO notbgg_accessory_categories(seq,category) VALUES (?,?)').bind(seq, category));
        for (const ref of data.relatedGameIds) {
            const target = ref.source === 'bgg'
                ? 'SELECT id FROM v2_games WHERE bgg_id=?'
                : 'SELECT game_id FROM notbgg_games WHERE seq=? AND archived_at IS NULL';
            const id = ref.source === 'bgg' ? ref.bggId : sequence(ref.notBggId);
            // Missing targets produce NOT NULL/foreign-key failures, never a silently skipped edge.
            statements.push(this.db.prepare(`INSERT INTO site_game_relations(source_game_id,target_game_id,created_by,created_at)
                VALUES ((SELECT game_id FROM notbgg_games WHERE seq=?),(${target}),?,?)`).bind(seq, id, actor, now));
        }
        return statements;
    }
    private revision(seq: number, snapshot: NotBggGame, actor: string): D1PreparedStatement {
        return this.db.prepare(`INSERT INTO notbgg_game_revisions(seq,revision,snapshot_json,actor,created_at)
            VALUES (?,?,json_set(?,'$.gameId',(SELECT game_id FROM notbgg_games WHERE seq=?)),?,?)`)
            .bind(seq, snapshot.revision, JSON.stringify(snapshot), seq, actor, snapshot.updatedAt);
    }
    async create(input: CreateNotBggGameInput, context: NotBggCreateContext): Promise<{ game: NotBggGame; replayed: boolean }> {
        const data = validateCreateNotBggGame(input), actor = actorName(context.actor), key = context.idempotencyKey;
        if (typeof key !== 'string' || !key.trim() || key.length > 200) throw new NotBggRepositoryError('INVALID_ARGUMENT', 'Invalid idempotency key');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
        const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
        // Reservation commits independently, is immutable, and is not an exposed/valid game.
        await this.db.prepare('INSERT INTO notbgg_ids(request_key,request_hash) VALUES (?,?) ON CONFLICT(request_key) DO NOTHING').bind(key, hash).run();
        const reservation = (await this.db.prepare('SELECT seq,request_hash FROM notbgg_ids WHERE request_key=?').bind(key).first<{ seq: number; request_hash: string }>())!;
        if (reservation.request_hash !== hash) throw new NotBggRepositoryError('IDEMPOTENCY_CONFLICT', 'Idempotency key already belongs to different content');
        const seq = reservation.seq, id = formatNotBggId(seq), previous = await this.getByNotBggId(id);
        if (previous) return { game: previous, replayed: true };
        const now = new Date().toISOString();
        const snapshot: NotBggGame = { ...data, gameId: 0, notBggId: id, source: 'notbgg', revision: 1, createdAt: now, updatedAt: now,
            archivedAt: null, linkStatus: 'unlinked', linkedBggId: null, linkedAt: null, primarySource: 'notbgg' };
        try {
            // D1 batch is atomic and non-interleaving. last_insert_rowid is consumed immediately
            // after the v2 insert, before any other insert, and is verified on real local D1.
            await this.db.batch([
                this.db.prepare('INSERT INTO v2_games(primary_name,game_type,catalog_source,created_at,updated_at) VALUES (?,?,\'manual\',?,?)').bind(data.name, v2Type(data.type), now, now),
                this.db.prepare(`INSERT INTO notbgg_games(seq,game_id,${entries.map(([, c]) => c).join(',')},created_at,updated_at)
                    VALUES (?,last_insert_rowid(),${entries.map(() => '?').join(',')},?,?)`).bind(seq, ...dbValues(data), now, now),
                this.revision(seq, snapshot, actor), ...this.children(seq, data, actor, now)
            ]);
        } catch (error) {
            // Another identical concurrent request may have committed the same complete game.
            const winner = await this.getByNotBggId(id);
            if (winner) return { game: winner, replayed: true };
            throw new NotBggRepositoryError('STORAGE', 'Creation rolled back; reservation retained for retry', { cause: error });
        }
        return { game: (await this.getByNotBggId(id))!, replayed: false };
    }

    private async current(id: NotBggId, context: NotBggWriteContext): Promise<NotBggGame> {
        actorName(context.actor);
        if (!isBggId(context.expectedRevision)) throw new NotBggRepositoryError('INVALID_ARGUMENT', 'Expected revision is required');
        const current = await this.getByNotBggId(id);
        if (!current) throw new NotBggRepositoryError('NOT_FOUND', 'Game not found');
        if (current.revision !== context.expectedRevision) throw new NotBggRepositoryError('CONFLICT', 'Revision changed');
        if (current.archivedAt) throw new NotBggRepositoryError('ARCHIVED', 'Archived game cannot be edited');
        return current;
    }
    async update(id: NotBggId, input: UpdateNotBggGameInput, context: NotBggWriteContext): Promise<NotBggGame> {
        const current = await this.current(id, context), data = validateUpdateNotBggGame(input, current);
        return this.write(current, data, actorName(context.actor), false);
    }
    async archive(id: NotBggId, context: NotBggWriteContext): Promise<NotBggGame> {
        const current = await this.current(id, context);
        return this.write(current, current, actorName(context.actor), true);
    }
    private async write(current: NotBggGame, data: NotBggEditableFields, actor: string, archive: boolean): Promise<NotBggGame> {
        const seq = sequence(current.notBggId), now = new Date().toISOString();
        const snapshot: NotBggGame = { ...current, ...data, revision: current.revision + 1, updatedAt: now, archivedAt: archive ? now : null };
        const statements = [this.revision(seq, snapshot, actor)]; // DB-side revision gate must remain first.
        const categoriesChanged = !archive && JSON.stringify([...current.accessoryCategories].sort()) !== JSON.stringify([...data.accessoryCategories].sort());
        const relationsChanged = !archive && JSON.stringify(current.relatedGameIds.map(gameCatalogKey).sort()) !== JSON.stringify(data.relatedGameIds.map(gameCatalogKey).sort());
        if (categoriesChanged) statements.push(this.db.prepare('DELETE FROM notbgg_accessory_categories WHERE seq=?').bind(seq));
        if (relationsChanged) statements.push(this.db.prepare("UPDATE site_game_relations SET archived_at=? WHERE source_game_id=? AND relation_type='accessory_for' AND relation_source='manual' AND archived_at IS NULL").bind(now, current.gameId));
        statements.push(this.db.prepare(`UPDATE notbgg_games SET ${entries.map(([, c]) => `${c}=?`).join(',')},revision=?,updated_at=?,archived_at=? WHERE seq=?`)
            .bind(...dbValues(data), snapshot.revision, now, snapshot.archivedAt, seq),
            this.db.prepare('UPDATE v2_games SET primary_name=?,game_type=?,updated_at=? WHERE id=?').bind(data.name, v2Type(data.type), now, current.gameId));
        if (!archive) statements.push(...this.children(seq, { ...data,
            accessoryCategories: categoriesChanged ? data.accessoryCategories : [], relatedGameIds: relationsChanged ? data.relatedGameIds : [] }, actor, now));
        try { await this.db.batch(statements); }
        catch (error) {
            if (/NOTBGG_REVISION_CONFLICT|NOTBGG_REVOKE_LINK_BEFORE_TYPE_CHANGE/.test(String(error))) throw new NotBggRepositoryError('CONFLICT', 'Revision changed; nothing written', { cause: error });
            throw new NotBggRepositoryError('STORAGE', 'Edit rolled back; nothing written', { cause: error });
        }
        return (await this.getByNotBggId(current.notBggId))!;
    }
}
