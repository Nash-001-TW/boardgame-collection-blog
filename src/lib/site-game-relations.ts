import { parseGameRef,isNotBggId } from './game-identity';
import type { GameRef,NotBggId } from './game-identity';
import { CollectionWriteError } from './collection-v2-management';
/** Independent site edges; no BGG official relation table/cache is read or written. */
export class SiteGameRelations {
 constructor(private db:D1Database){}
 async list(id:NotBggId){if(!isNotBggId(id))throw new CollectionWriteError('VALIDATION');return (await this.db.prepare(`SELECT r.id,r.target_game_id,r.relation_type,r.relation_source,r.notes,r.created_by,r.created_at,r.archived_at,g.primary_name,g.bgg_id,n.seq notbgg_seq,n.archived_at target_archived FROM site_game_relations r JOIN notbgg_games owner ON owner.game_id=r.source_game_id JOIN v2_games g ON g.id=r.target_game_id LEFT JOIN notbgg_games n ON n.game_id=g.id WHERE owner.seq=? ORDER BY r.id`).bind(Number(id.slice(7))).all()).results;}
 async add(id:NotBggId,targetInput:GameRef,type:unknown,notes:unknown,actor:string){
  if(!isNotBggId(id)||!['accessory_for','compatible_with'].includes(String(type))||!actor||!(notes===null||typeof notes==='string'&&notes.length<=3000))throw new CollectionWriteError('VALIDATION');
  const target=parseGameRef(targetInput),owner=await this.db.prepare("SELECT game_id FROM notbgg_games WHERE seq=? AND type='boardgameaccessory' AND archived_at IS NULL").bind(Number(id.slice(7))).first<{game_id:number}>();
  const t=target.source==='bgg'?await this.db.prepare('SELECT id FROM v2_games WHERE bgg_id=?').bind(target.bggId).first<{id:number}>():await this.db.prepare('SELECT game_id id FROM notbgg_games WHERE seq=? AND archived_at IS NULL').bind(Number(target.notBggId.slice(7))).first<{id:number}>();
  if(!owner||!t||owner.game_id===t.id)throw new CollectionWriteError('INVALID_REFERENCE');
  try{const result=await this.db.batch([this.db.prepare("INSERT INTO site_game_relations(source_game_id,target_game_id,relation_type,notes,created_by) VALUES (?,?,?,?,?)").bind(owner.game_id,t.id,type,notes,actor),this.db.prepare("INSERT INTO site_relation_events(relation_id,operation,actor) VALUES (last_insert_rowid(),'created',?)").bind(actor)]);return Number(result[0].meta.last_row_id);}catch(e){throw new CollectionWriteError(String(e).includes('UNIQUE')?'DUPLICATE_RELATION':'STORAGE');}
 }
 async archive(id:NotBggId,relationId:number,actor:string){if(!isNotBggId(id)||!Number.isSafeInteger(relationId)||relationId<1||!actor)throw new CollectionWriteError('VALIDATION');
  const result=await this.db.batch([this.db.prepare(`INSERT INTO site_relation_events(relation_id,operation,actor) SELECT r.id,'archived',? FROM site_game_relations r JOIN notbgg_games n ON n.game_id=r.source_game_id WHERE n.seq=? AND r.id=? AND r.relation_source='manual' AND r.archived_at IS NULL`).bind(actor,Number(id.slice(7)),relationId),this.db.prepare(`UPDATE site_game_relations SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND source_game_id=(SELECT game_id FROM notbgg_games WHERE seq=?) AND relation_source='manual' AND archived_at IS NULL`).bind(relationId,Number(id.slice(7)))]);
  if(!result[0].meta.changes)throw new CollectionWriteError('NOT_FOUND');
 }
}
