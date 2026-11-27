import {bggGameRelations, checkedRelationRead, effectiveGameRelations, readRelationCaches,
 readStoredGameRelations, relationGameIdentity, type GameRelationEdge, type RelationSource} from './effective-game-relations';
import {publicIdentityIndex} from './identity-resolution';
import type {BggGameData} from './bgg-types';
import {HttpError} from './notbgg-admin-api';
import {collectionRelationTypes, endpoints, gameRelationTypes, isRelationDirectionAllowed} from './relation-admin';

type Row = Record<string, unknown>;
type Game = {id: number; bgg_id: number | null; seq: number | null};
type Collection = {id: number; game_id: number | null; record_scope: string; display_name: string; archived_at: string | null};
type Combination = {id: number; source_item_id: number; target_item_id: number; relation_type: string; archived_at: string | null};
type Manual = GameRelationEdge & {admin_confirmed: number; archived_at: string | null};
type Check = {state: 'linked' | 'addable' | 'blocked' | 'not_applicable' | 'unavailable'; sources: RelationSource[];
 confirmation: 'confirmed' | 'unconfirmed' | null; reason?: string; sourceGame?: number; differentType?: boolean};
export type CrossLayerCheck = Check;
const symmetric = ['standalone_related', 'same_series', 'integrates_with'];
const key = (type: string, source: string | number, target: string | number) =>
 JSON.stringify(symmetric.includes(type) && source > target ? [type,target,source] : [type,source,target]);
const check = (state: Check['state'], reason?: string, sourceGame?: number): Check => ({state,sources:[],confirmation:null,reason,sourceGame});
const collectionType = (type: string) => (collectionRelationTypes as readonly string[]).includes(type);

export async function readCrossLayerCollections(db: D1Database) {
 const [collections, combinations] = await Promise.all([
  checkedRelationRead(db.prepare(`SELECT c.id,c.game_id,c.record_scope,c.display_name,m.archived_at
   FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id`).all<Collection>()),
  checkedRelationRead(db.prepare(`SELECT * FROM v2_collection_relations ORDER BY id`).all<Combination & Row>()),
 ]);
 return {collections,combinations};
}

