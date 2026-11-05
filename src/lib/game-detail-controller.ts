/** UI-only lifecycle for the detail page; no catalog or personal data writes. */
export function initializeGameDetail(root: HTMLElement): void {
    if (root.dataset.ready) return;
    root.dataset.ready = 'true';
    root.querySelectorAll<HTMLAnchorElement>('.section-nav a').forEach(link => {
        link.addEventListener('click', event => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            const section = root.querySelector<HTMLElement>(link.hash);
            if (!section) return;
            event.preventDefault();
            section.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
            // Section navigation must not strand the list-return action in hash history.
            try { history.replaceState(history.state, '', link.hash); } catch { /* Scrolling still works. */ }
        });
    });
    const dialog = root.querySelector<HTMLDialogElement>('[data-cover-dialog]');
    const coverButton=root.querySelector<HTMLButtonElement>('[data-cover-open]');
    const coverImage=coverButton?.querySelector('img');
    if(coverImage){
        const failed=()=>{const blank=document.createElement('div');blank.className='no-cover';blank.textContent=coverButton!.dataset.coverErrorLabel??'Image unavailable';coverButton!.replaceWith(blank);dialog?.remove();};
        coverImage.addEventListener('error',failed,{once:true});
        if(coverImage.complete&&coverImage.naturalWidth===0)failed();
    }
    coverButton?.addEventListener('click', () => {
        const image=dialog?.querySelector<HTMLImageElement>('[data-dialog-cover]');
        if(image?.dataset.src&&!image.getAttribute('src'))image.src=image.dataset.src;
        dialog?.showModal();
    });
    root.querySelector('[data-cover-close]')?.addEventListener('click', () => dialog?.close());
    dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    const back = root.querySelector<HTMLAnchorElement>('[data-detail-back]');
    if (!back) return;
    try {
        const ref = new URL(document.referrer);
        if (ref.origin !== location.origin || !/^\/(en\/)?games\/?$/.test(ref.pathname)) return;
        back.href = ref.pathname + ref.search + ref.hash;
        back.addEventListener('click', event => {
            if (history.length > 1 && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                history.back();
            }
        });
    } catch { /* Direct visits keep the normal localized list link. */ }
}
