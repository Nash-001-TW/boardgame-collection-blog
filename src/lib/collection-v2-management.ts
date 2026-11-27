import { getGames } from './games';
import { getCatalogGameType } from './game-content';
import { parseGameRef,gameCatalogKey } from './game-identity';
import type { GameRef } from './game-identity';
import { adminOwnedSql } from './admin-dashboard-summary';
import { publicMetadataRegistry, publicStaticMetadataSql, publicBggMetadataSql, publicBggPresentationSql, publicNotBggPresentationSql } from './public-site-data';
import { safeImage } from './notbgg-public';
import { readSyncedBggGame, searchSyncedBggGames } from './bgg-d1-catalog';
export class CollectionWriteError extends Error { constructor(public code:string){super(code);} }
export type CollectionScope='production'|'test';
export const collectionStatuses=['owned','preordered','wishlist','not_owned','sold','gifted_away','unknown'] as const;
export interface CollectionInput {
 displayName:string; acquisitionStatus:typeof collectionStatuses[number]; wishlist:boolean;
 personalRating:number|null; playCount:number|null; comment:string|null; storageNotes:string|null; accessoryNotes:string|null; sleeveNotes:string|null;
 language:string|null; edition:string|null; purchaseDate:string|null; priceMinor:number|null; currency:string; merchant:string|null;
}
const text=(v:unknown,max=300):string|null=>{if(v===null||v===undefined||v==='')return null;if(typeof v!=='string'||v.length>max)throw new CollectionWriteError('VALIDATION');return v.trim()||null;};
function number(v:unknown,max:number,integer=true):number|null{if(v===null||v===undefined)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max||(integer&&!Number.isInteger(v)))throw new CollectionWriteError('VALIDATION');return v;}
const fields=['displayName','acquisitionStatus','wishlist','personalRating','playCount','comment','storageNotes','accessoryNotes','sleeveNotes','language','edition','purchaseDate','priceMinor','currency','merchant'];
export function validateCollectionInput(input:unknown):CollectionInput {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k)))throw new CollectionWriteError('VALIDATION');
 const d=input as Record<string,unknown>,displayName=text(d.displayName),status=d.acquisitionStatus??'unknown';
 if(!displayName||!collectionStatuses.includes(status as never)||(d.wishlist!==undefined&&typeof d.wishlist!=='boolean'))throw new CollectionWriteError('VALIDATION');
 const date=text(d.purchaseDate),currency=d.currency??'TWD';
 if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(new Date(date).getTime())||new Date(date).toISOString().slice(0,10)!==date))throw new CollectionWriteError('VALIDATION');
 if(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))throw new CollectionWriteError('VALIDATION');
 return {displayName,acquisitionStatus:status as CollectionInput['acquisitionStatus'],wishlist:d.wishlist===true,
  personalRating:number(d.personalRating,10,false),playCount:number(d.playCount,1e7),comment:text(d.comment,10000),storageNotes:text(d.storageNotes,3000),accessoryNotes:text(d.accessoryNotes,3000),sleeveNotes:text(d.sleeveNotes,3000),
  language:text(d.language,40),edition:text(d.edition),purchaseDate:date,priceMinor:number(d.priceMinor,1e12),currency,merchant:text(d.merchant)};
}

/** The partial API owns only these columns; each SQL fragment is a fixed literal. */
function collectionPatchFields(input: unknown) {
 if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) {
  throw new CollectionWriteError('VALIDATION');
 }
 const entries = Object.entries(input);
 if (!entries.length) throw new CollectionWriteError('VALIDATION');
 const assignments: string[] = [];
 const values: (string | number | null)[] = [];
 for (const [field, value] of entries) {
  switch (field) {
   case 'displayName': {
    const name = text(value);
    if (!name) throw new CollectionWriteError('VALIDATION');
    assignments.push('display_name=?'); values.push(name);
    break;
   }
   case 'acquisitionStatus':
    if (!collectionStatuses.some(status => status === value)) throw new CollectionWriteError('VALIDATION');
    assignments.push('acquisition_status=?'); values.push(value as CollectionInput['acquisitionStatus']);
    break;
   case 'wishlist':
    if (value !== true && value !== false && value !== 0 && value !== 1) throw new CollectionWriteError('VALIDATION');
    assignments.push('wishlist=?'); values.push(Number(value));
    break;
   case 'notes': {
    if (value !== null && (typeof value !== 'string' || value.includes('\0'))) throw new CollectionWriteError('VALIDATION');
    let parsed: unknown;
    if (typeof value === 'string') {
     try { parsed = JSON.parse(value); } catch { /* Legacy plain text is supported. */ }
    }
    if (parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'd5_create_token')) {
     throw new CollectionWriteError('VALIDATION');
    }
    assignments.push('notes=?'); values.push(value);
    break;
   }
   default: throw new CollectionWriteError('UNKNOWN_FIELD');
  }
 }
 return {assignments, values};
}
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),n=>n.toString(16).padStart(2,'0')).join('');
const scopeCheck=(s:string):CollectionScope=>{if(s!=='production'&&s!=='test')throw new CollectionWriteError('VALIDATION');return s;};
const positive=(n:number)=>{if(!Number.isSafeInteger(n)||n<1)throw new CollectionWriteError('VALIDATION');return n;};
const personal=(d:CollectionInput)=>({personal_rating:d.personalRating,play_count:d.playCount,personal_comment:d.comment,storage_notes:d.storageNotes,accessory_notes:d.accessoryNotes,sleeve_notes:d.sleeveNotes,purchase_source_hint:d.merchant,purchase_date_hint:d.purchaseDate,purchase_currency_hint:d.currency});
type AdminRow=Record<string,unknown>&{id:number;notes:string|null;revision:number;game_id:number|null;archived_at:string|null;managed_copy_id:number|null;managed_order_id:number|null;notbgg_seq:number|null;source_archived:string|null};
interface CollectionListItem {
 id: number;
 display_name: string;
 item_type: string;
 acquisition_status: string;
 archived_at: string | null;
 wishlist?: number;
}

interface CollectionListIdentity {
 game_name: string;
 source: 'bgg' | 'notbgg' | 'missing';
 source_id: string | null;
 source_archived: string | null;
 link_status: 'pending' | 'linked' | null;
 linked_source_id: string | null;
 primary_source: 'bgg' | 'notbgg' | null;
}

interface CollectionListGroup extends CollectionListIdentity {
 key: string;
 items: CollectionListItem[];
}

