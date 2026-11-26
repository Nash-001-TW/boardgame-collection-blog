import { HttpError } from './notbgg-admin-api';
import { publicBggMetadata } from './public-site-data';

type CacheRow = { bgg_id: number; cache_json: string };

// Use the last successful cache even if a later sync failed.
// CASE prevents SQLite from evaluating JSON functions on corrupt cache entries.
const eligibleCache = `last_success_at IS NOT NULL AND cache_json IS NOT NULL
 AND CASE WHEN json_valid(cache_json) THEN
   json_type(cache_json, '$.bggId') = 'integer'
   AND json_extract(cache_json, '$.bggId') = bgg_id
   AND json_type(cache_json, '$.name') = 'text'
   AND trim(json_extract(cache_json, '$.name'), char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)) != ''
   AND json_extract(cache_json, '$.gameType') IN ('boardgame','boardgameexpansion','boardgameaccessory')
 ELSE 0 END`;

function gameFromCache(row: CacheRow) {
    const bgg = publicBggMetadata(JSON.parse(row.cache_json), row.bgg_id);
    return { bggId: row.bgg_id, name: bgg.name, slug: `bgg-${row.bgg_id}`, bgg };
}

async function readCache<T>(query: () => Promise<T>): Promise<T> {
    try {
        return await query();
    } catch (error) {
        throw Object.assign(new HttpError(503, 'DATABASE_UNAVAILABLE'), { cause: error });
    }
}

export async function readSyncedBggGame(db: D1Database, id: number) {
    const row = await readCache(() => db.prepare(`SELECT bgg_id, cache_json FROM bgg_games
        WHERE bgg_id = ? AND ${eligibleCache}`).bind(id).first<CacheRow>());
    return row ? gameFromCache(row) : null;
}

export async function searchSyncedBggGames(db: D1Database, keyword: string) {
    const { results } = await readCache(() => db.prepare(`SELECT bgg_id, cache_json FROM bgg_games
        WHERE CASE WHEN ${eligibleCache} THEN
            ? = 'bgg:' || bgg_id OR ? = '#' || bgg_id
            OR instr(lower(json_extract(cache_json, '$.name')), ?) > 0
        ELSE 0 END
        ORDER BY bgg_id LIMIT 20`).bind(keyword, keyword, keyword).all<CacheRow>());
    return results.map(gameFromCache);
}
