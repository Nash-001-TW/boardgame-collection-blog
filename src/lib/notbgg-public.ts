import {publicIdentityIndex,resolvePublicIdentity,type IdentityIndex} from "./identity-resolution";
import type { Game } from './game-catalog';
import type { CatalogRecord } from './catalog-payload';
import { buildCatalogPayload } from './catalog-payload';
import { formatNotBggId, isNotBggId, deserializeGameRef } from './game-identity';
import type { NotBggId } from './game-identity';
import { notBggGameViewModel, type GameViewModel, type NotBggViewSource } from './game-view-model';
import { validateCreateNotBggGame } from './notbgg-validation';
import { catalogTypeLabels } from './game-content';
import { catalogRange } from './catalog-browsing';
import { publicAccessoryLabels } from '../i18n/accessory-categories';
import { translateGameName } from '../i18n/utils';

export class PublicNotBggUnavailable extends Error { constructor() { super('Public NotBGG data is unavailable'); } }
type Row = Record<string, unknown> & { seq: number; accessory_json: string };
// Active original profiles are public; D6 resolves confirmed identities separately.
const eligible = (alias: string) => `${alias}.archived_at IS NULL`;
const cats = `WITH cats AS (SELECT seq,json_group_array(category) AS accessory_json FROM
    (SELECT seq,category FROM notbgg_accessory_categories ORDER BY seq,category) GROUP BY seq)`;
// SQL whitelists deliberately never SELECT n.* or any admin/audit/system metadata.
const compactFields = { name:'name',type:'type',alternateNames:'alternate_names_json',yearPublished:'year_published',
    minPlayers:'min_players',maxPlayers:'max_players',minPlaytime:'min_playtime',maxPlaytime:'max_playtime',mechanics:'mechanics_json',imageUrl:'image_url',thumbnailUrl:'thumbnail_url' } as const;
const detailFields = { ...compactFields,description:'description',minAge:'min_age',minPlaytime:'min_playtime',recommendedPlayers:'recommended_players_json',
    designers:'designers_json',artists:'artists_json',publishers:'publishers_json',categories:'categories_json',families:'families_json',referenceUrls:'reference_urls_json',contents:'contents' } as const;
function source(row: Row, fields: Record<string,string>): NotBggViewSource {
    const input: Record<string,unknown> = {};
    for (const [field,column] of Object.entries(fields)) input[field] = column.endsWith('_json') && row[column] !== null ? JSON.parse(String(row[column])) : row[column];
    input.accessoryCategories = JSON.parse(row.accessory_json);
    // This null is a validator default, not an admin-column read. Never return it.
    const { editorNotes: _private, ...safe } = validateCreateNotBggGame(input);
    return { ...safe, notBggId: formatNotBggId(row.seq) };
}
const selection = (fields: Record<string,string>) => 'n.seq,' + [...new Set(Object.values(fields))].map(column=>'n.'+column).join(',') + ",COALESCE(cats.accessory_json,'[]') AS accessory_json";
export interface PublicRelatedGame { key:string; name:string; href:string; thumbnail:string|null; relationType?:'accessory_for'|'compatible_with'; originalKey?:string }
export interface PublicNotBggDetail { game:GameViewModel; related:PublicRelatedGame[] }

