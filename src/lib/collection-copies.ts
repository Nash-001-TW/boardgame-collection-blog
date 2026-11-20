import { CollectionV2Writer, type CollectionScope } from './collection-v2-management';
import { HttpError } from './notbgg-admin-api';

function id(value: unknown, min=1): number {
    if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)throw new HttpError(400,'INVALID_COPY_INPUT');
    return value;
}
function optionalText(value:unknown,max:number):string|null{
    if(value===null||value==='')return null;
    if(typeof value!=='string'||value.trim().length>max||value.includes('\0'))throw new HttpError(400,'INVALID_COPY_INPUT');
    return value.trim()||null;
}
async function hash(value:unknown){
    const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(data),n=>n.toString(16).padStart(2,'0')).join('');
}

export async function readCollectionCopies(db:D1Database,collectionId:number,scope:CollectionScope,after=0){
    id(collectionId);id(after,0);
    const current=await new CollectionV2Writer(db).get(collectionId,scope);
    if(!current)throw new HttpError(404,'NOT_FOUND');
    const result=await db.prepare(`SELECT id,copy_label,language_code,edition,seal_status,inventory_status,inspection_status,trade_condition,condition_revision,condition_checked_at,condition_details
        FROM v2_owned_copies WHERE collection_item_id=? AND id>? ORDER BY id LIMIT 21`)
        .bind(collectionId,after).all<Record<string,unknown>>();
    if(!result.success)throw new HttpError(503,'DATABASE_UNAVAILABLE');
    const tags=await db.prepare(`SELECT t.* FROM v2_copy_condition_tags t JOIN v2_owned_copies c ON c.id=t.owned_copy_id WHERE c.collection_item_id=? AND c.id>? ORDER BY c.id,t.id`).bind(collectionId,after).all<Record<string,unknown>>();
    if(!tags.success)throw new HttpError(503,'DATABASE_UNAVAILABLE');
    return {
        collection:{id:collectionId,name:String(current.display_name),scope,revision:current.revision,archived:current.archived_at!==null},
        copies:result.results.slice(0,20),
        tags:tags.results,
        nextCursor:result.results.length>20?Number(result.results[19].id):null,
    };
}

export async function writeCollectionCopy(
    db:D1Database,collectionId:number,scope:CollectionScope,actor:string,key:string|null,
    input:Record<string,unknown>,edit:boolean,
){
    id(collectionId);
    const allowed=['expectedRevision','label','language','edition',...(edit?['copyId']:[])];
    if(Object.keys(input).some(field=>!allowed.includes(field)))throw new HttpError(400,'UNKNOWN_FIELD');
    if(!key||!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new HttpError(400,'INVALID_IDEMPOTENCY_KEY');
    const revision=id(input.expectedRevision,0);
    if(revision>=Number.MAX_SAFE_INTEGER)throw new HttpError(400,'INVALID_COPY_INPUT');
    const fields={label:optionalText(input.label,160),language:optionalText(input.language,40),edition:optionalText(input.edition,300)};
    const copyId=edit?id(input.copyId):null;
    const requestKey=await hash([actor,scope,collectionId,key]);
    const requestHash=await hash([edit,copyId,revision,fields]);
    const replay=async()=>{
        const previous=await db.prepare('SELECT request_hash,copy_id FROM v2_collection_copy_commands WHERE request_key=?')
            .bind(requestKey).first<{request_hash:string;copy_id:number}>();
        if(!previous)return null;
        if(previous.request_hash!==requestHash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT');
        return {copyId:previous.copy_id,replayed:true};
    };
    const previous=await replay();if(previous)return previous;
    const current=await new CollectionV2Writer(db).get(collectionId,scope);
    if(!current)throw new HttpError(404,'NOT_FOUND');
    if(current.archived_at)throw new HttpError(409,'ARCHIVED');
    if(current.revision!==revision)throw new HttpError(409,'COPY_STATE_CHANGED');
    const statements=[
        db.prepare(`INSERT INTO v2_collection_events(collection_item_id,revision,operation,actor) VALUES (?,?,'update',?)`)
            .bind(collectionId,revision+1,actor),
        db.prepare(`INSERT INTO v2_collection_management(collection_item_id,revision) VALUES (?,?)
            ON CONFLICT(collection_item_id) DO UPDATE SET revision=excluded.revision`).bind(collectionId,revision+1),
    ];
    if(edit){
        statements.push(db.prepare(`UPDATE v2_owned_copies SET copy_label=?,language_code=?,edition=?,updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND collection_item_id=? AND EXISTS (
                SELECT 1 FROM v2_collection_items c WHERE c.id=v2_owned_copies.collection_item_id AND c.record_scope=?)
            RETURNING id`).bind(fields.label,fields.language,fields.edition,copyId,collectionId,scope));
    }else{
        statements.push(db.prepare(`INSERT INTO v2_owned_copies(collection_item_id,copy_label,language_code,edition)
            SELECT id,?,?,? FROM v2_collection_items WHERE id=? AND record_scope=? RETURNING id`)
            .bind(fields.label,fields.language,fields.edition,collectionId,scope));
    }
    statements.push(db.prepare(`INSERT INTO v2_collection_copy_commands(request_key,request_hash,actor,copy_id)
        VALUES (?,?,?,CASE WHEN changes()=1 THEN ${edit?'?':'last_insert_rowid()'} ELSE NULL END)`)
        .bind(requestKey,requestHash,actor,...(edit?[copyId]:[])));
    try{
        const result=await db.batch<{id:number}>(statements);
        return {copyId:result[2].results[0].id,replayed:false};
    }catch(error){
        const previous=await replay();if(previous)return previous;
        if(/COLLECTION_REVISION_CONFLICT|UNIQUE constraint failed: v2_collection_events|NOT NULL constraint failed: v2_collection_copy_commands.copy_id/.test(String(error))){
            throw new HttpError(409,'COPY_STATE_CHANGED');
        }
        throw error;
    }
}
