import { validateCreateNotBggGame } from './notbgg-validation';

type EditorLanguage = 'zh-TW' | 'en';

/** Presentation only: never changes form values, dispatches input events or calls an API. */
export function editorTime(raw: string, lang: EditorLanguage): HTMLTimeElement {
    const time = document.createElement('time');
    // D1 SQL timestamps have no suffix but are UTC; ISO timestamps retain their offset.
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw;
    const date = new Date(normalized);
    time.title = raw;
    time.dataset.rawTime = raw;
    if (Number.isNaN(date.getTime())) { time.textContent = raw; return time; }
    time.dateTime = date.toISOString();
    time.textContent = new Intl.DateTimeFormat(lang, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(date);
    return time;
}

export function initializeEditorPresentation(root: HTMLElement, lang: EditorLanguage) {
    const en = lang === 'en', text = (zh: string, english: string) => en ? english : zh;
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-section-link]'));
    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-section]'));
    const heading = root.querySelector<HTMLElement>('.editor-heading')!;
    let offset = 180, scheduled = false;
    let clickedSection: { section: HTMLElement; scrollY: number } | null = null;
    function refreshNavigation() {
        // History and editor tabs own visibility; the scroll tracker only marks section links.
        if (root.querySelector<HTMLElement>('[data-editor-panel="basic"]')?.hidden) return;
        offset = Math.ceil(heading.getBoundingClientRect().height) + 16;
        root.style.setProperty('--editor-scroll-offset', `${offset}px`);
        const visible = sections.filter(section => !section.hidden);
        if (clickedSection && (Math.abs(clickedSection.scrollY - window.scrollY) > 1 || !visible.includes(clickedSection.section))) clickedSection = null;
        const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
        const current = clickedSection?.section ?? (atBottom ? visible.at(-1) : [...visible].reverse().find(section => section.getBoundingClientRect().top <= offset + 8) ?? visible[0]);
        links.forEach(link => {
            if (link.dataset.sectionLink === current?.dataset.section) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });
    }
    function scheduleNavigation() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; refreshNavigation(); });
    }
    links.forEach(link => link.addEventListener('click', event => {
        const target = sections.find(section => section.dataset.section === link.dataset.sectionLink);
        if (!target || target.hidden) return;
        event.preventDefault();
        refreshNavigation();
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
        clickedSection = { section: target, scrollY: window.scrollY };
        refreshNavigation();
    }));
    window.addEventListener('scroll', scheduleNavigation, { passive: true });
    window.addEventListener('resize', scheduleNavigation);
    new ResizeObserver(scheduleNavigation).observe(heading);

    const previews = Array.from(root.querySelectorAll<HTMLElement>('[data-image-preview]')).map(widget => {
        const key = widget.dataset.imagePreview as 'imageUrl' | 'thumbnailUrl';
        const input = root.querySelector<HTMLInputElement>(`[name="${key}"]`)!;
        const frame = widget.querySelector<HTMLElement>('[data-preview-frame]')!;
        const status = widget.querySelector<HTMLElement>('[data-preview-status]')!;
        let generation = 0;
        function refresh() {
            const token = ++generation;
            frame.replaceChildren();
            widget.dataset.state = 'empty';
            if (!input.value.trim()) {
                status.textContent = text('尚未提供圖片網址。', 'No image URL provided.'); return;
            }
            let url: string | null;
            try {
                // Reuse the full existing URL rules (scheme, credentials, length and normalization).
                url = validateCreateNotBggGame({ name: 'Preview', type: 'boardgame', [key]: input.value })[key];
            } catch {
                widget.dataset.state = 'invalid';
                status.textContent = text('請填寫有效的 HTTP(S) 網址，不可包含帳號密碼。', 'Use a valid HTTP(S) URL without credentials.'); return;
            }
            if (!url) return;
            widget.dataset.state = 'loading';
            status.textContent = text('圖片載入中…', 'Loading image…');
            const image = document.createElement('img');
            image.alt = key === 'thumbnailUrl' ? text('縮圖預覽', 'Thumbnail preview') : text('圖片預覽', 'Image preview');
            image.referrerPolicy = 'no-referrer';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.addEventListener('load', () => {
                if (token !== generation) return;
                widget.dataset.state = 'loaded'; status.textContent = text('預覽已載入；圖片不會上傳。', 'Preview loaded; no image is uploaded.');
            });
            image.addEventListener('error', () => {
                if (token !== generation) return;
                frame.replaceChildren(); widget.dataset.state = 'failed';
                status.textContent = text('無法載入圖片，請確認網址及來源是否允許瀏覽器存取。', 'Unable to load the image. Check the URL and whether the source permits browser access.');
            });
            frame.appendChild(image);
            image.src = url;
        }
        widget.querySelector<HTMLButtonElement>('[data-preview-refresh]')!.addEventListener('click', refresh);
        input.addEventListener('change', refresh);
        refresh();
        return refresh;
    });
    refreshNavigation();
    return { refreshNavigation, refreshImages: () => previews.forEach(refresh => refresh()) };
}
