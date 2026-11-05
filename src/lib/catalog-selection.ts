import { getEffectiveBrowserFilter,readBrowserUrl,type BrowserUrlState } from './game-browser-url';
import { browserCapabilities } from './game-browser-capabilities';
import { matchesCatalogSearch,matchesPlayingTime,validCatalogStatistic } from './catalog-browsing';
import { validGameComplexity } from './game-complexity';
import { accessoryCategories } from './notbgg-contract';
type Entry={dataset:Record<string,string|undefined>};
/** Same compact metadata selection on SSR and in the browser; collection behavior is separate. */
export function readCatalogUrl(url:URL,mechanics:Record<string,string>):BrowserUrlState {
 const capabilities=browserCapabilities.games;
 const state=readBrowserUrl(url,{...capabilities,defaultSort:'name-asc',players:['','1','2','3','4','5','6plus'],times:['','30','31-60','61-120','over120','60','90','120'],weights:['','1-2','2-3','3-4','4-5'],mechanics:['',...Object.keys(mechanics)],mechanicTags:[],categories:[],accessories:['',...accessoryCategories]});
 if(state.accessory){state.filter='accessory';state.filterExplicit=true;}
 return state;
}
function numeric(entry:Entry,key:string):number|null {
 const raw=entry.dataset[key];if(!raw?.trim())return null;
 const value=Number(raw);if(!Number.isFinite(value))return null;
 if(key==='year')return validCatalogStatistic(value,'year');
 if(key==='bggRating')return validCatalogStatistic(value,'rating');
 if(key==='weight')return validGameComplexity(value);
 return value>0?value:null;
}
export function selectCatalogEntries<T extends Entry>(entries:readonly T[],state:BrowserUrlState,locale:string):T[] {
 const filter=getEffectiveBrowserFilter(state,true),collator=new Intl.Collator(locale,{numeric:true,sensitivity:'base'});
 const selected=entries.filter(entry=>{
  const d=entry.dataset;
  if(filter!=='all'&&d.itemType!==filter)return false;
  if(!matchesCatalogSearch(d,state.q))return false;
  if(state.accessory&&!(d.accessoryCategories??'').split(',').includes(state.accessory))return false;
  if(state.mechanic&&!(d.mechanics??'').split(',').includes(state.mechanic))return false;
  if(state.players){const min=numeric(entry,'minPlayers'),max=numeric(entry,'maxPlayers');if(min===null||max===null)return false;if(state.players==='6plus'?max<6:Number(state.players)<min||Number(state.players)>max)return false;}
  if(state.time&&!matchesPlayingTime(numeric(entry,'maxTime'),state.time))return false;
  if(state.weight){const value=numeric(entry,'weight'),[min,max]=state.weight.split('-').map(Number);if(value===null||value<min||(max===5?value>max:value>=max))return false;}
  return true;
 });
 return selected.sort((a,b)=>{
  let result=0;
  const field=state.sort.startsWith('year-')?'year':state.sort==='bgg-rating-desc'?'bggRating':state.sort==='weight-desc'?'weight':null;
  if(field){const x=numeric(a,field),y=numeric(b,field);result=x===null?(y===null?0:1):y===null?-1:state.sort==='year-asc'?x-y:y-x;}
  else result=state.sort==='name-desc'?collator.compare(b.dataset.name??'',a.dataset.name??''):collator.compare(a.dataset.name??'',b.dataset.name??'');
  return result||collator.compare(a.dataset.name??'',b.dataset.name??'')||collator.compare(a.dataset.catalogKey??a.dataset.bggId??'',b.dataset.catalogKey??b.dataset.bggId??'');
 });
}