export async function readCrossLayerRelations(db: D1Database, games: Game[], data: Awaited<ReturnType<typeof readCrossLayerCollections>>) {
 const {collections,combinations} = data;
 const byId = new Map(collections.map(row => [row.id,row]));
 const active = collections.filter(row => !row.archived_at);
 const gamesById = new Map(games.map(game => [game.id,game]));
 const identity = new Map<number,string>();
 const validCaches = new Set<string>();
 const relations = new Map<string,{sources: RelationSource[]; confirmation: Check['confirmation']}>();
 const pairTypes = new Map<string, Set<string>>();
 const suggestionsByGame = new Map<string,{target: string; type: string; priority: number; confirmation: Check['confirmation']}[]>();
 let readFailed = false;
 try {
  const [cacheRows,[manual,site]] = await Promise.all([
   checkedRelationRead(db.prepare(`SELECT bgg_id,cache_json FROM bgg_games WHERE last_success_at IS NOT NULL AND cache_json IS NOT NULL`)
    .all<{bgg_id: number; cache_json: string}>()),
   readStoredGameRelations<Manual>(db,'1',[],false),
  ]);
  const aliases = await publicIdentityIndex(db,[],[...cacheRows.map(row => row.bgg_id),...games.flatMap(game => game.bgg_id ? [game.bgg_id] : [])]);
  for (const game of games) identity.set(game.id,relationGameIdentity(game,aliases));
  const caches = new Map<number,BggGameData>();
  for (const row of cacheRows) {
   const id = 'bgg:' + row.bgg_id;
   try {
    const cache = readRelationCaches([row],new Map(),[]).get(row.bgg_id)!;
    if (typeof cache.gameType !== 'string' || (['expansions','compilations','implementations'] as const).some(kind => {
     const links = cache[kind];
     return links != null && (!Array.isArray(links) || links.some(link => !link || typeof link !== 'object'));
    })) throw new Error('Invalid relation cache');
    caches.set(row.bgg_id,cache);
    validCaches.add(id);
   } catch {
    // Leave this identity out of validCaches so only its checks become unavailable.
    continue;
   }
  }
  const effective = effectiveGameRelations(bggGameRelations(caches,[]),manual.filter(row => !row.archived_at),site,games,aliases);
  for (const row of effective) {
   const stored = row.manual ?? row.site;
   const link = row.bgg;
   if (!stored && (link?.kind !== 'expansions' || link.role === 'unconfirmed')) continue;
   const source = stored ? identity.get(stored.source_game_id) : 'bgg:' + link!.sourceBggId;
   const target = stored ? identity.get(stored.target_game_id) : 'bgg:' + link!.targetBggId;
   if (!source || !target) continue;
   const type = stored?.relation_type ?? 'expansion_of';
   const confirmation = row.manual ? (row.manual.admin_confirmed ? 'confirmed' : 'unconfirmed') : null;
   const edgeKey = key(type,source,target);
   const match = relations.get(edgeKey);
   relations.set(edgeKey,{sources:[...new Set([...(match?.sources ?? []),...row.sources])],
    confirmation: match?.confirmation === 'confirmed' ? 'confirmed' : confirmation ?? match?.confirmation ?? null});
   const pair = JSON.stringify([source,target].sort());
   const types = pairTypes.get(pair) ?? new Set<string>();
   types.add(type);
   pairTypes.set(pair,types);
   if (!collectionType(type) || type === 'other' || (!link && !row.manual)) continue;
   const priority = link ? 0 : confirmation === 'confirmed' ? 1 : 2;
   for (const [from,to] of symmetric.includes(type) ? [[source,target],[target,source]] : [[source,target]]) {
    const entries = suggestionsByGame.get(from) ?? [];
    entries.push({target:to,type,priority,confirmation});
    suggestionsByGame.set(from,entries);
   }
  }
 } catch {
  readFailed = true;
 }

 async function assess(sourceId: number, targetId: number, type: string): Promise<Check> {
  if (type === 'bundle_contains') return check('not_applicable');
  const sourceGame = byId.get(sourceId)?.game_id ?? undefined;
  const targetGame = byId.get(targetId)?.game_id ?? undefined;
  if (!sourceGame || !targetGame || !gamesById.has(sourceGame) || !gamesById.has(targetGame)) return check('blocked','missing_game');
  if (readFailed) return check('unavailable','read_failed',sourceGame);
  const source = identity.get(sourceGame)!;
  const target = identity.get(targetGame)!;
  if ([source,target].some(id => id.startsWith('bgg:') && !validCaches.has(id))) return check('unavailable','cache_unavailable',sourceGame);
  const types = pairTypes.get(JSON.stringify([source,target].sort()));
  const differentType = Boolean(types && [...types].some(value => value !== type));
  const linked = relations.get(key(type,source,target));
  if (linked) return {...check('linked',undefined,sourceGame),...linked,differentType};
  if (source === target) return check('blocked','same_game',sourceGame);
  if (!(gameRelationTypes as readonly string[]).includes(type)) return check('blocked','direction',sourceGame);
  try {
   const pair = await endpoints(db,'game',sourceGame,targetGame);
   const alias = await checkedRelationRead(db.prepare(`SELECT 1 FROM notbgg_bgg_links WHERE status='linked'
    AND ((seq=? AND candidate_bgg_id=?) OR (seq=? AND candidate_bgg_id=?))`)
    .bind(pair.a.seq??-1,pair.b.bgg_id??-1,pair.b.seq??-1,pair.a.bgg_id??-1).all());
   if (alias.length) return check('blocked','same_game',sourceGame);
   if (!isRelationDirectionAllowed(type,pair.sourceType,pair.targetType)) return check('blocked','direction',sourceGame);
   // Mirrors migration 0022's insert trigger, including the shared expansion family.
   if (['requires_base','expansion_of','accessory_for','compilation_of'].includes(type)) {
    const cycle = await checkedRelationRead(db.prepare(`WITH RECURSIVE reach(id) AS (
     SELECT ? UNION SELECT r.target_game_id FROM v2_game_relations r JOIN reach x ON r.source_game_id=x.id
     WHERE r.archived_at IS NULL AND ((? IN('requires_base','expansion_of') AND r.relation_type IN('requires_base','expansion_of')) OR r.relation_type=?)
    ) SELECT 1 FROM reach WHERE id=?`).bind(targetGame,type,type,sourceGame).all());
    if (cycle.length) return check('blocked','cycle',sourceGame);
   }
   return {...check('addable',undefined,sourceGame),differentType};
  } catch (error) {
   return error instanceof HttpError && error.status === 400 ? check('blocked','missing_game',sourceGame) : check('unavailable','read_failed',sourceGame);
  }
 }

 const activeCombinations = new Set(combinations.filter(row => !row.archived_at)
  .map(row => key(row.relation_type,row.source_item_id,row.target_item_id)));
 const byGame = new Map<string,Collection[]>();
 for (const row of active) {
  const id = identity.get(row.game_id ?? 0);
  if (!id) continue;
  const group = byGame.get(id) ?? [];
  group.push(row);
  byGame.set(id,group);
 }

 function suggestions(): Record<number, CrossLayerSuggestion[]> | null {
  if (readFailed) return null;
  const result: Record<number, CrossLayerSuggestion[]> = {};
  let count = 0;
  for (const from of active) {
   const entries = suggestionsByGame.get(identity.get(from.game_id ?? 0) ?? '') ?? [];
   const seen = new Set<string>();
   for (const entry of [...entries].sort((a,b) => a.priority-b.priority)) for (const to of byGame.get(entry.target) ?? []) {
    if (to.id === from.id || from.record_scope !== to.record_scope) continue;
    const id = key(entry.type,from.id,to.id);
    if (activeCombinations.has(id) || seen.has(id)) continue;
    if (++count > 1000) return null;
    seen.add(id);
    (result[from.id] ??= []).push({target:to.id,name:to.display_name,type:entry.type,confirmation:entry.confirmation});
   }
  }
  return result;
 }

 async function reverse(row: Row) {
  const type = row.relation_type === 'expansions' && row.direction_confirmed ? 'expansion_of' : String(row.relation_type);
  if (row.archived_at || !collectionType(type) || type === 'bundle_contains') return null;
  const owned = (id: unknown, bgg: unknown) => {
   const canonical = identity.get(Number(id)) ?? (bgg ? 'bgg:' + String(bgg) : undefined);
   return canonical ? byGame.get(canonical) ?? [] : active.filter(item => item.game_id === id);
  };
  const sources = owned(row.source_game_id,row.source_bgg_id), targets = owned(row.target_game_id,row.target_bgg_id);
  if (!sources.length && !targets.length) return null;
  if (!sources.length || !targets.length) return {missing: !sources.length ? 'source' : 'target',pairs: []};
  const pairs = [];
  for (const from of sources) for (const to of targets) {
   if (from.record_scope !== to.record_scope) continue;
   const existing = activeCombinations.has(key(type,from.id,to.id));
   let reason: string | undefined;
   if (!existing) {
    try {
     const pair = await endpoints(db,'collection',from.id,to.id);
     if (from.id === to.id || !isRelationDirectionAllowed(type,pair.sourceType,pair.targetType)) reason = 'direction';
    } catch (error) {
     reason = error instanceof HttpError && error.status === 400 ? 'direction' : 'read_failed';
    }
   }
   pairs.push({from,to,type,existing,reason});
  }
  return {pairs,missing: null,reason:pairs.length ? undefined : 'scope'};
 }
 return {assess,suggestions,reverse};
}