export interface CollectionListPage {
 groups: CollectionListGroup[];
 nextCursor: number | null;
}

interface CollectionListOptions {
 view: string;
 query: string;
 source: string | null;
 status: string | null;
 archive: string | null;
 wishlist?: string | null;
 after: number;
 limit: number;
}


interface NumberedCollectionItem extends CollectionListItem {
 image: string | null;
 min_players: number | null;
 max_players: number | null;
 owned: number;
 copies: number;
 updated_at: string;
}
interface NumberedCollectionGroup extends CollectionListIdentity {
 key: string;
 items: NumberedCollectionItem[];
}
export interface NumberedCollectionList {
 counts: Record<'all' | 'owned' | 'wishlist' | 'preordered', number> | null;
 list: {groups: NumberedCollectionGroup[]; total: number; page: number; limit: number} | null;
}
async function readCollectionSection<T>(section: string, read: () => Promise<T>): Promise<T | null> {
 let timer: ReturnType<typeof setTimeout> | undefined;
 try {
  const deadline = new Promise<never>((_, reject) => {
   timer = setTimeout(() => reject(new DOMException('Collection read timed out', 'TimeoutError')), 8000);
  });
  return await Promise.race([read(), deadline]);
 } catch (error) {
  console.error('Admin collection section unavailable', section, error instanceof Error ? error.name : 'Unknown error');
  return null;
 } finally {
  clearTimeout(timer);
 }
}

/** Extends the existing V2 tables, never a parallel collection identity or storage backend. */
export interface CollectionHeader {
 display_name: string;
 game_name: string;
 source_id: string | null;
 item_type: string;
 acquisition_status: string;
 owned: number;
 wishlist: number;
 archived_at: string | null;
 copies: number;
 image: string | null;
 /** Rendered on the server so the header's "History N" button appears without a client round trip. */
 relink_count: number;
 relink_revision: number | null;
}

/** A missing row and an unavailable header have different HTTP and UI outcomes. */
export async function readCollectionHeader(db: D1Database, id: number, scope: CollectionScope) {
 positive(id);
 scopeCheck(scope);
 const result = await readCollectionSection('header', async () => {
  const row = await db.prepare(`WITH ${publicStaticMetadataSql},
   bgg AS (
    SELECT ${publicBggMetadataSql} AS meta
    FROM v2_collection_items ci JOIN v2_games g ON g.id=ci.game_id
    LEFT JOIN static s ON s.id=g.bgg_id LEFT JOIN bgg_games b ON b.bgg_id=g.bgg_id
    WHERE ci.id=? AND ci.record_scope=? AND g.bgg_id IS NOT NULL
   )
   SELECT c.display_name, COALESCE(n.name,g.primary_name,c.display_name) AS game_name,
    CASE WHEN n.seq IS NOT NULL THEN printf('NotBGG:%06d',n.seq)
         WHEN g.bgg_id IS NOT NULL THEN 'BGG:' || g.bgg_id END AS source_id,
    c.item_type,c.acquisition_status,c.wishlist,m.archived_at,c.owned,
    (SELECT COUNT(*) FROM v2_owned_copies copy WHERE copy.collection_item_id=c.id
       AND copy.inventory_status IN ('in_collection','loaned')) AS copies,
    (SELECT COUNT(*) FROM v2_collection_game_changes gc WHERE gc.collection_item_id=c.id) AS relink_count,
    (SELECT MAX(gc.revision) FROM v2_collection_game_changes gc WHERE gc.collection_item_id=c.id) AS relink_revision,
    CASE WHEN n.seq IS NOT NULL THEN ${publicNotBggPresentationSql.image}
         ELSE ${publicBggPresentationSql.image} END AS image
   FROM (SELECT *, ${adminOwnedSql} AS owned FROM v2_collection_items WHERE id=? AND record_scope=?) c
   LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id
   LEFT JOIN v2_games g ON g.id=c.game_id
   LEFT JOIN notbgg_games n ON n.game_id=g.id
   LEFT JOIN bgg b ON n.seq IS NULL`)
   .bind(publicMetadataRegistry,id,scope,id,scope).first<CollectionHeader>();
  return {row: row && {...row, image: safeImage(row.image)}};
 });
 return result?.row;
}

