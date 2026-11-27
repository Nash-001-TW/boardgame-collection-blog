import {formatNotBggId} from './game-identity';
import type {IdentityIndex} from './identity-resolution';
import {resolveRelationDirection,type RelationEvidence} from './relation-direction';
import type {BggGameData} from './bgg-types';
import {HttpError} from './notbgg-admin-api';

const kinds = ['expansions', 'implementations', 'compilations'] as const;
type Kind = typeof kinds[number];
export type RelationSource = 'bgg' | 'manual' | 'notbgg';
export interface GameRelationEdge {
 source_game_id: number;
 target_game_id: number;
 relation_type: string;
}
interface GameIdentityRow {
 id: number;
 bgg_id: number | null;
 seq: number | null;
}
interface CacheRow {bgg_id: number; cache_json: string}
interface TypeRow {bgg_id: number; game_type: string}
export async function checkedRelationRead<T>(read: Promise<D1Result<T>>, limit = Infinity) {
 const result = await read;
 if (!result.success || !Array.isArray(result.results)) throw new HttpError(503, 'RELATIONS_UNAVAILABLE');
 if (result.results.length > limit) throw new HttpError(503, 'RELATIONS_UNAVAILABLE');
 return result.results;
}

export function readRelationCaches(rows: CacheRow[], baseline: Map<number, BggGameData>, types: TypeRow[]) {
 const caches = new Map(baseline);
 const loaded = new Set(rows.map(row => row.bgg_id));
 for (const row of types) if (!loaded.has(row.bgg_id)) caches.delete(row.bgg_id);
 for (const row of rows) {
  let cache: BggGameData;
  try { cache = JSON.parse(row.cache_json); }
  catch { throw new HttpError(503, 'RELATIONS_UNAVAILABLE'); }
  if (cache?.bggId !== row.bgg_id) throw new HttpError(503, 'RELATIONS_UNAVAILABLE');
  caches.set(row.bgg_id, cache);
 }
 return caches;
}

export function readStoredGameRelations<M extends GameRelationEdge>(
 db: D1Database, where: string, args: number[], publicOnly: boolean,
) {
 return Promise.all([
  checkedRelationRead(db.prepare(`SELECT ${publicOnly ? 'source_game_id,target_game_id,relation_type,relation_source' : '*'} FROM v2_game_relations WHERE
   ${publicOnly ? "archived_at IS NULL AND (relation_source='bgg' OR (relation_source='manual' AND admin_confirmed=1))" : "relation_source='manual'"}
   AND (${where})${publicOnly ? ' LIMIT 1001' : ''}`).bind(...args).all<M>(), publicOnly ? 1000 : Infinity),
  checkedRelationRead(db.prepare(`SELECT source_game_id,target_game_id,relation_type FROM site_game_relations
   WHERE archived_at IS NULL AND (${where})${publicOnly ? ' LIMIT 1001' : ''}`).bind(...args).all<GameRelationEdge>(), publicOnly ? 1000 : Infinity),
 ]);
}

export function readBggRelationCaches(db: D1Database, publicScope?: {ids: number[]; root: number}) {
 const scope = publicScope ? `AND bgg_id IN(SELECT value FROM json_each(?))` : '';
 const filter = publicScope ? `AND (bgg_id=? OR ${kinds.map(kind =>
  `EXISTS(SELECT 1 FROM json_each(cache_json,'$.${kind}') WHERE json_extract(value,'$.id')=?)`).join(' OR ')}) LIMIT 1001` : '';
 const args = publicScope ? [JSON.stringify(publicScope.ids)] : [];
 const base = `FROM bgg_games WHERE last_success_at IS NOT NULL AND cache_json IS NOT NULL ${scope}`;
 return Promise.all([
  checkedRelationRead(db.prepare(`SELECT bgg_id,cache_json ${base} ${filter}`)
   .bind(...args,...(publicScope ? Array<number>(4).fill(publicScope.root) : [])).all<CacheRow>(), publicScope ? 1000 : Infinity),
  checkedRelationRead(db.prepare(`SELECT bgg_id,json_extract(cache_json,'$.gameType') game_type ${base}`)
   .bind(...args).all<TypeRow>()),
 ]);
}

