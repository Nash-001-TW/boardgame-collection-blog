import { collectionPickerOutcome, collectionPickerRequests, collectionPickerStatus, mergeCollectionPickerPages } from './collection-picker';

const timeoutMs = 10_000;

function mountPicker(root: HTMLElement) {
    const form = root.querySelector('form')!;
    const input = root.querySelector<HTMLInputElement>('input[type="search"]')!;
    const results = root.querySelector('[data-picker-results]')!;
    const status = root.querySelector<HTMLElement>('[data-picker-status]')!;
    const pagination = root.querySelector<HTMLElement>('[data-picker-pagination]')!;
    const previous = root.querySelector<HTMLButtonElement>('[data-picker-previous]')!;
    const next = root.querySelector<HTMLButtonElement>('[data-picker-next]')!;
    const en = root.dataset.lang === 'en';
    let pending: AbortController | undefined;
    let query = '';
    let cursors = [0];
    let pageIndex = 0;

    async function search(targetIndex: number, cursor: number) {
        pending?.abort();
        const controller = new AbortController();
        pending = controller;
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);
        results.replaceChildren();
        status.textContent = root.dataset.loading ?? '';
        previous.disabled = next.disabled = true;

        try {
            const pages = await Promise.all(collectionPickerRequests(query, cursor).map(async request => {
                const response = await fetch(request.url, { signal: controller.signal });
                return { request, page: collectionPickerOutcome(response.ok, response.ok ? await response.json() : null) };
            }));
            const page = mergeCollectionPickerPages(pages);
            if (pending !== controller) return;
            pageIndex = targetIndex;
            cursors = cursors.slice(0, pageIndex);
            cursors.push(cursor);
            if (page.nextCursor !== null) cursors.push(page.nextCursor);

            for (const row of page.rows) {
                const item = document.createElement('li');
                const link = document.createElement('a');
                link.className = 'picker-row';
                link.href = '?' + new URLSearchParams({ collection: String(row.id), lang: en ? 'en' : 'zh-TW' });
                const info = document.createElement('span');
                const name = document.createElement('strong');
                name.textContent = row.name;
                const meta = document.createElement('span');
                meta.className = 'picker-meta';
                meta.textContent = [
                    '#' + row.id, row.source ?? root.dataset.noSource,
                    ...row.bases.map(basis => basis === 'collection' ? root.dataset.byCollection : root.dataset.byBgg),
                ].join(' · ');
                info.appendChild(name);
                info.appendChild(meta);
                const badges = document.createElement('span');
                for (const value of row.archived ? [row.status, 'archived'] : [row.status]) {
                    const badge = document.createElement('span');
                    badge.className = 'picker-badge';
                    badge.dataset.status = value;
                    badge.textContent = collectionPickerStatus(value, en);
                    badges.appendChild(badge);
                }
                link.appendChild(info);
                link.appendChild(badges);
                item.appendChild(link);
                results.appendChild(item);
            }
            status.textContent = page.rows.length || page.nextCursor !== null ? '' : root.dataset.empty ?? '';
            previous.disabled = pageIndex === 0;
            next.disabled = page.nextCursor === null;
            pagination.hidden = previous.disabled && next.disabled;
        } catch (error) {
            if (pending !== controller) return;
            // Log only the error kind; the user sees "temporarily unavailable", never "not found".
            console.warn('Collection picker search failed', error instanceof Error ? error.name : typeof error);
            status.textContent = root.dataset.unavailable ?? '';
            previous.disabled = pageIndex === 0;
            next.disabled = cursors[pageIndex + 1] === undefined;
            pagination.hidden = previous.disabled && next.disabled;
        } finally {
            window.clearTimeout(timer);
            controller.abort();
        }
    }

    function startSearch() {
        query = input.value;
        cursors = [0];
        pageIndex = 0;
        pagination.hidden = true;
        void search(0, 0);
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        const url = new URL(location.href);
        url.searchParams.delete('collection');
        url.searchParams.set('q', input.value);
        history.replaceState(history.state, '', url);
        startSearch();
    });
    previous.addEventListener('click', () => void search(pageIndex - 1, cursors[pageIndex - 1]));
    next.addEventListener('click', () => void search(pageIndex + 1, cursors[pageIndex + 1]));
    if (new URL(location.href).searchParams.has('q')) startSearch();
}

const picker = document.querySelector<HTMLElement>('[data-collection-picker]');
if (picker) mountPicker(picker);
