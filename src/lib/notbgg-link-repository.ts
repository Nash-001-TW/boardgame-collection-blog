import { getGames } from './games';
import type { Game } from './game-catalog';
import { isBggId,isNotBggId } from './game-identity';
import type { NotBggId } from './game-identity';
import { NotBggRepository } from './notbgg-repository';
import { getCatalogGameType } from './game-content';
import { bggGameViewModel,notBggGameViewModel } from './game-view-model';
export class LinkCommandError extends Error {constructor(public code:string){super(code);}}
type LinkRow={id:number;seq:number;candidate_bgg_id:number;status:'pending'|'linked'|'revoked';primary_source:'notbgg'|'bgg'};
export type LinkCommand={action:'propose'|'confirm'|'primary'|'revoke';expectedEventId:number;expectedProfileRevision:number;reason:string;bggId?:number;linkId?:number;primarySource?:'notbgg'|'bgg'};
/** Backend-only commands. The caller supplies an independently verified administrator subject. */
export class NotBggLinkRepository {
 constructor(private db:D1Database,private games:readonly Game[]=getGames()){}
 target(id:unknown){if(!isBggId(id))throw new LinkCommandError('INVALID_BGG_ID');const game=this.games.find(g=>g.bggId===id&&g.bgg);if(!game)throw new LinkCommandError('TARGET_NOT_FOUND');return game;}
 async state(id:NotBggId){if(!isNotBggId(id))throw new LinkCommandError('INVALID_ID');const seq=Number(id.slice(7)),original=await new NotBggRepository(this.db).getByNotBggId(id);if(!original)throw new LinkCommandError('NOT_FOUND');
  const link=await this.db.prepare("SELECT id,seq,candidate_bgg_id,status,primary_source FROM notbgg_bgg_links WHERE seq=? AND status IN ('pending','linked')").bind(seq).first<LinkRow>();
  const event=await this.db.prepare('SELECT COALESCE(MAX(e.id),0) id FROM notbgg_link_events e JOIN notbgg_bgg_links l ON l.id=e.link_id WHERE l.seq=?').bind(seq).first<{id:number}>();
  return {original,link,state:link?.status==='pending'?'candidate':link?.status==='linked'?'linked':'unlinked',expectedEventId:event?.id??0};
 }
 async comparison(id:NotBggId,bggId:number){const state=await this.state(id),target=this.target(bggId);return {originalRevision:state.original.revision,notbgg:notBggGameViewModel(state.original),bgg:bggGameViewModel(target),compatible:state.original.type===target.bgg!.gameType};}
 async history(id:NotBggId,after=0,limit=20){if(!isNotBggId(id)||!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>100)throw new LinkCommandError('VALIDATION');return (await this.db.prepare('SELECT e.id,e.link_id,l.candidate_bgg_id,e.action,e.actor,e.reason,e.created_at,e.state_json FROM notbgg_link_events e JOIN notbgg_bgg_links l ON l.id=e.link_id WHERE l.seq=? AND e.id>? ORDER BY e.id LIMIT ?').bind(Number(id.slice(7)),after,limit).all()).results;}
 async execute(id:NotBggId,command:LinkCommand,actor:string){
  if(!actor||!['propose','confirm','primary','revoke'].includes(command.action)||!Number.isSafeInteger(command.expectedProfileRevision)||command.expectedProfileRevision<1||!Number.isSafeInteger(command.expectedEventId)||command.expectedEventId<0||typeof command.reason!=='string'||!command.reason.trim()||command.reason.length>3000)throw new LinkCommandError('VALIDATION');
  const schema=await this.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name IN ('notbgg_link_command_gate','notbgg_linked_type_guard')").first<{n:number}>();
  if(schema?.n!==2)throw new LinkCommandError('SCHEMA_NOT_READY');
  const current=await this.state(id),{original,link}=current,seq=Number(id.slice(7));
  if(command.expectedProfileRevision!==original.revision||command.expectedEventId!==current.expectedEventId)throw new LinkCommandError('CONFLICT');
  if(original.archivedAt&&command.action!=='revoke')throw new LinkCommandError('ARCHIVED');
  const statements:D1PreparedStatement[]=[],now=new Date().toISOString();let eventAction:string,status:string,primarySource:string,linkSql:string,linkArgs:(number|string)[]=[];
  if(command.action==='propose'){
   if(link)throw new LinkCommandError('INVALID_TRANSITION');const target=this.target(command.bggId);
   statements.push(this.db.prepare("INSERT INTO notbgg_bgg_links(seq,candidate_bgg_id,created_by,created_at) VALUES (?,?,?,?)").bind(seq,target.bggId,actor,now));
   eventAction='proposed';status='pending';primarySource='notbgg';linkSql='last_insert_rowid()';
  }else{
   if(!link||!isBggId(command.linkId)||link.id!==command.linkId)throw new LinkCommandError('CONFLICT');
   linkSql='?';linkArgs=[link.id];
   if(command.action==='revoke'){
    eventAction='revoked';status='revoked';primarySource=link.primary_source;
    statements.push(this.db.prepare("UPDATE notbgg_bgg_links SET status='revoked',revoked_by=?,revoked_at=?,revoke_reason=? WHERE id=? AND status IN ('pending','linked')").bind(actor,now,command.reason.trim(),link.id));
   }else{
    const target=command.action==='confirm'||command.primarySource==='bgg'?this.target(link.candidate_bgg_id):null;
    if(target&&original.type!==target.bgg!.gameType)throw new LinkCommandError('TYPE_MISMATCH');
    if(command.action==='confirm'){
     if(link.status!=='pending')throw new LinkCommandError('INVALID_TRANSITION');
     const type=getCatalogGameType(target!.bgg!.gameType);
     statements.push(this.db.prepare("INSERT INTO v2_games(bgg_id,primary_name,game_type,catalog_source) VALUES (?,?,?,'bgg') ON CONFLICT(bgg_id) DO NOTHING").bind(target!.bggId,target!.name,type),
      this.db.prepare("UPDATE notbgg_bgg_links SET status='linked',bgg_game_id=(SELECT id FROM v2_games WHERE bgg_id=?),confirmed_by=?,linked_at=?,primary_source='notbgg' WHERE id=? AND status='pending'").bind(target!.bggId,actor,now,link.id));
     eventAction='confirmed';status='linked';primarySource='notbgg';
    }else{
     if(link.status!=='linked'||!['notbgg','bgg'].includes(command.primarySource??'')||command.primarySource===link.primary_source)throw new LinkCommandError('INVALID_TRANSITION');
     eventAction='primary_source_changed';status='linked';primarySource=command.primarySource!;
     statements.push(this.db.prepare("UPDATE notbgg_bgg_links SET primary_source=? WHERE id=? AND status='linked'").bind(primarySource,link.id));
    }
   }
  }
  const snapshot={status,primarySource,_expectedEventId:command.expectedEventId,_profileRevision:original.revision};
  statements.push(this.db.prepare(`INSERT INTO notbgg_link_events(link_id,action,actor,reason,state_json,created_at) VALUES (${linkSql},?,?,?,?,?)`).bind(...linkArgs,eventAction,actor,command.reason.trim(),JSON.stringify(snapshot),now));
  try{await this.db.batch(statements);}catch(error){const text=String(error);throw new LinkCommandError(/LINK_|UNIQUE/.test(text)?'CONFLICT':'STORAGE');}
  return this.state(id);
 }
}
