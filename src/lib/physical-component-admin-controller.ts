const manager = document.querySelector<HTMLElement>('[data-physical-manager]');
if (manager) {
    const en = manager.dataset.lang === 'en';
    const t = (zh: string, english: string) => en ? english : zh;
    const status = manager.querySelector<HTMLElement>('[data-physical-status]');
    const noticeKey = 'physical-component-saved:' + location.pathname + location.search;
    try {
        const action = sessionStorage.getItem(noticeKey);
        if (action && status) {
            sessionStorage.removeItem(noticeKey);
            status.textContent = t('已儲存，畫面已更新。', 'Saved. The page is up to date.');
            status.dataset.tone = 'success';
        }
    } catch { /* Saving still works when browser storage is unavailable. */ }
    const requests = new WeakMap<HTMLFormElement, { body: string; key: string }>();
    const errors: Record<string, string> = {
        COMPONENT_STATE_CHANGED: t('資料已變更或歸屬不符，請重新載入後再試。', 'The record changed or belongs to another collection. Reload and try again.'),
        COMPONENT_INELIGIBLE: t('組件來源或用途不符合資格。', 'The component source or type is ineligible.'),
        PHYSICAL_TYPE_IN_USE: t('已有清點或卡套關聯，無法變更類型或單位。', 'Counts or sleeve assignments already exist. Type and unit are locked.'),
        INVALID_COMPONENT_INPUT: t('請檢查名稱、數量及類型與單位。卡牌必須使用張。', 'Check the name, quantities, type, and unit. Cards require the card unit.'),
        EVIDENCE_UNAVAILABLE: t('無法驗證完整的分類證據。', 'Complete classification evidence could not be verified.'),
    };

    manager.addEventListener('submit', async event => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.dataset.physicalAction || !status) return;
        event.preventDefault();
        const action = form.dataset.physicalAction;
        const data = new FormData(form);
        const body: Record<string, unknown> = { action };
        for (const name of ['name', 'type', 'unit']) if (data.has(name)) body[name] = data.get(name);
        for (const name of ['collectionId', 'definitionId', 'definitionRevision', 'actual', 'copyId', 'requirementId']) {
            if (data.has(name)) body[name] = Number(data.get(name));
        }
        if (data.has('expected')) body.expected = data.get('expected') === '' ? null : Number(data.get('expected'));
        if (action === 'create') body.confirmed = data.has('confirmed');
        if (action === 'count' || action === 'assign') {
            const select = form.elements.namedItem(action === 'count' ? 'copyId' : 'requirementId');
            if (select instanceof HTMLSelectElement) body.revision = Number(select.selectedOptions[0]?.dataset.revision);
        }
        const json = JSON.stringify(body);
        let pending = requests.get(form);
        if (pending?.body !== json) {
            pending = { body: json, key: crypto.randomUUID() };
            requests.set(form, pending);
        }
        const button = form.querySelector('button');
        if (button?.disabled) return;
        if (button) button.disabled = true;
        status.textContent = t('儲存中…', 'Saving…');
        status.dataset.tone = 'info';
        try {
            const result = await fetch('/api/admin/collection/components', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-NotBGG-Request': '1', 'Idempotency-Key': pending.key },
                body: json,
            });
            const payload = await result.json() as { success?: boolean; error?: { code?: string } } | null;
            if (!result.ok || payload?.success !== true) {
                status.textContent = errors[payload?.error?.code ?? ''] ?? t('無法儲存，請確認權限或稍後再試。', 'Could not save. Check your access or try again.');
                status.dataset.tone = 'error';
                status.focus();
                return;
            }
            try { sessionStorage.setItem(noticeKey, action); } catch { /* Optional success notice. */ }
            window.location.reload();
        } catch {
            status.textContent = t('無法確認儲存結果。請重試或重新載入。', 'Could not confirm the save. Retry or reload.');
            status.dataset.tone = 'error';
            status.focus();
        } finally {
            if (button) button.disabled = false;
        }
    });
}
