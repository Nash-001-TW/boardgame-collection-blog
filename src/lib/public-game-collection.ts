import { deserializeGameRef,type GameRef } from './game-identity';
import { getGames } from './games';
import { publicIdentityIndex } from './identity-resolution';
import { classifyStoredComponents } from './component-classifier-adapter';
import { collectionOwned } from './collection-ownership';
import { readPublicBgg,readPublicBggIndex } from './public-site-data';

export class PublicCollectionError extends Error {
    constructor(public status:number,public code:string){super(code);}
}
const eligible=`WITH eligible AS (
    SELECT c.id,c.display_name,c.acquisition_status,c.wishlist,
        CASE WHEN json_valid(c.notes) THEN json_extract(c.notes,'$.owned') END AS legacy_owned
    FROM v2_collection_items c JOIN v2_games g ON g.id=c.game_id
    LEFT JOIN notbgg_games n ON n.game_id=g.id
    LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id
    WHERE c.record_scope='production' AND m.archived_at IS NULL AND n.archived_at IS NULL
      AND (g.bgg_id=? OR n.seq=?)
)`;

export type PublicComponentStatus='physical_card'|'legacy_product'|'pending'|'unavailable'|'unassigned';
export interface PublicGameCollection {
    source:'D1';
    ratingVisibility:'not_public';
    collections:{
        id:number;name:string;status:string;owned:boolean;wishlist:boolean;preordered:boolean;
        copyCount:number;inCollectionCopyCount:number;
        versions:{language:string|null;edition:string|null;count:number}[];
    }[];
    requirements:{
        id:number;collectionId:number;collectionName:string;quantity:number;
        size:{id:number;widthMm:number;heightMm:number};
        scope:'collection'|'copy';
        component:{status:PublicComponentStatus;name?:string};
        products:{name:string;brand:string|null;sheetsPerPack:number;thicknessMicrons:number|null}[];
        applications:{copyNumber:number;quantity:number;product:string;brand:string|null}[];
    }[];
    componentVerificationUnavailable:boolean;
}

function integer(value:unknown,min=0):value is number {
    return typeof value==='number'&&Number.isSafeInteger(value)&&value>=min;
}
function checkedRows<T>(result:{success:boolean;results:T[]}):T[] {
    if(!result.success||!Array.isArray(result.results)){
        throw new PublicCollectionError(503,'PUBLIC_COLLECTION_UNAVAILABLE');
    }
    return result.results;
}

