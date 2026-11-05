import type { Game } from './game-catalog';
import { getGameSignals, getCatalogGameType, catalogTypeLabels } from './game-content';
import { getKnownExpansionCounts, validCatalogStatistic, catalogRange } from './catalog-browsing';
import { translateGameName, translateBggMechanic } from '../i18n/utils';
import { decodeGameName } from './game-name';
import { validGameComplexity } from './game-complexity';
export interface CatalogRecord {
    dataset: Record<string,string>;
    href: string;
    image: string;
    fallback: string;
    expansions: number;
    typeLabel: string;
    players: string;
    time: string;
    rating: string;
    signals: {kind:string;title:string;label:string}[];
}
export function buildCatalogPayload(games: Game[], lang: 'en'|'zh-TW') {
    const mechanics: Record<string,string> = {};
    const counts=getKnownExpansionCounts(games);
    const records: CatalogRecord[]=games.map(game=>{
        const b=game.bgg, type=getCatalogGameType(b?.gameType);
        for(const m of b?.mechanics??[]) mechanics[m.id]=translateBggMechanic(m,lang);
        const name=translateGameName(game.bggId,game.name,lang), original=decodeGameName(game.name);
        return {dataset:{catalogKey:`BGG:${game.bggId}`,source:"bgg",identityLabel:`BGG #${game.bggId}`,bggId:String(game.bggId),name,...(original!==name?{originalName:original}:{}),itemType:type,
            year:String(validCatalogStatistic(b?.year,'year')??''),bggRating:String(validCatalogStatistic(b?.averageRating,'rating')??''),weight:String(validGameComplexity(b?.averageWeight)??''),
            minPlayers:String(b?.minPlayers??''),maxPlayers:String(b?.maxPlayers??''),maxTime:String(b?.maxPlayTime??''),
            mechanics:(b?.mechanics??[]).map(m=>m.id).join(',')},
            href:b?`${lang==='en'?'/en':''}/games/${encodeURIComponent(game.slug)}`:'',
            image:b?.thumbnail||b?.image||'',fallback:b?.image!== (b?.thumbnail||b?.image)?b?.image||'':'',expansions:counts.get(game.bggId)??0,
            typeLabel:catalogTypeLabels[type][lang==='en'?1:0],players:catalogRange(b?.minPlayers,b?.maxPlayers),
            time:catalogRange(b?.minPlayTime,b?.maxPlayTime),rating:validCatalogStatistic(b?.averageRating,'rating')?.toFixed(1)??'—',
            signals:getGameSignals(b).slice(0,2).map(s=>({kind:s.kind,title:`${s.source==='family'?'BGG Family':lang==='en'?'Name hint':'名稱線索'}: ${s.value}`,label:s.kind==='crowdfunding-family'?s.value.replace(/^Crowdfunding:\s*/i,''):s.value}))};
    });
    return {records,mechanics};
}