export class CollectionV2Writer {
 constructor(private db:D1Database){}
 async list(scope:CollectionScope,after=0,limit=20){scopeCheck(scope);if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>100)throw new CollectionWriteError('VALIDATION');return (await this.db.prepare(`SELECT c.id,c.display_name,c.item_type,c.acquisition_status,c.record_scope,m.archived_at,COALESCE(m.revision,0) revision,n.seq notbgg_seq,n.archived_at source_archived FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id LEFT JOIN notbgg_games n ON n.game_id=c.game_id WHERE c.record_scope=? AND c.id>? ORDER BY c.id LIMIT ?`).bind(scope,after,limit).all()).results;}
 async listPage(scope: CollectionScope, options: CollectionListOptions): Promise<CollectionListPage> {
  scopeCheck(scope);
  const {view, query, source, status, archive, after, limit, wishlist = null} = options;
  if (!['grouped', 'records'].includes(view) || query.length > 200
      || (source !== null && !['bgg', 'notbgg', 'missing'].includes(source))
      || (status !== null && !collectionStatuses.some(value => value === status))
      || (archive !== null && !['active', 'archived'].includes(archive))
      || (wishlist !== null && wishlist !== '0' && wishlist !== '1')
      || !Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
   throw new CollectionWriteError('VALIDATION');
  }
  const keyword = query.trim().toLowerCase();
  // Each group owns a disjoint set of collection IDs, so its minimum ID is a unique cursor.
  const {results} = await this.db.prepare(`
   WITH identified AS (
    SELECT c.id, c.display_name, c.item_type, c.acquisition_status, c.wishlist, m.archived_at,
           COALESCE(n.name, g.primary_name, c.display_name) AS game_name,
           CASE WHEN n.seq IS NOT NULL THEN 'notbgg'
                WHEN g.bgg_id IS NOT NULL THEN 'bgg' ELSE 'missing' END AS source,
           CASE WHEN n.seq IS NOT NULL THEN printf('NotBGG:%06d', n.seq)
                WHEN g.bgg_id IS NOT NULL THEN 'BGG:' || g.bgg_id END AS source_id,
           n.archived_at AS source_archived, l.status AS link_status,
           CASE WHEN n.seq IS NOT NULL AND l.id IS NOT NULL THEN 'BGG:' || l.candidate_bgg_id
                WHEN l.status = 'linked' THEN printf('NotBGG:%06d', l.seq) END AS linked_source_id,
           CASE WHEN l.status = 'linked' THEN l.primary_source END AS primary_source,
           CASE WHEN ? = 'grouped' AND c.game_id IS NOT NULL THEN 'game:' || c.game_id
                ELSE 'collection:' || c.id END AS group_key
    FROM v2_collection_items c
    LEFT JOIN v2_collection_management m ON m.collection_item_id = c.id
    LEFT JOIN v2_games g ON g.id = c.game_id
    LEFT JOIN notbgg_games n ON n.game_id = g.id
    LEFT JOIN notbgg_bgg_links l
      ON (n.seq IS NOT NULL AND l.seq = n.seq AND l.status IN ('pending', 'linked'))
      OR (n.seq IS NULL AND g.bgg_id IS NOT NULL AND l.candidate_bgg_id = g.bgg_id
          AND l.bgg_game_id = g.id AND l.status = 'linked')
    WHERE c.record_scope = ?
   ), filtered AS (
    SELECT * FROM identified
    WHERE source = COALESCE(?, source)
      AND acquisition_status = COALESCE(?, acquisition_status)
      AND wishlist = COALESCE(?, wishlist)
      AND COALESCE(?, CASE WHEN archived_at IS NULL THEN 'active' ELSE 'archived' END)
          = CASE WHEN archived_at IS NULL THEN 'active' ELSE 'archived' END
      AND (instr(lower(display_name), ?) > 0 OR instr(lower(game_name), ?) > 0
           OR lower(source_id) = ? OR CAST(id AS TEXT) = ? OR 'collection:' || id = ?)
   ), candidates AS (
    SELECT group_key, MIN(id) AS cursor FROM filtered
    GROUP BY group_key HAVING MIN(id) > ?
    ORDER BY cursor LIMIT ?
   ), page AS (
    SELECT group_key, cursor FROM candidates ORDER BY cursor LIMIT ?
   )
   SELECT f.*, p.cursor, (SELECT COUNT(*) FROM candidates) > ? AS has_next
   FROM page p JOIN filtered f ON f.group_key = p.group_key
   ORDER BY p.cursor, f.id
  `).bind(view, scope, source, status, wishlist === null ? null : Number(wishlist), archive, keyword, keyword, keyword, keyword, keyword,
   after, limit + 1, limit, limit).all<CollectionListItem & CollectionListIdentity & {
    group_key: string; cursor: number; has_next: number;
   }>();
  const groups = new Map<string, CollectionListGroup>();
  for (const row of results) {
   const {group_key, cursor, has_next, id, display_name, item_type, acquisition_status, wishlist, archived_at, ...identity} = row;
   let group = groups.get(group_key);
   if (!group) {
    group = {key: group_key, ...identity, items: []};
    groups.set(group_key, group);
   }
   group.items.push({id, display_name, item_type, acquisition_status, wishlist, archived_at});
  }
  const last = results.at(-1);
  return {groups: [...groups.values()], nextCursor: last?.has_next ? last.cursor : null};
 }

 async listNumbered(scope: CollectionScope, options: Omit<CollectionListOptions, 'after'> & {
  page: number; sort: string; tab: string; players: number | null;
 }): Promise<NumberedCollectionList> {
  scopeCheck(scope);
  const {view, query, source, status, archive, wishlist = null, page, limit, sort, tab, players} = options;
  const sorts = ['updated', 'name', 'id', 'copies'];
  const sortIndex = sorts.indexOf(sort);
  const tabIndex = ['all', 'owned', 'wishlist', 'preordered'].indexOf(tab);
  if (!Number.isSafeInteger(page) || page < 1 || ![20, 50, 100].includes(limit)
      || sortIndex < 0 || tabIndex < 0 || !['records', 'grouped'].includes(view) || query.length > 200
      || (source !== null && !['bgg', 'notbgg', 'missing'].includes(source))
      || (status !== null && !collectionStatuses.some(value => value === status))
      || (archive !== null && !['active', 'archived'].includes(archive))
      || (wishlist !== null && wishlist !== '0' && wishlist !== '1')
      || (players !== null && (!Number.isInteger(players) || players < 1 || players > 20))) {
   throw new CollectionWriteError('VALIDATION');
  }
  const tabs = ['1', 'owned = 1', 'wishlist = 1', "acquisition_status = 'preordered'"];
  const ordering = ['updated_at DESC, id', 'name COLLATE NOCASE, id', 'id', 'copies DESC, id'][sortIndex];
  const keyword = query.trim().toLowerCase();
  const presentation = (field: keyof typeof publicBggPresentationSql) =>
   `CASE WHEN n.seq IS NOT NULL THEN ${publicNotBggPresentationSql[field]} ELSE ${publicBggPresentationSql[field]} END`;
  const sql = `WITH ${publicStaticMetadataSql},
   bgg AS MATERIALIZED (
    SELECT g.bgg_id id, ${publicBggMetadataSql} meta
    FROM (SELECT DISTINCT bgg_id FROM v2_games WHERE bgg_id IS NOT NULL) g
    LEFT JOIN static s ON s.id=g.bgg_id LEFT JOIN bgg_games b ON b.bgg_id=g.bgg_id
   ), identified AS (
    SELECT c.id, c.display_name, c.item_type, c.acquisition_status, c.wishlist, m.archived_at, c.updated_at, c.owned AS owned,
           ${presentation("image")} AS image, ${presentation("minPlayers")} AS min_players,
           ${presentation("maxPlayers")} AS max_players,
           (SELECT COUNT(*) FROM v2_owned_copies copy WHERE copy.collection_item_id=c.id
              AND copy.inventory_status IN ('in_collection','loaned')) AS copies,
           COALESCE(n.name, g.primary_name, c.display_name) AS game_name,
           CASE WHEN n.seq IS NOT NULL THEN 'notbgg'
                WHEN g.bgg_id IS NOT NULL THEN 'bgg' ELSE 'missing' END AS source,
           CASE WHEN n.seq IS NOT NULL THEN printf('NotBGG:%06d', n.seq)
                WHEN g.bgg_id IS NOT NULL THEN 'BGG:' || g.bgg_id END AS source_id,
           n.archived_at AS source_archived, l.status AS link_status,
           CASE WHEN n.seq IS NOT NULL AND l.id IS NOT NULL THEN 'BGG:' || l.candidate_bgg_id
                WHEN l.status = 'linked' THEN printf('NotBGG:%06d', l.seq) END AS linked_source_id,
           CASE WHEN l.status = 'linked' THEN l.primary_source END AS primary_source,
           CASE WHEN ? = 'grouped' AND c.game_id IS NOT NULL THEN 'game:' || c.game_id
                ELSE 'collection:' || c.id END AS group_key
    FROM (SELECT *, ${adminOwnedSql} AS owned FROM v2_collection_items WHERE record_scope = ?) c
    LEFT JOIN v2_collection_management m ON m.collection_item_id = c.id
    LEFT JOIN v2_games g ON g.id = c.game_id
    LEFT JOIN notbgg_games n ON n.game_id = g.id
    LEFT JOIN bgg b ON b.id=g.bgg_id AND n.seq IS NULL
    LEFT JOIN notbgg_bgg_links l
      ON (n.seq IS NOT NULL AND l.seq = n.seq AND l.status IN ('pending', 'linked'))
      OR (n.seq IS NULL AND g.bgg_id IS NOT NULL AND l.candidate_bgg_id = g.bgg_id
          AND l.bgg_game_id = g.id AND l.status = 'linked')
   ), filtered AS (
    SELECT * FROM identified
    WHERE (${tabs[tabIndex]})
      AND (? IS NULL OR (typeof(min_players) IN ('integer','real') AND typeof(max_players) IN ('integer','real')
           AND min_players > 0 AND min_players <= ? AND max_players >= ?))
      AND source = COALESCE(?, source)
      AND acquisition_status = COALESCE(?, acquisition_status)
      AND wishlist = COALESCE(?, wishlist)
      AND COALESCE(?, CASE WHEN archived_at IS NULL THEN 'active' ELSE 'archived' END)
          = CASE WHEN archived_at IS NULL THEN 'active' ELSE 'archived' END
      AND (instr(lower(display_name), ?) > 0 OR instr(lower(game_name), ?) > 0
           OR lower(source_id) = ? OR CAST(id AS TEXT) = ? OR 'collection:' || id = ?)
   ), grouped AS (
    SELECT group_key, MIN(id) id, MAX(updated_at) updated_at,
           MIN(CASE WHEN ? = 'grouped' THEN game_name ELSE display_name END) name, SUM(copies) copies
    FROM filtered GROUP BY group_key
   ), totals AS (
    SELECT COUNT(*) total FROM grouped
   ), bounds AS (
    SELECT total, MIN(?, MAX(1, CAST((total + ? - 1) / ? AS INTEGER))) page FROM totals
   ), selected AS (
    SELECT * FROM grouped ORDER BY ${ordering}
    LIMIT ? OFFSET (SELECT (page - 1) * ? FROM bounds)
   )
   SELECT bounds.total, bounds.page, f.*
   FROM bounds LEFT JOIN selected p ON 1 LEFT JOIN filtered f ON f.group_key = p.group_key
   ORDER BY ${ordering.replace(/\b(updated_at|id|name|copies)\b/g, 'p.$1')}, f.id`;
  const [counts, list] = await Promise.all([
   readCollectionSection('counts', async () => {
    const row = await this.db.prepare(`SELECT COUNT(*) AS "all",
      COUNT(CASE WHEN (${adminOwnedSql}) = 1 THEN 1 END) AS owned,
      COUNT(CASE WHEN wishlist = 1 THEN 1 END) AS wishlist,
      COUNT(CASE WHEN acquisition_status = 'preordered' THEN 1 END) AS preordered
      FROM v2_collection_items WHERE record_scope = ?`).bind(scope).first<NonNullable<NumberedCollectionList['counts']>>();
    if (!row || Object.values(row).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid counts');
    return {...row};
   }),
   readCollectionSection('list', async () => {
    const result = await this.db.prepare(sql).bind(
     publicMetadataRegistry, view, scope, players, players, players, source, status,
     wishlist === null ? null : Number(wishlist), archive, keyword, keyword, keyword, keyword, keyword,
     view, page, limit, limit, limit, limit
    ).all<NumberedCollectionItem & CollectionListIdentity & {group_key: string; total: number; page: number}>();
    const first = result.results?.[0];
    if (!result.success || !first || !Number.isSafeInteger(first.total) || !Number.isSafeInteger(first.page)) {
     throw new Error('Invalid list result');
    }
    const groups = new Map<string, NumberedCollectionGroup>();
    for (const row of result.results) {
     const {id, group_key, display_name, item_type, acquisition_status, wishlist, archived_at, owned,
      updated_at, copies, image, min_players, max_players, total, page, ...identity} = row;
     if (id === null) continue; // The totals row also represents an empty page.
     let group = groups.get(group_key);
     if (!group) {
      group = {key: group_key, ...identity, items: []};
      groups.set(group_key, group);
     }
     group.items.push({id, display_name, item_type, acquisition_status, wishlist, archived_at, owned, updated_at,
      copies, image: safeImage(typeof image === 'string' ? image : null),
      min_players: typeof min_players === 'number' && min_players > 0 ? min_players : null,
      max_players: typeof max_players === 'number' && max_players > 0 ? max_players : null});
    }
    return {groups: [...groups.values()], total: first.total, page: first.page, limit};
   }),
  ]);
  return {counts, list};
 }
 async get(id:number,scope:CollectionScope):Promise<AdminRow|null>{positive(id);scopeCheck(scope);return this.db.prepare(`SELECT c.*,EXISTS(SELECT 1 FROM v2_games g WHERE g.id=c.game_id) resolved_game,COALESCE(m.revision,0) revision,m.archived_at,m.managed_copy_id,m.managed_order_id,n.seq notbgg_seq,n.archived_at source_archived FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id LEFT JOIN notbgg_games n ON n.game_id=c.game_id WHERE c.id=? AND c.record_scope=?`).bind(id,scope).first<AdminRow>();}
 async detail(id:number,scope:CollectionScope){const item=await this.get(id,scope);if(!item)return null;
  const copies=(await this.db.prepare('SELECT * FROM v2_owned_copies WHERE collection_item_id=? ORDER BY id').bind(id).all()).results;
  const purchases=(await this.db.prepare('SELECT o.*,l.id line_id,l.unit_price_minor FROM v2_purchase_order_lines l JOIN v2_purchase_orders o ON o.id=l.purchase_order_id WHERE l.collection_item_id=? ORDER BY o.id').bind(id).all()).results;
  const sleeves=(await this.db.prepare('SELECT id,size_id,quantity_sheets,owned_copy_id FROM v2_sleeve_requirements WHERE collection_item_id=?').bind(id).all()).results;
  return {item,copies,purchases,sleeves};
 }
 async search(q:string){if(q.length>200)throw new CollectionWriteError('VALIDATION');const keyword=q.trim().toLowerCase();
  const bgg=getGames().filter(g=>g.bgg&&(!keyword||`bgg:${g.bggId}`===keyword||`#${g.bggId}`===keyword||g.name.toLowerCase().includes(keyword))).map(g=>({ref:{source:'bgg' as const,bggId:g.bggId},name:g.name,type:g.bgg!.gameType}));
  const synced = (await searchSyncedBggGames(this.db, keyword))
   .map(game => ({ref:{source:'bgg' as const,bggId:game.bggId},name:game.name,type:game.bgg.gameType,synced:true as const}));
  const syncedIds = new Set(synced.map(game => game.ref.bggId));
  const rows=await this.db.prepare(`SELECT seq,name,type FROM notbgg_games WHERE archived_at IS NULL AND (instr(lower(name),?)>0 OR lower(printf('NotBGG:%06d',seq))=?) ORDER BY seq LIMIT 20`).bind(keyword,keyword).all<{seq:number;name:string;type:string}>();
  const bggResults = [...synced,...bgg.filter(game => !syncedIds.has(game.ref.bggId))].slice(0,20);
  return [...bggResults,...rows.results.map(n=>({ref:parseGameRef({source:'notbgg',notBggId:`NotBGG:${String(n.seq).padStart(6,'0')}`}),name:n.name,type:n.type}))];
 }
 private async relinkTarget(ref: GameRef) {
  if (ref.source === 'bgg') {
   const game = getGames().find(g => g.bggId === ref.bggId && g.bgg) ?? await readSyncedBggGame(this.db, ref.bggId);
   if (!game) throw new CollectionWriteError('INVALID_REFERENCE');
   const row = await this.db.prepare('SELECT id FROM v2_games WHERE bgg_id=?').bind(ref.bggId).first<{id:number}>();
   return {gameId: row?.id ?? null, name: game.name, itemType: getCatalogGameType(game.bgg!.gameType), ref};
  }
  const game = await this.db.prepare('SELECT game_id,name,type FROM notbgg_games WHERE seq=? AND archived_at IS NULL')
   .bind(Number(ref.notBggId.slice(7))).first<{game_id:number; name:string; type:string}>();
  if (!game) throw new CollectionWriteError('INVALID_REFERENCE');
  return {gameId: game.game_id, name: game.name,
   itemType: game.type === 'boardgame' ? 'base' : game.type === 'boardgameexpansion' ? 'expansion' : 'accessory', ref};
 }

 private async relinkSource(id: number, scope: CollectionScope) {
  const current = await this.get(id, scope);
  if (!current) throw new CollectionWriteError('NOT_FOUND');
  if (current.archived_at) throw new CollectionWriteError('ARCHIVED');
  return current;
 }

 async previewRelink(id: number, scope: CollectionScope, ref: GameRef) {
  const current = await this.relinkSource(id, scope);
  const target = await this.relinkTarget(ref);
  const source = await this.db.prepare(`SELECT COALESCE(n.name,g.primary_name) name,
    CASE WHEN n.seq IS NOT NULL THEN printf('NotBGG:%06d',n.seq)
         WHEN g.bgg_id IS NOT NULL THEN 'BGG:' || g.bgg_id END AS source_id
    FROM v2_games g LEFT JOIN notbgg_games n ON n.game_id=g.id WHERE g.id=?`)
   .bind(current.game_id).first<{name:string; source_id:string|null}>();
  const counts = await this.db.prepare(`WITH selected(id,scope,target) AS (VALUES (?,?,?)),
    copies AS (SELECT id FROM v2_owned_copies WHERE collection_item_id=(SELECT id FROM selected)),
    definitions AS (SELECT id FROM v2_component_definitions WHERE collection_item_id=(SELECT id FROM selected))
   SELECT
    EXISTS(SELECT 1 FROM v2_collection_items WHERE game_id=selected.target AND id<>selected.id AND record_scope=selected.scope) AS duplicate,
    (SELECT COUNT(*) FROM copies) AS copies,
    (SELECT COUNT(*) FROM definitions) AS components,
    (SELECT COUNT(*) FROM v2_component_photos WHERE definition_id IN (SELECT id FROM definitions)) AS photos,
    (SELECT COUNT(*) FROM v2_copy_components WHERE owned_copy_id IN (SELECT id FROM copies) AND actual_quantity IS NOT NULL) AS counts,
    (SELECT COUNT(*) FROM v2_sleeve_requirements WHERE collection_item_id=selected.id) AS sleeves,
    (SELECT COUNT(*) FROM (
      SELECT purchase_order_id FROM v2_purchase_order_lines WHERE collection_item_id=selected.id
      UNION SELECT purchase_order_id FROM v2_purchase_allocations
       WHERE collection_item_id=selected.id OR owned_copy_id IN (SELECT id FROM copies)
      UNION SELECT l.purchase_order_id FROM v2_acquisitions a JOIN v2_purchase_order_lines l ON l.id=a.purchase_order_line_id
       WHERE a.owned_copy_id IN (SELECT id FROM copies)
    )) AS purchases,
    (SELECT COUNT(*) FROM v2_collection_relations WHERE source_item_id=selected.id OR target_item_id=selected.id) AS relations
   FROM selected`).bind(id, scope, target.gameId).first<Record<'duplicate'|'copies'|'components'|'photos'|'counts'|'sleeves'|'purchases'|'relations',number>>();
  if (!counts) throw new CollectionWriteError('STORAGE');
  const {duplicate, ...preserved} = counts;
  return {revision: current.revision,
   current: {gameId: current.game_id, name: source?.name ?? null, sourceId: source?.source_id ?? null, itemType: String(current.item_type)},
   target, sameGame: target.gameId !== null && target.gameId === current.game_id,
   typeChanged: target.itemType !== current.item_type, hasOtherCollections: Boolean(duplicate),
   affected: ['publicGamePage', 'seriesSpending', 'publicSleeves'] as const, preserved};
 }

 async relinkHistory(id: number, scope: CollectionScope) {
  if (!await this.get(id, scope)) throw new CollectionWriteError('NOT_FOUND');
  const history = await this.db.prepare(`SELECT c.revision,c.from_game_id,c.to_game_id,c.from_item_type,c.to_item_type,
    c.actor,c.occurred_at,COALESCE(fn.name,f.primary_name) from_name,COALESCE(tn.name,t.primary_name) to_name
   FROM v2_collection_game_changes c
   LEFT JOIN v2_games f ON f.id=c.from_game_id LEFT JOIN notbgg_games fn ON fn.game_id=f.id
   JOIN v2_games t ON t.id=c.to_game_id LEFT JOIN notbgg_games tn ON tn.game_id=t.id
   WHERE c.collection_item_id=? ORDER BY c.revision DESC`).bind(id).all<{
    revision:number; from_game_id:number|null; to_game_id:number; from_item_type:string; to_item_type:string;
    actor:string; occurred_at:string; from_name:string|null; to_name:string;
   }>();
  return history.results;
 }

 async relink(id: number, ref: GameRef, ctx: {
  actor:string; scope:CollectionScope; idempotencyKey:string; revision:unknown;
  renameToGame:unknown; confirmTypeChange:unknown;
 }) {
  const {actor, scope, idempotencyKey, revision, renameToGame, confirmTypeChange} = ctx;
  positive(id);
  scopeCheck(scope);
  if (!actor.trim() || !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)
    || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER
    || typeof renameToGame !== 'boolean' || typeof confirmTypeChange !== 'boolean') throw new CollectionWriteError('VALIDATION');
  const key = JSON.stringify([actor, scope, idempotencyKey]);
  const fingerprint = await hash([id, gameCatalogKey(ref), revision, renameToGame, confirmTypeChange]);
  const replay = async () => {
   const receipt = await this.db.prepare('SELECT revision,request_hash FROM v2_collection_game_changes WHERE request_key=?')
    .bind(key).first<{revision:number; request_hash:string}>();
   if (!receipt) return null;
   if (receipt.request_hash !== fingerprint) throw new CollectionWriteError('IDEMPOTENCY_CONFLICT');
   return receipt.revision;
  };
  const result = async (committedRevision: number, replayed: boolean) => ({
   collectionId: id, revision: committedRevision, replayed,
   header: await readCollectionHeader(this.db, id, scope) ?? null,
  });
  const prior = await replay();
  if (prior !== null) return result(prior, true);
  const current = await this.relinkSource(id, scope);
  if (current.revision !== revision) {
   const committed = await replay();
   if (committed !== null) return result(committed, true);
   throw new CollectionWriteError('CONFLICT');
  }
  const target = await this.relinkTarget(ref);
  if (target.gameId !== null && target.gameId === current.game_id) throw new CollectionWriteError('SAME_GAME');
  if (target.itemType !== current.item_type && !confirmTypeChange) throw new CollectionWriteError('TYPE_CHANGE_CONFIRMATION_REQUIRED');

  const next = revision + 1;
  const statements = [this.db.prepare("INSERT INTO v2_collection_events(collection_item_id,revision,operation,actor) VALUES (?,?,'update',?)")
   .bind(id, next, actor)];
  if (ref.source === 'bgg') statements.push(this.db.prepare(`INSERT INTO v2_games(bgg_id,primary_name,game_type,catalog_source)
   VALUES (?,?,?,'bgg') ON CONFLICT(bgg_id) DO NOTHING`).bind(ref.bggId, target.name, target.itemType));
  const targetSql = ref.source === 'bgg' ? 'SELECT id FROM v2_games WHERE bgg_id=?'
   : 'SELECT game_id FROM notbgg_games WHERE seq=? AND archived_at IS NULL AND name=? AND type=?';
  const notBggType = target.itemType === 'base' ? 'boardgame' : target.itemType === 'expansion' ? 'boardgameexpansion' : 'boardgameaccessory';
  const targetArgs = ref.source === 'bgg' ? [ref.bggId] : [Number(ref.notBggId.slice(7)), target.name, notBggType];
  // The audit row is also the receipt. Its NOT NULL target rejects a NotBGG archive or
  // target edit racing the preview read, rolling back the event and all writes in the batch.
  statements.push(
   this.db.prepare(`INSERT INTO v2_collection_game_changes
     (collection_item_id,revision,from_game_id,to_game_id,from_item_type,to_item_type,actor,request_key,request_hash)
    VALUES (?,?,?,(${targetSql}),?,?,?,?,?)`)
    .bind(id, next, current.game_id, ...targetArgs, current.item_type, target.itemType, actor, key, fingerprint),
   this.db.prepare(`INSERT INTO v2_collection_management(collection_item_id,revision) VALUES (?,?)
    ON CONFLICT(collection_item_id) DO UPDATE SET revision=excluded.revision`).bind(id, next),
   this.db.prepare(`UPDATE v2_collection_items SET
     game_id=(SELECT to_game_id FROM v2_collection_game_changes WHERE collection_item_id=? AND revision=?),
     item_type=?,display_name=COALESCE(?,display_name),updated_at=?
    WHERE id=? AND record_scope=?`).bind(id, next, target.itemType, renameToGame ? target.name : null, new Date().toISOString(), id, scope),
  );
  try {
   await this.db.batch(statements);
  } catch (error) {
   const committed = await replay();
   if (committed !== null) return result(committed, true);
   const conflict = /COLLECTION_REVISION_CONFLICT|v2_collection_game_changes\.to_game_id/.test(String(error));
   throw new CollectionWriteError(conflict ? 'CONFLICT' : 'STORAGE');
  }
  return result(next, false);
 }

 async create(refInput:GameRef,input:unknown,context:{actor:string;idempotencyKey:string;scope:CollectionScope;createCopy:boolean}){
  const ref=parseGameRef(refInput),data=validateCollectionInput(input),scope=scopeCheck(context.scope);
  if(!context.actor||!/^[\w:-]{8,256}$/.test(context.idempotencyKey)||typeof context.createCopy!=='boolean')throw new CollectionWriteError('VALIDATION');
  if(!context.createCopy&&[data.language,data.edition,data.priceMinor,data.purchaseDate,data.merchant].some(v=>v!==null))throw new CollectionWriteError('COPY_REQUIRED');
  const fingerprint=await hash([gameCatalogKey(ref),data,scope,context.createCopy]),key=context.actor+':'+scope+':'+context.idempotencyKey;
  const existing=await this.db.prepare('SELECT collection_item_id,request_hash FROM v2_collection_management WHERE request_key=?').bind(key).first<{collection_item_id:number;request_hash:string}>();
  if(existing){if(existing.request_hash!==fingerprint)throw new CollectionWriteError('IDEMPOTENCY_CONFLICT');return {collectionId:existing.collection_item_id,replayed:true};}
  const statements:D1PreparedStatement[]=[];let gameSql:string,gameArg:number,type:string;
  if(ref.source==='bgg'){
   const g=getGames().find(g=>g.bggId===ref.bggId&&g.bgg) ?? await readSyncedBggGame(this.db,ref.bggId);if(!g)throw new CollectionWriteError('INVALID_REFERENCE');
   type=getCatalogGameType(g.bgg!.gameType);
   statements.push(this.db.prepare("INSERT INTO v2_games(bgg_id,primary_name,game_type,catalog_source) VALUES (?,?,?,'bgg') ON CONFLICT(bgg_id) DO NOTHING").bind(g.bggId,g.name,type));gameSql='SELECT id FROM v2_games WHERE bgg_id=?';gameArg=ref.bggId;
  }else{const n=await this.db.prepare('SELECT game_id,type FROM notbgg_games WHERE seq=? AND archived_at IS NULL').bind(Number(ref.notBggId.slice(7))).first<{game_id:number;type:string}>();if(!n)throw new CollectionWriteError('INVALID_REFERENCE');type=n.type==='boardgame'?'base':n.type==='boardgameexpansion'?'expansion':'accessory';gameSql='SELECT game_id FROM notbgg_games WHERE seq=? AND archived_at IS NULL';gameArg=Number(ref.notBggId.slice(7));}
  const token=crypto.randomUUID(); // private, transaction-local lookup; never a public identity
  statements.push(this.db.prepare(`INSERT INTO v2_collection_items(game_id,display_name,item_type,acquisition_status,wishlist,notes,record_scope) VALUES ((${gameSql}),?,?,?,?,?,?)`).bind(gameArg,data.displayName,type,data.acquisitionStatus,Number(data.wishlist),JSON.stringify({...personal(data),d5_create_token:token}),scope));
  const item=`(SELECT id FROM v2_collection_items WHERE json_valid(notes) AND json_extract(notes,'$.d5_create_token')=?)`;
  statements.push(this.db.prepare(`INSERT INTO v2_collection_events(collection_item_id,revision,operation,actor) VALUES (${item},1,'create',?)`).bind(token,context.actor));
  statements.push(this.db.prepare(`INSERT INTO v2_collection_management(collection_item_id,revision,request_key,request_hash) VALUES (${item},1,?,?)`).bind(token,key,fingerprint));
  if(context.createCopy){statements.push(this.db.prepare(`INSERT INTO v2_owned_copies(collection_item_id,language_code,edition) VALUES (${item},?,?)`).bind(token,data.language,data.edition));
   statements.push(this.db.prepare(`UPDATE v2_collection_management SET managed_copy_id=last_insert_rowid() WHERE collection_item_id=${item}`).bind(token));
  }
  if(data.priceMinor!==null){statements.push(this.db.prepare('INSERT INTO v2_purchase_orders(merchant_name,ordered_at,currency_code,item_subtotal_minor) VALUES (?,?,?,?)').bind(data.merchant,data.purchaseDate,data.currency,data.priceMinor));
   statements.push(this.db.prepare(`UPDATE v2_collection_management SET managed_order_id=last_insert_rowid() WHERE collection_item_id=${item}`).bind(token));
   const order=`(SELECT managed_order_id FROM v2_collection_management WHERE collection_item_id=${item})`;
   statements.push(this.db.prepare(`INSERT INTO v2_purchase_order_lines(purchase_order_id,line_number,description,collection_item_id,unit_price_minor) VALUES (${order},1,?,${item},?)`).bind(token,data.displayName,token,data.priceMinor));
   statements.push(this.db.prepare(`INSERT INTO v2_acquisitions(owned_copy_id,purchase_order_line_id,acquired_at) SELECT m.managed_copy_id,l.id,NULL FROM v2_collection_management m JOIN v2_purchase_order_lines l ON l.purchase_order_id=m.managed_order_id WHERE m.collection_item_id=${item}`).bind(token));
   statements.push(this.db.prepare(`INSERT INTO v2_purchase_allocations(purchase_order_id,owned_copy_id,allocated_minor,allocation_method) SELECT managed_order_id,managed_copy_id,?,'direct' FROM v2_collection_management WHERE collection_item_id=${item}`).bind(data.priceMinor,token));
  }
  try{await this.db.batch(statements);}catch{
   const replay=await this.db.prepare('SELECT collection_item_id,request_hash FROM v2_collection_management WHERE request_key=?').bind(key).first<{collection_item_id:number;request_hash:string}>();
   if(replay){if(replay.request_hash!==fingerprint)throw new CollectionWriteError('IDEMPOTENCY_CONFLICT');return {collectionId:replay.collection_item_id,replayed:true};}throw new CollectionWriteError('STORAGE');
  }
  const created=await this.db.prepare('SELECT collection_item_id FROM v2_collection_management WHERE request_key=?').bind(key).first<{collection_item_id:number}>();return {collectionId:created!.collection_item_id,replayed:false};
 }
 async patchFields(id: number, changes: unknown, ctx: {actor: string; scope: CollectionScope; revision: unknown}) {
  const {revision, actor, scope} = ctx;
  if (!actor.trim() || typeof revision !== 'number' || !Number.isSafeInteger(revision)
      || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new CollectionWriteError('VALIDATION');
  const {assignments, values} = collectionPatchFields(changes);
  const current = await this.get(id, scope);
  if (!current) throw new CollectionWriteError('NOT_FOUND');
  if (current.revision !== revision) throw new CollectionWriteError('CONFLICT');
  if (current.archived_at) throw new CollectionWriteError('ARCHIVED');
  const next = revision + 1;
  try {
   // Insert the event first: collection_revision_gate checks the revision inside the batch,
   // including when this request races a full edit or archive after the preflight read.
   await this.db.batch([
    this.db.prepare("INSERT INTO v2_collection_events(collection_item_id,revision,operation,actor) VALUES (?,?,'update',?)").bind(id, next, actor),
    this.db.prepare(`INSERT INTO v2_collection_management(collection_item_id,revision) VALUES (?,?)
      ON CONFLICT(collection_item_id) DO UPDATE SET revision=excluded.revision`).bind(id, next),
    this.db.prepare(`UPDATE v2_collection_items SET ${assignments.join(', ')}, updated_at=? WHERE id=? AND record_scope=?`)
     .bind(...values, new Date().toISOString(), id, scope),
   ]);
  } catch (error) {
   throw new CollectionWriteError(String(error).includes('COLLECTION_REVISION_CONFLICT') ? 'CONFLICT' : 'STORAGE');
  }
  return this.detail(id, scope);
 }

 async update(id:number,input:unknown,ctx:{actor:string;scope:CollectionScope;expectedRevision:number;createCopy?:boolean},archive=false){
  const current=await this.get(id,ctx.scope);if(!current)throw new CollectionWriteError('NOT_FOUND');if(current.archived_at)throw new CollectionWriteError('ARCHIVED');
  if(!Number.isSafeInteger(ctx.expectedRevision)||ctx.expectedRevision<0||ctx.expectedRevision!==current.revision)throw new CollectionWriteError('CONFLICT');
  if(!ctx.actor||(ctx.createCopy!==undefined&&typeof ctx.createCopy!=='boolean'))throw new CollectionWriteError('VALIDATION');
  const data=archive?null:validateCollectionInput(input),rev=current.revision+1,now=new Date().toISOString();
  const statements=[this.db.prepare('INSERT INTO v2_collection_events(collection_item_id,revision,operation,actor) VALUES (?,?,?,?)').bind(id,rev,archive?'archive':'update',ctx.actor),this.db.prepare(`INSERT INTO v2_collection_management(collection_item_id,revision,archived_at) VALUES (?,?,?) ON CONFLICT(collection_item_id) DO UPDATE SET revision=excluded.revision,archived_at=excluded.archived_at`).bind(id,rev,archive?now:null)];
  if(data){let notes:Record<string,unknown>;try{notes=JSON.parse(current.notes??'{}');if(!notes||typeof notes!=='object'||Array.isArray(notes))throw 0;}catch{notes={legacy_notes:current.notes};}
   if(data.acquisitionStatus!==current.acquisition_status)delete notes.owned;Object.assign(notes,personal(data));
   statements.push(this.db.prepare('UPDATE v2_collection_items SET display_name=?,acquisition_status=?,wishlist=?,notes=?,updated_at=? WHERE id=? AND record_scope=?').bind(data.displayName,data.acquisitionStatus,Number(data.wishlist),JSON.stringify(notes),now,id,ctx.scope));
   if(current.managed_copy_id)statements.push(this.db.prepare('UPDATE v2_owned_copies SET language_code=?,edition=?,updated_at=? WHERE id=? AND collection_item_id=?').bind(data.language,data.edition,now,current.managed_copy_id,id));
   else if(ctx.createCopy){statements.push(this.db.prepare('INSERT INTO v2_owned_copies(collection_item_id,language_code,edition) VALUES (?,?,?)').bind(id,data.language,data.edition),this.db.prepare('UPDATE v2_collection_management SET managed_copy_id=last_insert_rowid() WHERE collection_item_id=?').bind(id));}
   else if([data.language,data.edition,data.purchaseDate,data.priceMinor,data.merchant].some(v=>v!==null))throw new CollectionWriteError('COPY_REQUIRED');
   // Existing purchase graphs are preserved. This editor updates its single managed order only.
   if(current.managed_order_id){if(data.priceMinor===null)throw new CollectionWriteError('PURCHASE_REQUIRED');
    const graph=await this.db.prepare(`SELECT (SELECT count(*) FROM v2_purchase_order_lines WHERE purchase_order_id=?) lines,(SELECT count(*) FROM v2_purchase_allocations WHERE purchase_order_id=? AND (owned_copy_id IS NOT ? OR collection_item_id IS NOT NULL)) others`).bind(current.managed_order_id,current.managed_order_id,current.managed_copy_id).first<{lines:number;others:number}>();
    if(graph?.lines!==1||graph.others)throw new CollectionWriteError('PURCHASE_NOT_MANAGED');
    statements.push(this.db.prepare('UPDATE v2_purchase_allocations SET allocated_minor=0 WHERE purchase_order_id=? AND owned_copy_id=?').bind(current.managed_order_id,current.managed_copy_id),this.db.prepare('UPDATE v2_purchase_orders SET item_subtotal_minor=?,currency_code=?,merchant_name=?,ordered_at=? WHERE id=?').bind(data.priceMinor,data.currency,data.merchant,data.purchaseDate,current.managed_order_id),this.db.prepare('UPDATE v2_purchase_order_lines SET unit_price_minor=?,description=? WHERE purchase_order_id=? AND collection_item_id=?').bind(data.priceMinor,data.displayName,current.managed_order_id,id),this.db.prepare('UPDATE v2_purchase_allocations SET allocated_minor=? WHERE purchase_order_id=? AND owned_copy_id=?').bind(data.priceMinor,current.managed_order_id,current.managed_copy_id));

   }else if(data.priceMinor!==null){
    statements.push(this.db.prepare('INSERT INTO v2_purchase_orders(merchant_name,ordered_at,currency_code,item_subtotal_minor) VALUES (?,?,?,?)').bind(data.merchant,data.purchaseDate,data.currency,data.priceMinor),
     this.db.prepare('UPDATE v2_collection_management SET managed_order_id=last_insert_rowid() WHERE collection_item_id=?').bind(id),
     this.db.prepare('INSERT INTO v2_purchase_order_lines(purchase_order_id,line_number,description,collection_item_id,unit_price_minor) SELECT managed_order_id,1,?,?,? FROM v2_collection_management WHERE collection_item_id=?').bind(data.displayName,id,data.priceMinor,id),
     this.db.prepare('INSERT INTO v2_acquisitions(owned_copy_id,purchase_order_line_id,acquired_at) SELECT managed_copy_id,last_insert_rowid(),NULL FROM v2_collection_management WHERE collection_item_id=?').bind(id),
     this.db.prepare("INSERT INTO v2_purchase_allocations(purchase_order_id,owned_copy_id,allocated_minor,allocation_method) SELECT managed_order_id,managed_copy_id,?,'direct' FROM v2_collection_management WHERE collection_item_id=?").bind(data.priceMinor,id));
   }
  }
  try{await this.db.batch(statements);}catch(e){throw new CollectionWriteError(String(e).includes('COLLECTION_REVISION_CONFLICT')?'CONFLICT':'STORAGE');}
  return this.detail(id,ctx.scope);
 }
}