/** Public projection. Never return Notes, signing material, prices, copy labels or admin audit fields. */
export async function readPublicGameCollection(db:D1Database|undefined,key:string,secret:unknown):Promise<PublicGameCollection>{
    let ref:GameRef;
    try{ref=deserializeGameRef(key);}catch{throw new PublicCollectionError(400,'INVALID_GAME_ID');}
    if(!db)throw new PublicCollectionError(503,'PUBLIC_COLLECTION_UNAVAILABLE');
    const games=getGames();
    let additional:number[]=[];
    if(ref.source==='bgg'&&!games.some(game=>game.bggId===ref.bggId&&game.bgg)){
        if(!await readPublicBgg(db,ref.bggId,'zh-TW'))throw new PublicCollectionError(404,'GAME_NOT_FOUND');additional=[ref.bggId];
    }
    if(ref.source==='notbgg'){
        const active=await db.prepare('SELECT seq FROM notbgg_games WHERE seq=? AND archived_at IS NULL')
            .bind(Number(ref.notBggId.slice(7))).first<{seq:number}>();
        if(!active)throw new PublicCollectionError(404,'GAME_NOT_FOUND');
        additional=await readPublicBggIndex(db);
    }
    const identity=await publicIdentityIndex(db,games,additional);
    const link=ref.source==='bgg'?identity.byBgg.get(ref.bggId):identity.byNotBgg.get(ref.notBggId);
    const bggId=ref.source==='bgg'?ref.bggId:link?.bggId??0;
    const notBggSeq=ref.source==='notbgg'?Number(ref.notBggId.slice(7)):link?Number(link.notBggId.slice(7)):0;
    const args=[bggId,notBggSeq];

    const [collectionResult,versionResult,requirementResult,productResult,applicationResult]=await Promise.all([
        db.prepare(`${eligible}, copies AS (
            SELECT p.collection_item_id,COUNT(*) AS copy_count,
                SUM(CASE WHEN p.inventory_status='in_collection' THEN 1 ELSE 0 END) AS held_count
            FROM v2_owned_copies p JOIN eligible e ON e.id=p.collection_item_id GROUP BY p.collection_item_id
        )
        SELECT e.id,e.display_name,e.acquisition_status,e.wishlist,e.legacy_owned,
            COALESCE(p.copy_count,0) copy_count,COALESCE(p.held_count,0) held_count
        FROM eligible e LEFT JOIN copies p ON p.collection_item_id=e.id ORDER BY e.id`)
            .bind(...args).all<{id:number;display_name:string;acquisition_status:string;wishlist:number;legacy_owned:unknown;copy_count:number;held_count:number}>(),
        db.prepare(`${eligible} SELECT p.collection_item_id,p.language_code,p.edition,COUNT(*) AS copies
            FROM v2_owned_copies p JOIN eligible e ON e.id=p.collection_item_id
            GROUP BY p.collection_item_id,p.language_code,p.edition
            ORDER BY p.collection_item_id,p.language_code,p.edition`)
            .bind(...args).all<{collection_item_id:number;language_code:string|null;edition:string|null;copies:number}>(),
        db.prepare(`${eligible} SELECT r.id,r.collection_item_id,e.display_name,r.quantity_sheets,
            r.owned_copy_id,r.component_definition_id,r.size_id,s.width_tenth_mm,s.height_tenth_mm,
            d.collection_item_id AS definition_collection,d.component_type,d.quantity_unit,d.component_name,
            p.collection_item_id AS copy_collection
            FROM v2_sleeve_requirements r JOIN eligible e ON e.id=r.collection_item_id
            LEFT JOIN v2_sleeve_sizes s ON s.id=r.size_id
            LEFT JOIN v2_component_definitions d ON d.id=r.component_definition_id
            LEFT JOIN v2_owned_copies p ON p.id=r.owned_copy_id ORDER BY r.id`)
            .bind(...args).all<{id:number;collection_item_id:number;display_name:string;quantity_sheets:number;
                owned_copy_id:number|null;component_definition_id:number|null;size_id:number;width_tenth_mm:number;height_tenth_mm:number;
                definition_collection:number|null;component_type:string|null;quantity_unit:string|null;component_name:string|null;copy_collection:number|null}>(),
        db.prepare(`${eligible} SELECT p.size_id,p.brand,p.product_name,p.sheets_per_pack,p.thickness_microns
            FROM v2_sleeve_products p WHERE p.is_active=1 AND EXISTS (
                SELECT 1 FROM v2_sleeve_requirements r JOIN eligible e ON e.id=r.collection_item_id WHERE r.size_id=p.size_id)
            ORDER BY p.size_id,p.id`).bind(...args).all<{size_id:number;brand:string|null;product_name:string;sheets_per_pack:number;thickness_microns:number|null}>(),
        db.prepare(`${eligible} SELECT a.requirement_id,a.quantity_sheets,p.product_name,p.brand,
            (SELECT COUNT(*) FROM v2_owned_copies o WHERE o.collection_item_id=c.collection_item_id AND o.id<=c.id) copy_number
            FROM v2_sleeve_applications a JOIN v2_sleeve_requirements r ON r.id=a.requirement_id
            JOIN eligible e ON e.id=r.collection_item_id
            JOIN v2_owned_copies c ON c.id=a.owned_copy_id AND c.collection_item_id=e.id
            JOIN v2_copy_components cc ON cc.id=a.copy_component_id AND cc.owned_copy_id=c.id AND cc.component_definition_id=r.component_definition_id
            JOIN v2_sleeve_inventory_transactions t ON t.id=a.inventory_transaction_id AND t.transaction_type='USE'
                AND t.quantity_sheets=-a.quantity_sheets AND t.owned_copy_id=c.id AND t.collection_item_id=e.id
            JOIN v2_sleeve_products p ON p.id=t.product_id AND p.size_id=r.size_id
            WHERE (r.owned_copy_id IS NULL OR r.owned_copy_id=c.id) ORDER BY a.id`)
            .bind(...args).all<{requirement_id:number;quantity_sheets:number;product_name:string;brand:string|null;copy_number:number}>(),
    ]);
    const collectionRows=checkedRows(collectionResult),versions=checkedRows(versionResult);
    const requirements=checkedRows(requirementResult),products=checkedRows(productResult);
    const applications=checkedRows(applicationResult);
    const collectionVersions=new Map<number,PublicGameCollection['collections'][number]['versions']>();
    for(const version of versions){
        if(!integer(version.copies,1))throw new PublicCollectionError(503,'PUBLIC_COLLECTION_UNAVAILABLE');
        const rows=collectionVersions.get(version.collection_item_id)??[];
        rows.push({language:version.language_code,edition:version.edition,count:version.copies});
        collectionVersions.set(version.collection_item_id,rows);
    }
    const productsBySize=new Map<number,PublicGameCollection['requirements'][number]['products']>();
    for(const product of products){
        if(!integer(product.sheets_per_pack,1)||(product.thickness_microns!==null&&!integer(product.thickness_microns,1))){
            throw new PublicCollectionError(503,'PUBLIC_COLLECTION_UNAVAILABLE');
        }
        const rows=productsBySize.get(product.size_id)??[];
        rows.push({name:product.product_name,brand:product.brand,sheetsPerPack:product.sheets_per_pack,thicknessMicrons:product.thickness_microns});
        productsBySize.set(product.size_id,rows);
    }
    const results=await classifyStoredComponents(db,
        [...new Set(requirements.flatMap(row=>row.component_definition_id===null?[]:[row.component_definition_id]))],{secret});
    const classifications=new Map(results.map(result=>[result.definitionId,result]));
    let verificationUnavailable=false;
    const publicRequirements=requirements.map(row=>{
        if(!integer(row.id,1)||!integer(row.quantity_sheets)||!integer(row.width_tenth_mm,1)||!integer(row.height_tenth_mm,1)){
            throw new PublicCollectionError(503,'PUBLIC_COLLECTION_UNAVAILABLE');
        }
        let status:PublicComponentStatus='unassigned';
        let name:string|undefined;
        if(row.component_definition_id!==null){
            const classified=classifications.get(row.component_definition_id);
            if(!classified||classified.reason==='EVIDENCE_UNAVAILABLE'){
                status='unavailable';verificationUnavailable=true;
            }else if(row.definition_collection!==row.collection_item_id
                ||(row.owned_copy_id!==null&&row.copy_collection!==row.collection_item_id)){
                status='pending';
            }else if(classified.classification==='LEGACY_PRODUCT')status='legacy_product';
            else if(classified.classification==='PHYSICAL_COMPONENT'&&classified.canAssignToSleeves
                &&row.component_type==='card'&&row.quantity_unit==='card'){
                status='physical_card';name=row.component_name??undefined;
            }else status='pending';
        }
        return {
            id:row.id,collectionId:row.collection_item_id,collectionName:row.display_name,quantity:row.quantity_sheets,
            size:{id:row.size_id,widthMm:row.width_tenth_mm/10,heightMm:row.height_tenth_mm/10},
            scope:row.owned_copy_id===null?'collection' as const:'copy' as const,
            component:{status,...(name?{name}:{})},products:productsBySize.get(row.size_id)??[],
            applications:status==='physical_card'?applications.filter(a=>a.requirement_id===row.id).map(a=>{
                if(!integer(a.quantity_sheets,1)||!integer(a.copy_number,1))throw new PublicCollectionError(503,'PUBLIC_COLLECTION_UNAVAILABLE');
                return {copyNumber:a.copy_number,quantity:a.quantity_sheets,product:a.product_name,brand:a.brand};
            }):[],
        };
    });
    return {
        source:'D1',ratingVisibility:'not_public',componentVerificationUnavailable:verificationUnavailable,
        collections:collectionRows.map(row=>{
            if(!integer(row.copy_count)||!integer(row.held_count))throw new PublicCollectionError(503,'PUBLIC_COLLECTION_UNAVAILABLE');
            return {id:row.id,name:row.display_name,status:row.acquisition_status,
                owned:collectionOwned(row.acquisition_status,row.legacy_owned),wishlist:row.wishlist===1,
                preordered:row.acquisition_status==='preordered',copyCount:row.copy_count,inCollectionCopyCount:row.held_count,
                versions:collectionVersions.get(row.id)??[]};
        }),
        requirements:publicRequirements,
    };
}

export async function handlePublicGameCollection(request:Request,bindings:{DB?:D1Database;PHYSICAL_COMPONENT_SIGNING_KEY?:unknown},key:string){
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(request.method!=='GET')return Response.json({success:false,error:{code:'METHOD_NOT_ALLOWED'}},{status:405,headers:{...headers,Allow:'GET'}});
    try{
        return Response.json({success:true,data:await readPublicGameCollection(bindings.DB,key,bindings.PHYSICAL_COMPONENT_SIGNING_KEY)},{headers});
    }catch(error){
        const status=error instanceof PublicCollectionError?error.status:503;
        const code=error instanceof PublicCollectionError?error.code:'PUBLIC_COLLECTION_UNAVAILABLE';
        return Response.json({success:false,error:{code}},{status,headers});
    }
}