export interface CrossLayerSuggestion {target: number; name: string; type: string; confirmation: Check['confirmation']}

export async function collectionRelationPage(data: Awaited<ReturnType<typeof readCrossLayerCollections>>,
 cross: Awaited<ReturnType<typeof readCrossLayerRelations>>, filter: number, state: string, after: number) {
 const production = new Set(data.collections.filter(row => !row.archived_at && row.record_scope === 'production').map(row => row.id));
 const checks = new Map<number,Check>();
 const counts = {all:0,linked:0,addable:0,blocked:0};
 const rows = [];
 for (let i = 0; i < data.combinations.length; i += 20) {
  // Limit concurrent D1 reads while assessing all rows before filtering and pagination.
  const batch = data.combinations.slice(i,i+20);
  const assessed = await Promise.all(batch.map(row => cross.assess(row.source_item_id,row.target_item_id,row.relation_type)));
  for (const [index,row] of batch.entries()) {
   const result = assessed[index];
   if (!row.archived_at && production.has(row.source_item_id) && production.has(row.target_item_id)) {
    counts.all++;
    if (result.state === 'linked' || result.state === 'addable' || result.state === 'blocked') counts[result.state]++;
   }
   if (row.id <= after || filter && row.source_item_id !== filter && row.target_item_id !== filter || state !== 'all' && result.state !== state) continue;
   rows.push(row);
   checks.set(row.id,result);
  }
 }
 return {rows:rows.slice(0,20),checks,counts,nextCursor:rows.length > 20 ? rows[19].id : null};
}
