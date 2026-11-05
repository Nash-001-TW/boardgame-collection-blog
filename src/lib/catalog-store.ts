import type { CatalogRecord } from './catalog-payload';
export interface BrowserEntry { dataset: Record<string,string|undefined>; }
/** Full-catalog metadata stays as plain objects. Only visible entries become elements. */
export function createCatalogStore(root: HTMLElement, grid: HTMLElement) {
    const source=root.querySelector<HTMLScriptElement>('[data-catalog-payload]');
    const template=root.querySelector<HTMLTemplateElement>('[data-catalog-card-template]');
    if(!source||!template) return null; // legacy collection/card fixtures keep their existing path
    const payload=JSON.parse(source.textContent??'') as {records:CatalogRecord[];mechanics:Record<string,string>};
    source.remove();
    let rendered=new Map(Array.from(grid.querySelectorAll<HTMLElement>('[data-game-card]')).map(c=>[c.dataset.catalogKey??c.dataset.bggId!,c]));
    const zh=root.dataset.locale!=='en';
    function materialize(record: CatalogRecord):HTMLElement {
        let card=rendered.get(record.dataset.catalogKey??record.dataset.bggId);
        const created=!card;
        if(!card){
            card=template!.content.firstElementChild!.cloneNode(true) as HTMLElement;
            const link=card.querySelector<HTMLElement>('.game-link')!;
            if(record.href) {const anchor=document.createElement('a');anchor.className=link.className;anchor.href=record.href;for(const child of Array.from(link.childNodes))anchor.appendChild(child);link.replaceWith(anchor);}
            card.querySelector('h2')!.textContent=record.dataset.name;
            const expansion=card.querySelector<HTMLElement>('.expansion-count')!;
            expansion.hidden=record.expansions===0;
            expansion.textContent=zh?`擴充 ${record.expansions}`:`Expansions ${record.expansions}`;
            card.querySelector('.game-type')!.textContent=record.typeLabel;
            card.querySelector('[data-catalog-id]')!.textContent=record.dataset.identityLabel??`BGG #${record.dataset.bggId}`;
            for(const [key,text] of Object.entries({year:record.dataset.year||'—',players:record.players,time:record.time,rating:record.rating})) card.querySelector(`[data-fact-${key}]`)!.textContent=text;
            const accessory=card.querySelector<HTMLElement>('[data-accessory-label]')!;
            accessory.textContent=record.dataset.accessoryLabel??'';accessory.hidden=!record.dataset.accessoryLabel;
            card.querySelectorAll<HTMLElement>('[data-play-fact]').forEach(el=>el.hidden=record.dataset.itemType==='accessory');
            card.querySelectorAll<HTMLElement>('[data-bgg-fact]').forEach(el=>el.hidden=record.dataset.source==='notbgg'||record.dataset.itemType==='accessory');
            const signals=card.querySelector('.catalog-signals')!;
            for(const s of record.signals){const li=document.createElement('li');li.dataset.signalKind=s.kind;li.title=s.title;li.textContent=s.label;signals.appendChild(li);}
            rendered.set(record.dataset.catalogKey??record.dataset.bggId,card);
        }
        Object.assign(card.dataset,record.dataset,{imageSrc:record.image,imageFallback:record.fallback,imageAlt:record.dataset.name,imageErrorLabel:zh?'圖片無法載入':'Image unavailable'});
        const placeholder=card.querySelector('[data-image-placeholder]')!;
        if(created)placeholder.textContent=record.image?(zh?'封面載入中…':'Loading cover…'):(zh?'暫無封面':'No cover available');
        return card;
    }
    return { entries:payload.records, mechanics:payload.mechanics,
        prepare(entries:BrowserEntry[]){return entries.map(e=>materialize(e as CatalogRecord));},
        commit(cards:HTMLElement[]){rendered=new Map(cards.map(c=>[c.dataset.catalogKey??c.dataset.bggId!,c]));}
    };
}
