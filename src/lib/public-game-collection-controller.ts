function append(parent: Node, ...children: Node[]) { for (const child of children) parent.appendChild(child); }
import type { PublicGameCollection,PublicComponentStatus } from './public-game-collection';

function initializePublicCollection(root:HTMLElement){
    if(root.dataset.ready)return;
    root.dataset.ready='true';
    const en=root.dataset.lang==='en',t=(zh:string,english:string)=>en?english:zh;
    const collection=root.querySelector<HTMLElement>('[data-public-collection-body]')!;
    const requirements=root.querySelector<HTMLElement>('[data-public-requirements-body]')!;
    const error=root.querySelector<HTMLElement>('[data-public-data-error]')!;
    const retry=root.querySelector<HTMLButtonElement>('[data-public-data-retry]')!;
    const statuses:Record<string,string>={
        owned:t('已收藏','Owned'),preordered:t('預購','Preordered'),wishlist:t('願望清單狀態','Wishlist status'),
        not_owned:t('未持有','Not owned'),sold:t('已出售','Sold'),gifted_away:t('已送出','Gifted away'),unknown:t('狀態未知','Unknown status'),
    };
    const components:Record<PublicComponentStatus,string>={
        physical_card:t('已確認實體卡牌組件','Confirmed physical card component'),
        legacy_product:t('歷史商品來源','Legacy product source'),
        pending:t('待確認組件','Pending component verification'),
        unavailable:t('組件驗證不可用','Component verification unavailable'),
        unassigned:t('未指派組件','Unassigned component'),
    };
    const node=(tag:string,text:string,className?:string)=>{
        const element=document.createElement(tag);element.textContent=text;if(className)element.className=className;return element;
    };
    const number=(value:number)=>value.toLocaleString(en?'en':'zh-TW');

    function render(data:PublicGameCollection){
        collection.replaceChildren();
        append(collection,node('p',t('來源：已管理的正式收藏資料。','Source: managed production collection records.'),'public-data-note'));
        if(!data.collections.length)append(collection,node('p',t('尚無公開的收藏紀錄。','No public collection records.')));
        for(const item of data.collections){
            const article=document.createElement('article');article.dataset.publicCollectionId=String(item.id);
            append(article,node('h3',item.name+' · #'+item.id));
            const flags=[statuses[item.status]??statuses.unknown];
            if(item.owned&&item.status!=='owned')flags.push(t('已收藏','Owned'));
            if(item.wishlist)flags.push(t('願望清單','Wishlist'));
            if(item.preordered&&item.status!=='preordered')flags.push(t('預購','Preordered'));
            const badges=document.createElement('div');
            for(const flag of flags)append(badges,node('span',flag,'public-status'));
            append(article,badges,node('p',t('副本紀錄數：','Copy records: ')+number(item.copyCount)
                +' · '+t('在藏副本：','Copies in collection: ')+number(item.inCollectionCopyCount)));
            if(item.versions.length){
                const list=document.createElement('ul');
                for(const version of item.versions)append(list,node('li',
                    (version.language??t('語言未記錄','Language not recorded'))+' · '
                    +(version.edition??t('版本未記錄','Edition not recorded'))+' · '+number(version.count)+t(' 份',' copies')));
                append(article,list);
            }else append(article,node('p',t('尚無副本語言與版本紀錄。','No copy language or edition records.'),'public-data-note'));
            append(collection,article);
        }
        append(collection,node('p',t('個人評分未公開。','Personal ratings are not public.'),'public-data-note'));

        requirements.replaceChildren();
        append(requirements,node('p',t('來源：D1 卡套需求，依收藏及副本逐筆列示。','Source: D1 sleeve requirements, listed by collection and copy.'),'public-data-note'));
        if(!data.requirements.length)append(requirements,node('p',t('尚無已管理的卡套需求。','No managed sleeve requirements.')));
        if(data.componentVerificationUnavailable)append(requirements,node('p',
            t('需求已載入，完整組件證據目前無法驗證。','Requirements loaded; complete component evidence could not be verified.'),'public-data-note'));
        for(const item of data.requirements){
            const article=document.createElement('article');article.dataset.publicRequirementId=String(item.id);
            append(article,node('h3',item.size.widthMm+' × '+item.size.heightMm+' mm · '+number(item.quantity)+t(' 張',' sleeves')));
            append(article,node('p',item.collectionName+' · '+(item.scope==='copy'?t('指定副本需求','Copy-specific requirement'):t('收藏層級需求','Collection-level requirement'))));
            append(article,node('span',components[item.component.status],'public-status'));
            if(item.component.status==='physical_card'&&item.component.name)append(article,node('p',item.component.name));
            append(article,node('h4',t('實際使用產品','Actual products used')));
            if(!item.applications.length)append(article,node('p',t('尚無可驗證的逐副本套用紀錄。','No verifiable copy application records.'),'public-data-note'));
            for(const applied of item.applications)append(article,node('p',t('副本','Copy')+' '+applied.copyNumber+' · '+[applied.brand,applied.product].filter(Boolean).join(' ')+' · '+number(applied.quantity)+t(' 張',' sleeves')));
            if(item.products.length){
                const details=document.createElement('details');
                append(details,node('summary',t('同尺寸產品參考（未指定使用產品）','Products with the same size (no product assignment)')));
                const list=document.createElement('ul');
                for(const product of item.products)append(list,node('li',
                    [product.brand,product.name,number(product.sheetsPerPack)+t(' 張／包',' sleeves/pack'),
                        product.thicknessMicrons===null?null:product.thicknessMicrons+' µm'].filter(Boolean).join(' · ')));
                append(details,list);append(article,details);
            }else append(article,node('p',t('尚無已登錄的同尺寸啟用產品。','No active products recorded for this size.'),'public-data-note'));
            append(requirements,article);
        }
        append(requirements,node('p',t('張數為需求紀錄，不是庫存餘額。同尺寸產品只供規格參考。','Quantities are requirement records. Same-size products are specification references.'),'public-data-note'));
    }
    let loading=false;
    async function load(){
        if(loading)return;loading=true;retry.disabled=true;
        error.hidden=true;retry.hidden=true;
        collection.replaceChildren(node('p',t('正在載入收藏資料…','Loading collection records…')));
        requirements.replaceChildren(node('p',t('正在載入已管理的卡套需求…','Loading managed sleeve requirements…')));
        try{
            const response=await fetch('/api/public/collection/'+encodeURIComponent(root.dataset.gameKey!),{cache:'no-store'});
            const result=await response.json() as {success?:boolean;data?:PublicGameCollection};
            if(!response.ok||result.success!==true||!result.data)throw new Error('Unavailable');
            if(root.isConnected)render(result.data);
        }catch{
            if(root.isConnected){
                collection.replaceChildren(node('p',t('收藏資料暫時無法載入。','Collection data could not be loaded.')));
                requirements.replaceChildren(node('p',t('卡套需求暫時無法載入。','Sleeve requirements could not be loaded.')));
                error.textContent=t('查詢失敗，請稍後重試。','The query failed. Please retry.');
                error.hidden=false;retry.hidden=false;
            }
        }finally{loading=false;retry.disabled=false;}
    }
    retry.addEventListener('click',()=>void load());
    root.addEventListener('public-data-refresh',()=>void load());
    void load();
}
function initialize(){
    document.querySelectorAll<HTMLElement>('[data-public-game-collection]').forEach(initializePublicCollection);
}
initialize();
document.addEventListener('astro:page-load',initialize);
window.addEventListener('pageshow',event=>{
    if(event.persisted)document.querySelectorAll('[data-public-game-collection]').forEach(root=>root.dispatchEvent(new Event('public-data-refresh')));
});
