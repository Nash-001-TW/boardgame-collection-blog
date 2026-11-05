import { decodeHTMLStrict } from 'entities';
import type { BggCategoryRank } from './bgg-types';
/** Plain-text projection, not trusted HTML. Always render with text interpolation. */
export function descriptionParagraphs(source: string): string[] {
    return decodeHTMLStrict(source || '').replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
        .replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/?(?:p|div|li|ul|ol|h[1-6])\b[^>]*>/gi,'\n\n')
        .replace(/<!--[\s\S]*?-->/g,'').replace(/<\/?[A-Za-z][^>]*>/g,'').replace(/\r/g,'').split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
}
export function positiveNumber(value:number|undefined, digits=0):string {
    return value!==undefined&&Number.isFinite(value)&&value>0?value.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
}
export function numberRange(min:number,max:number):string {
    if(!(min>0)||!(max>=min))return '—';return min===max?String(min):`${min}–${max}`;
}
const ranks:Record<string,string>={cgs:'自訂構築類排名',thematic:'主題遊戲排名',strategygames:'策略遊戲排名',familygames:'家庭遊戲排名',partygames:'派對遊戲排名',abstracts:'抽象遊戲排名',wargames:'戰爭遊戲排名',childrensgames:'兒童遊戲排名'};
export function rankLabel(rank:BggCategoryRank,lang:'en'|'zh-TW'):string{return lang==='en'?rank.friendlyName:ranks[rank.name]??rank.friendlyName;}
