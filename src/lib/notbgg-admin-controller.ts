import { adminFieldGroups, accessoryLabels } from './notbgg-admin-fields';
import { deserializeGameRef, serializeGameRef } from './game-identity';
import { validateCreateNotBggGame, NotBggValidationError } from './notbgg-validation';
import type { NotBggGame, NotBggEditableFields } from './notbgg-contract';

class ApiFailure extends Error {
    constructor(public status: number, public code: string, public field?: string) { super(code); }
}
export function initializeNotBggAdmin(root: HTMLElement) {
    if (root.dataset.ready) return; root.dataset.ready = 'true';
    const en = root.dataset.lang === 'en', li = en ? 1 : 0, t = (zh: string, english: string) => en ? english : zh;
    const status = root.querySelector<HTMLElement>('[data-status]')!;
    const suffix = en ? '?lang=en' : '';
    function message(text: string, focus = false) { status.textContent = text; if (focus) status.focus(); }
    const typeName = (type: string) => type === 'boardgame' ? t('本體', 'Base game') : type === 'boardgameexpansion' ? t('擴充', 'Expansion') : t('配件', 'Accessory');
    const categoryNames = (items: string[]) => items.map(item => accessoryLabels[item as keyof typeof accessoryLabels]?.[li] ?? item).join(' · ') || '—';
    async function api(path: string, method = 'GET', body?: unknown, key?: string): Promise<any> {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['X-NotBGG-Request'] = '1'; }
        if (key) headers['Idempotency-Key'] = key;
        let response: Response;
        try { response = await fetch('/api/admin/notbgg' + path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) }); }
        catch { throw new ApiFailure(0, 'NETWORK'); }
        const result = await response.json().catch(() => ({})) as {success?:boolean; data?:any; error?:{code?:string;field?:string}};
        if (!response.ok || !result.success) throw new ApiFailure(response.status, result.error?.code ?? `HTTP_${response.status}`, result.error?.field);
        return result.data;
    }
    function errorMessage(error: unknown) {
        const code = error instanceof ApiFailure ? error.code : '';
        if(code==='LINKED_TYPE_CHANGE')return t('請先解除有效身份對應，再修改遊戲類型。','Revoke the active identity mapping before changing the game type.');
        if (['CONFLICT', 'REVISION_CONFLICT'].includes(code)) return t('資料已被其他操作修改。你的輸入已保留，請重新載入最新資料後再編輯。', 'Another operation changed this record. Your input is retained. Reload the latest data before editing again.');
        if (code === 'IDEMPOTENCY_CONFLICT') return t('此新增請求已對應其他內容，未新增第二筆。請先確認原新增結果。', 'This creation request already belongs to different content. No second record was created. Check the original result.');
        if (code === 'INVALID_REFERENCE') return t('適用遊戲尚未登記、已封存或引用自己；未建立假遊戲。BGG ID 必須已存在於內部遊戲身份資料。', 'A related game is unregistered, archived or references itself. No game was invented. BGG IDs must already exist in the internal registry.');
        if (code === 'RATE_LIMITED') return t('請求過於頻繁，請稍後重試。', 'Too many requests. Try again later.');
        if (['INVALID_QUERY', 'INVALID_ARGUMENT', 'INVALID_ID'].includes(code)) return t('請檢查查詢條件與完整 NotBGG ID 格式。', 'Check the search criteria and the full NotBGG ID format.');
        if (code === 'NETWORK') return t('網路中斷。輸入與新增請求識別仍保留，可重試相同內容。', 'Network interrupted. Input and creation request identity are retained; retry the same content.');
        if (error instanceof ApiFailure && [401, 403].includes(error.status)) return t('需要有效的管理員登入或請求驗證。請重新登入。', 'A valid administrator session and request verification are required. Sign in again.');
        if (code === 'NOT_FOUND' || error instanceof ApiFailure && error.status === 404) return t('找不到這筆遊戲。', 'Game not found.');
        if (code === 'ARCHIVED') return t('遊戲已封存，不可修改。', 'The game is archived and cannot be edited.');
        if (error instanceof NotBggValidationError || code === 'VALIDATION') return t('請檢查標示的欄位：格式、長度、數值範圍與配件分類。', 'Check the marked field: format, length, numeric bounds and accessory categories.');
        if (error instanceof ApiFailure && error.status === 413) return t('內容過大，請縮短後重試。', 'Content is too large. Shorten it and retry.');
        return t('操作失敗，資料未確認儲存。請保留輸入並稍後重試。', 'The operation could not be confirmed. Keep your input and retry later.');
    }
    function details(container: HTMLElement, pairs: [string, string][]) {
        container.replaceChildren();
        for (const [label, value] of pairs) { const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; row.appendChild(dt); row.appendChild(dd); container.appendChild(row); }
    }

    if (root.dataset.mode === 'list') {
        const form = root.querySelector<HTMLFormElement>('[data-search-form]')!, list = root.querySelector<HTMLElement>('[data-list]')!;
        const next = root.querySelector<HTMLButtonElement>('[data-next]')!, previous = root.querySelector<HTMLButtonElement>('[data-prev]')!;
        let cursor: string | null = null, currentAfter: string | null = null, generation = 0; const stack: (string | null)[] = [];
        async function load(after: string | null = null) {
            const token = ++generation; next.disabled = previous.disabled = true;
            message(t('讀取中…', 'Loading…'));
            const params = new URLSearchParams({ limit: '20', q: (form.elements.namedItem('q') as HTMLInputElement).value,
                includeArchived: String((form.elements.namedItem('includeArchived') as HTMLInputElement).checked) });
            if (after) params.set('after', after);
            try {
                const data = await api('?' + params); if (token !== generation) return;
                list.replaceChildren();
                for (const game of data.items) {
                    const article = document.createElement('article'); article.className = 'record';
                    const title = document.createElement('h2'), link = document.createElement('a');
                    link.href = '/admin/notbgg/' + game.notBggId.slice(7) + suffix; link.textContent = game.name; title.appendChild(link);
                    const dl = document.createElement('dl');
                    details(dl, [['NotBGG ID', game.notBggId], [t('類型', 'Type'), typeName(game.type)], [t('配件分類', 'Accessory categories'), categoryNames(game.accessoryCategories)],
                        [t('建立時間', 'Created'), game.createdAt], [t('修改時間', 'Updated'), game.updatedAt], ['Revision', String(game.revision)], [t('狀態', 'Status'), game.archivedAt ? t('已封存', 'Archived') : t('有效', 'Active')]]);
                    article.appendChild(title); article.appendChild(dl); list.appendChild(article);
                }
                cursor = data.nextCursor; currentAfter = after; next.hidden = !cursor; previous.hidden = !stack.length;
                message(data.items.length ? t(`本頁 ${data.items.length} 筆`, `${data.items.length} records on this page`) : t('沒有符合條件的遊戲。', 'No matching games.'));
            } catch (error) { message(errorMessage(error), true); }
            finally { if (token === generation) next.disabled = previous.disabled = false; }
        }
        form.addEventListener('submit', event => { event.preventDefault(); stack.length = 0; void load(); });
        next.addEventListener('click', () => { if (cursor) { stack.push(currentAfter); void load(cursor); } });
        previous.addEventListener('click', () => { if (stack.length) void load(stack.pop()!); });
        void load(); return;
    }

    const form = root.querySelector<HTMLFormElement>('[data-editor]')!, type = form.elements.namedItem('type') as unknown as HTMLSelectElement;
    const save = form.querySelector<HTMLButtonElement>('[data-save]')!, archive = form.querySelector<HTMLButtonElement>('[data-archive]')!;
    const reload = root.querySelector<HTMLButtonElement>('[data-reload]')!, history = root.querySelector<HTMLElement>('[data-history]')!;
    const historyNext = root.querySelector<HTMLButtonElement>('[data-history-next]')!;
    let current: NotBggGame | null = null, busy = false, dirty = false, lastType = 'boardgame', historyCursor: number | null = null;
    const creationKey = crypto.randomUUID();
    const input = (key: string) => form.elements.namedItem(key) as HTMLInputElement | HTMLTextAreaElement;
    const categoryInputs = () => Array.from(form.querySelectorAll<HTMLInputElement>('[name="accessoryCategories"]'));
    const playFields = adminFieldGroups.find(group => group.key === 'play')!.fields.map(field => field.key);
    function applyType() {
        const accessory = type.value === 'boardgameaccessory';
        for (const group of form.querySelectorAll<HTMLFieldSetElement>('[data-group]')) {
            group.hidden = group.dataset.group === 'play' ? accessory : group.dataset.group === 'accessory' ? !accessory : false;
        }
        const unloadedEdit = root.dataset.mode === 'edit' && !current;
        for (const group of form.querySelectorAll<HTMLFieldSetElement>('fieldset')) group.disabled = busy || unloadedEdit || !!current?.archivedAt || !!group.hidden;
        save.disabled = busy || unloadedEdit || !!current?.archivedAt; archive.disabled = busy; archive.hidden = !current || !!current.archivedAt;
    }
    function setBusy(value: boolean) { busy = value; applyType(); save.textContent = value ? t('儲存中…', 'Saving…') : t('儲存遊戲', 'Save game'); reload.disabled = value; }
    function clearErrors() {
        form.querySelectorAll<HTMLElement>('[data-error]').forEach(el => { el.textContent = ''; });
        form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    }
    function showError(error: unknown) {
        const field = error instanceof ApiFailure || error instanceof NotBggValidationError ? error.field : undefined;
        if (field) {
            const label = Array.from(form.querySelectorAll<HTMLElement>('[data-error]')).find(el => el.dataset.error === field);
            if (label) label.textContent = errorMessage(error);
            const target = field === 'accessoryCategories' ? categoryInputs()[0] : input(field);
            if (target) { target.setAttribute('aria-invalid', 'true'); target.focus(); }
        }
        reload.hidden = !(error instanceof ApiFailure && ['CONFLICT', 'REVISION_CONFLICT', 'ARCHIVED'].includes(error.code));
        message(errorMessage(error), !field);
    }
    function payload(): NotBggEditableFields {
        const values: Record<string, unknown> = { type: type.value };
        for (const group of adminFieldGroups) for (const field of group.fields) {
            const raw = input(field.key).value;
            if (field.kind === 'number') values[field.key] = raw === '' ? null : Number(raw);
            else if (field.kind === 'counts') values[field.key] = raw.trim() ? raw.trim().split(/[,\s]+/).map(Number) : null;
            else if (field.kind === 'list' || field.kind === 'refs') {
                const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
                if (field.kind === 'refs') { try { values[field.key] = lines.map(deserializeGameRef); } catch { throw new NotBggValidationError('relatedGameIds', 'Invalid game identity'); } }
                else values[field.key] = lines;
            } else values[field.key] = raw.trim() || (field.key === 'name' ? '' : null);
        }
        values.accessoryCategories = categoryInputs().filter(el => el.checked).map(el => el.value);
        const data = validateCreateNotBggGame(values);
        if (data.type === 'boardgameaccessory' && !data.accessoryCategories.length) throw new NotBggValidationError('accessoryCategories', 'Required');
        return data;
    }
    function fill(game: NotBggGame) {
        current = game; type.value = game.type; lastType = game.type;
        for (const group of adminFieldGroups) for (const field of group.fields) {
            const value = game[field.key as keyof NotBggGame];
            input(field.key).value = field.kind === 'refs' ? game.relatedGameIds.map(serializeGameRef).join('\n')
                : Array.isArray(value) ? value.join(field.kind === 'counts' ? ', ' : '\n') : value === null ? '' : String(value);
        }
        categoryInputs().forEach(el => { el.checked = game.accessoryCategories.includes(el.value as never); });
        details(root.querySelector('[data-system]')!, [['NotBGG ID', game.notBggId], ['Revision', String(game.revision)],
            [t('建立時間', 'Created'), game.createdAt], [t('修改時間', 'Updated'), game.updatedAt], [t('狀態', 'Status'), game.archivedAt ? t('已封存', 'Archived') : t('有效', 'Active')]]);
        root.querySelector<HTMLElement>('[data-history-section]')!.hidden = false;
        history.replaceChildren(); historyNext.hidden = true; historyCursor = null;
        dirty = false; reload.hidden = true; applyType();
    }
    async function loadGame() {
        if (busy) return; setBusy(true); message(t('讀取中…', 'Loading…'));
        try { const data = await api('/' + encodeURIComponent(root.dataset.id!)); fill(data.admin); message(t('資料已載入。', 'Record loaded.')); }
        catch (error) { showError(error); reload.hidden = false; }
        finally { setBusy(false); }
    }
    type.addEventListener('change', event => {
        const accessory = type.value === 'boardgameaccessory';
        const needsClear = accessory ? playFields.some(key => input(key).value.trim())
            : categoryInputs().some(el => el.checked) || !!input('contents').value.trim() || !!input('relatedGameIds').value.trim();
        if (needsClear && !window.confirm(accessory ? t('切換為配件需要清除玩家、時間與推薦人數。確認清除？', 'Switching to an accessory requires clearing player counts, times and recommendations. Clear them?')
            : t('切換類型需要清除配件子分類、適用遊戲及內容物。確認清除？', 'Changing type requires clearing accessory categories, related games and contents. Clear them?'))) {
            type.value = lastType; event.stopPropagation(); return;
        }
        if (accessory) playFields.forEach(key => { input(key).value = ''; });
        else { categoryInputs().forEach(el => { el.checked = false; }); input('contents').value = ''; input('relatedGameIds').value = ''; }
        lastType = type.value; applyType();
    });
    for (const name of ['input', 'change']) form.addEventListener(name, () => { dirty = true; });
    window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); } });
    form.addEventListener('submit', async event => {
        event.preventDefault(); if (busy || current?.archivedAt || root.dataset.mode === 'edit' && !current) return; clearErrors();
        if (!form.reportValidity()) return;
        let data: NotBggEditableFields;
        try { data = payload(); } catch (error) { showError(error); return; }
        setBusy(true); message(t('儲存中…', 'Saving…'));
        try {
            const result = current ? await api('/' + encodeURIComponent(current.notBggId), 'PATCH', { expectedRevision: current.revision, changes: data })
                : await api('', 'POST', data, creationKey);
            root.dataset.id = result.admin.notBggId; fill(result.admin);
            window.history.replaceState(null, '', '/admin/notbgg/' + result.admin.notBggId.slice(7) + suffix);
            message(t(`已儲存 ${result.admin.notBggId}，Revision ${result.admin.revision}。`, `Saved ${result.admin.notBggId}, revision ${result.admin.revision}.`), true);
        } catch (error) { setBusy(false); showError(error); }
        finally { setBusy(false); }
    });
    reload.addEventListener('click', () => { if (!dirty || window.confirm(t('重新載入會捨棄尚未儲存的輸入，是否繼續？', 'Reloading will discard unsaved input. Continue?'))) void loadGame(); });
    archive.addEventListener('click', async () => {
        if (busy || !current || !window.confirm(t('確認封存？永久 ID、修訂歷史與收藏引用都會保留。尚未儲存的修改不會保存。', 'Archive this game? Permanent ID, revisions and collection references will remain. Unsaved changes will not be saved.'))) return;
        setBusy(true); message(t('封存中…', 'Archiving…'));
        try { const data = await api('/' + encodeURIComponent(current.notBggId) + '/archive', 'POST', { expectedRevision: current.revision }); fill(data.admin); message(t('已封存，身份與歷史已保留。', 'Archived. Identity and history are retained.'), true); }
        catch (error) { setBusy(false); showError(error); } finally { setBusy(false); }
    });
    async function loadHistory(append = false) {
        if (!current) return;
        const button = root.querySelector<HTMLButtonElement>('[data-history-load]')!; button.disabled = historyNext.disabled = true;
        try {
            const data = await api('/' + encodeURIComponent(current.notBggId) + '/history?limit=20&afterRevision=' + (append ? historyCursor ?? 0 : 0));
            if (!append) history.replaceChildren();
            for (const row of data.items) {
                const section = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
                const operation = row.operation === 'create' ? t('新增', 'Created') : row.operation === 'archive' ? t('封存', 'Archived') : t('修改', 'Updated');
                summary.textContent = `Revision ${row.revision} · ${operation} · ${row.createdAt} · ${row.actor}`;
                pre.textContent = JSON.stringify(row.snapshot, null, 2); section.appendChild(summary); section.appendChild(pre); history.appendChild(section);
            }
            historyCursor = data.nextRevision; historyNext.hidden = historyCursor === null;
        } catch (error) { showError(error); } finally { button.disabled = historyNext.disabled = false; }
    }
    root.querySelector('[data-history-load]')!.addEventListener('click', () => void loadHistory());
    historyNext.addEventListener('click', () => void loadHistory(true));
    applyType(); if (root.dataset.mode === 'edit') void loadGame();
}