export class PublicNotBggReader {
    constructor(private readonly db: D1Database | undefined) {}
    async catalog(lang: 'en'|'zh-TW'): Promise<{records:CatalogRecord[];mechanics:Record<string,string>}> {
        if (!this.db) throw new PublicNotBggUnavailable();
        try {
            const result = await this.db.prepare(`${cats} SELECT ${selection(compactFields)} FROM notbgg_games n LEFT JOIN cats ON cats.seq=n.seq WHERE ${eligible('n')} ORDER BY n.seq`).all<Row>();
            const mechanics: Record<string,string> = {};
            const records = result.results.map(row => {
                const vm = notBggGameViewModel(source(row,compactFields),lang);
                const localMechanics = vm.mechanics.map(term => { const key='notbgg:'+encodeURIComponent(term.name.normalize('NFC').toLowerCase()); mechanics[key]=term.name+(lang==='en'?' (custom)':'（自建）'); return key; });
                return {dataset:{catalogKey:vm.key,source:'notbgg',bggId:'',notBggId:vm.key,identityLabel:vm.key,name:vm.name,
                    searchNames:vm.alternateNames.join(' '),itemType:vm.type,year:vm.yearPublished===null?'':String(vm.yearPublished),
                    bggRating:'',weight:'',minPlayers:vm.play?.minPlayers==null?'':String(vm.play.minPlayers),maxPlayers:vm.play?.maxPlayers==null?'':String(vm.play.maxPlayers),
                    maxTime:vm.play?.maxPlaytime==null?'':String(vm.play.maxPlaytime),mechanics:localMechanics.join(','),
                    accessoryCategories:vm.accessory?.categories.join(',')??'',accessoryLabel:vm.accessory?.categories.map(c=>publicAccessoryLabels[c][lang==='en'?1:0]).join(' · ')??''},
                    href:vm.href??'',image:vm.images.catalog??'',fallback:vm.images.fallback??'',expansions:0,
                    typeLabel:catalogTypeLabels[vm.type][lang==='en'?1:0],players:catalogRange(vm.play?.minPlayers??undefined,vm.play?.maxPlayers??undefined),
                    time:catalogRange(vm.play?.minPlaytime??undefined,vm.play?.maxPlaytime??undefined),rating:'—',signals:[]} satisfies CatalogRecord;
            });
            return {records,mechanics};
        } catch { throw new PublicNotBggUnavailable(); }
    }
    async detail(id: NotBggId, bggGames: Game[], lang:'en'|'zh-TW',identityIndex?:IdentityIndex): Promise<PublicNotBggDetail|null> {
        if (!isNotBggId(id)) return null;
        if (!this.db) throw new PublicNotBggUnavailable();
        try {
            const seq=Number(id.slice(7));
            const row = await this.db.prepare(`${cats} SELECT ${selection(detailFields)} FROM notbgg_games n LEFT JOIN cats ON cats.seq=n.seq WHERE n.seq=? AND ${eligible('n')}`).bind(seq).first<Row>();
            if (!row) return null;
            const game = notBggGameViewModel(source(row,detailFields),lang);
            const related: PublicRelatedGame[] = [];
            if (game.type==='accessory') {
                const targets = await this.db.prepare(`SELECT r.relation_type,g.bgg_id,target.seq,target.name,target.thumbnail_url,target.image_url
                    FROM site_game_relations r JOIN notbgg_games owner ON owner.game_id=r.source_game_id
                    JOIN v2_games g ON g.id=r.target_game_id LEFT JOIN notbgg_games target ON target.game_id=g.id
                    WHERE owner.seq=? AND ${eligible('owner')} AND r.archived_at IS NULL AND
                    (g.bgg_id IS NOT NULL OR (target.seq IS NOT NULL AND ${eligible('target')})) ORDER BY r.id`).bind(seq).all<{relation_type:'accessory_for'|'compatible_with';bgg_id:number|null;seq:number|null;name:string|null;thumbnail_url:string|null;image_url:string|null}>();
                const bggIndex=new Map(bggGames.filter(g=>g.bgg).map(g=>[g.bggId,g]));
                for (const target of targets.results) {
                    if(target.bgg_id!==null){const bgg=bggIndex.get(target.bgg_id);if(!bgg)continue;
                        related.push({relationType:target.relation_type,key:`BGG:${bgg.bggId}`,name:translateGameName(bgg.bggId,bgg.name,lang),href:`${lang==='en'?'/en':''}/games/${encodeURIComponent(bgg.slug)}`,thumbnail:safeImage(bgg.bgg?.thumbnail)});
                    }else if(target.seq!==null){const ref=formatNotBggId(target.seq);related.push({relationType:target.relation_type,key:ref,name:target.name??ref,href:`${lang==='en'?'/en':''}/games/notbgg/${ref.slice(7)}`,thumbnail:safeImage(target.thumbnail_url||target.image_url)});}
                }
            }
            const index=identityIndex??(related.length?await publicIdentityIndex(this.db,bggGames):null);
            const resolved=index?related.map(target=>{const identity=resolvePublicIdentity(deserializeGameRef(target.key),index,bggGames,lang);return identity?{...target,key:identity.key,originalKey:target.key,name:identity.name,href:identity.href,thumbnail:safeImage(identity.image)}:target;}):related;
            return {game:game.accessory?{...game,accessory:{...game.accessory,relatedGames:resolved.map(target=>deserializeGameRef(target.originalKey??target.key))}}:game,related:resolved};
        } catch { throw new PublicNotBggUnavailable(); }
    }
}
/** Shared by the actual SSR routes and isolated browser harness. Never redirects to an unverified target. */
export async function resolveNotBggPage(db:D1Database|undefined,id:NotBggId,games:Game[],lang:'en'|'zh-TW'){
    if(!isNotBggId(id))return {detail:null,identity:null,redirect:null};
    if(!db)throw new PublicNotBggUnavailable();
    const index=await publicIdentityIndex(db,games),identity=index.byNotBgg.get(id)??null;
    if(identity?.primarySource==='bgg'){
        const target=games.find(g=>g.bggId===identity.bggId&&g.bgg)!;
        return {detail:null,identity,redirect:`${lang==='en'?'/en':''}/games/${encodeURIComponent(target.slug)}`};
    }
    return {detail:await new PublicNotBggReader(db).detail(id,games,lang,index),identity,redirect:null};
}
export function safeImage(value: string|null|undefined): string|null {
    if(!value)return null;
    try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
/** Never silently imply that an unavailable D1 means there are zero NotBGG records. */
export async function loadPublicCatalog(bggGames: Game[], db:D1Database|undefined,lang:'en'|'zh-TW') {
    const payload=buildCatalogPayload(bggGames,lang);
    try{
        if(!db)throw new PublicNotBggUnavailable();
        const [custom,index]=await Promise.all([new PublicNotBggReader(db).catalog(lang),publicIdentityIndex(db,bggGames)]);
        const all=[...payload.records,...custom.records],hidden=new Set<string>(),byKey=new Map(all.map(r=>[r.dataset.catalogKey,r]));
        for(const link of index.byNotBgg.values()){
            const bgg=byKey.get(`BGG:${link.bggId}`),original=byKey.get(link.notBggId);
            if(!bgg||!original)continue;
            const main=link.primarySource==='bgg'?bgg:original,other=link.primarySource==='bgg'?original:bgg;
            hidden.add(other.dataset.catalogKey);
            main.dataset={...main.dataset,catalogKey:link.notBggId,bggId:String(link.bggId),notBggId:link.notBggId,identityLabel:`BGG #${link.bggId} · ${link.notBggId}`,searchNames:[main.dataset.searchNames,bgg.dataset.name,bgg.dataset.originalName,original.dataset.name,original.dataset.searchNames].filter(Boolean).join(' ')};
        }
        // Filter using source identities, since the selected card's stable key is now the group key.
        const records=all.filter(r=>!hidden.has(r.dataset.source==='bgg'?`BGG:${r.dataset.bggId}`:r.dataset.notBggId));
        return {payload:{records,mechanics:{...payload.mechanics,...custom.mechanics}},notBggAvailable:true};
    }
    catch{return {payload,notBggAvailable:false};}
}