export function bggGameRelations(caches: Map<number, BggGameData>, typeRows: TypeRow[], root?: number) {
 const types = new Map<number, string>([...caches].map(([id, game]) => [id, game.gameType]));
 for (const row of typeRows) types.set(row.bgg_id, row.game_type);
 const grouped = new Map<string, {
  first: number; second: number; kind: Kind; sourceName: string; targetName: string; evidence: RelationEvidence[];
 }>();
 for (const [origin, game] of caches) for (const kind of kinds) for (const link of game[kind] ?? []) {
  if (!Number.isSafeInteger(link.id) || link.id < 1 || link.id === origin) continue;
  if (root !== undefined && root !== origin && root !== link.id) continue;
  const first = root ?? Math.min(origin, link.id), second = first === origin ? link.id : origin;
  const key = `${first}:${second}:${kind}`;
  const group = grouped.get(key) ?? {
   first, second, kind, sourceName: first === origin ? game.name : link.name,
   targetName: first === origin ? link.name : game.name, evidence: [],
  };
  group.evidence.push({
   sourceGameId: origin, targetGameId: link.id, relationType: kind, rawInbound: link.inbound,
   inboundPresence: typeof link.inbound === 'boolean' ? 'present' : 'missing',
   origin: first === origin ? 'direct' : 'reverse', sourceGameType: game.gameType,
   targetGameType: types.get(link.id), evidenceSource: 'local-cache', rawNames: [link.name],
  });
  grouped.set(key,group);
 }
 return [...grouped.values()].map(group => {
  const {first, second, kind, evidence} = group;
  const role = resolveRelationDirection(first, second, kind, evidence, types).semanticRole;
  const reverse = role === 'expansion' || (root === undefined && role === 'unknown' && evidence[0].sourceGameId !== first);
  return {
   kind, role: role === 'unknown' ? 'unconfirmed' as const : role, relatedBggId: second,
   relatedName: caches.get(second)?.name ?? group.targetName,
   sourceBggId: reverse ? second : first, targetBggId: reverse ? first : second,
   sourceName: reverse ? group.targetName : group.sourceName,
   targetName: reverse ? group.sourceName : group.targetName,
  };
 });
}

export function relationGameIdentity(game: GameIdentityRow, aliases: IdentityIndex) {
 const notBgg = game.seq ? formatNotBggId(game.seq) : null;
 const bggId = game.bgg_id ?? (notBgg ? aliases.byNotBgg.get(notBgg)?.bggId : undefined);
 return bggId ? `bgg:${bggId}` : notBgg ?? `game:${game.id}`;
}

export function effectiveGameRelations<M extends GameRelationEdge>(
 bgg: ReturnType<typeof bggGameRelations>, manual: M[], site: GameRelationEdge[],
 games: GameIdentityRow[], aliases: IdentityIndex,
 archived: (row: M) => boolean = () => false,
) {
 const identities = new Map(games.map(game => [game.id, relationGameIdentity(game, aliases)]));
 type Row = {
  sources: RelationSource[];
  bgg?: (typeof bgg)[number];
  manual?: M;
  site?: GameRelationEdge;
 };
 const rows: Row[] = [];
 const indexed = new Map<string, Row>();
 const storedKey = (edge: GameRelationEdge) => {
  const source = identities.get(edge.source_game_id), target = identities.get(edge.target_game_id);
  if (!source || !target) return undefined;
  return `${edge.relation_type}:${source}:${target}`;
 };
 for (const link of bgg) {
  const row: Row = {sources: ['bgg'], bgg: link};
  rows.push(row);
  if (link.kind === 'expansions' && link.role !== 'unconfirmed') {
   indexed.set(`expansion_of:bgg:${link.sourceBggId}:bgg:${link.targetBggId}`, row);
  }
 }
 for (const edge of manual) {
  const key = storedKey(edge);
  const match = key && !archived(edge) ? indexed.get(key) : undefined;
  if (match && !match.manual) {
   match.manual = edge;
   match.sources.push('manual');
  } else {
   const row: Row = {sources: ['manual'], manual: edge};
   rows.push(row);
   if (key && edge.relation_type === 'accessory_for' && !archived(edge) && !indexed.has(key)) indexed.set(key,row);
  }
 }
 for (const edge of site) {
  const key = storedKey(edge);
  const match = key && edge.relation_type === 'accessory_for' ? indexed.get(key) : undefined;
  if (match && !match.site) {
   match.site = edge;
   match.sources.push('notbgg');
  } else rows.push({sources: ['notbgg'], site: edge});
 }
 return rows;
}

