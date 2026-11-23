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
    } catch (error) { logErrorType(error); }

    function logErrorType(error: unknown) {
        const type = error instanceof DOMException ? 'DOMException' : error instanceof SyntaxError ? 'SyntaxError'
            : error instanceof TypeError ? 'TypeError' : error instanceof Error ? 'Error' : 'UnknownError';
        console.warn('Physical component admin operation failed', type);
    }

    type RequestState = { body: string; key: string };
    type Payload = { success?: boolean; data?: { outcome?: string }; error?: { code?: string } };
    const requests = new WeakMap<HTMLFormElement, RequestState>();
    const busy = new WeakSet<HTMLFormElement>();
    const errors: Record<string, string> = {
        COMPONENT_STATE_CHANGED: t('資料已變更或歸屬不符，請重新載入後再試。', 'The record changed or belongs to another collection. Reload and try again.'),
        COMPONENT_INELIGIBLE: t('組件來源或用途不符合資格。', 'The component source or type is ineligible.'),
        PHYSICAL_TYPE_IN_USE: t('已有清點或卡套關聯，無法變更類型或單位。', 'Counts or sleeve assignments already exist. Type and unit are locked.'),
        INVALID_COMPONENT_INPUT: t('請檢查名稱、數量及類型與單位。卡牌必須使用張。', 'Check the name, quantities, type, and unit. Cards require the card unit.'),
        EVIDENCE_UNAVAILABLE: t('無法驗證完整的分類證據。', 'Complete classification evidence could not be verified.'),
        D1_QUANTITY_REASON_REQUIRED: t('請填寫更正理由。', 'Enter a reason for this correction.'),
        D1_QUANTITY_PREVIEW_REQUIRED: t(
            '變更預期數量須先預覽並確認，該流程仍在開發中。請將預期數量改回原值，即可另外儲存名稱、類型等欄位。',
            'Changing the expected quantity requires a preview and confirmation flow that is still in development. Restore the original expected quantity to save other fields such as name and type separately.',
        ),
        D1_EVIDENCE_CAPACITY_EXCEEDED: t('歷史證據超過本次更正上限。', 'The history evidence exceeds the correction limit.'),
        IDEMPOTENCY_CONFLICT: t('此操作識別不符合目前身分或內容。', 'This operation ID does not match the current identity or payload.'),
    };
    const fallback = t('無法儲存，請確認權限或稍後再試。', 'Could not save. Check your access or try again.');
    const unknown = t('尚未確認結果。請查詢或重送原操作。',
        'The result is unknown. Check or retry the original operation.');
    const storageError = t('無法安全保存原操作識別。未送出新的更正。', 'The original operation ID could not be stored safely. No new correction was sent.');

    function notify(message: string, tone = 'error') {
        if (!status) return;
        status.textContent = message;
        status.dataset.tone = tone;
        if (tone === 'error') status.focus();
    }
    function storageKey(form: HTMLFormElement) {
        const id = new FormData(form).get('definitionId');
        return 'physical-quantity-pending:v1:' + location.pathname + ':' + id;
    }
    function readPending(form: HTMLFormElement, onPageLoad = false): RequestState | null {
        const raw = sessionStorage.getItem(storageKey(form));
        if (!raw) return null;
        const record = JSON.parse(raw) as Partial<RequestState>;
        if (typeof record.key !== 'string') throw new Error('Invalid pending operation ID');
        // Legacy quantity edits were rejected before any write, so their records can be discarded.
        if (onPageLoad && !/^q1\.[0-9a-f]{32}\.[0-9a-f]{64}$/.test(record.key)) {
            clearPending(form);
            return null;
        }
        if (!/^[A-Za-z0-9_.-]{8,128}$/.test(record.key) ||
            typeof record.body !== 'string') throw new Error('Invalid pending operation');
        const body = JSON.parse(record.body) as { action?: unknown; definitionId?: unknown };
        if (body.action !== 'edit' || String(body.definitionId) !== new FormData(form).get('definitionId')) {
            throw new Error('Pending operation belongs to a different definition');
        }
        return { key: record.key, body: record.body };
    }
    function showPending(form: HTMLFormElement, pending: RequestState | null) {
        const panel = form.querySelector<HTMLElement>('[data-quantity-recovery]');
        const id = form.querySelector<HTMLElement>('[data-quantity-operation-id]');
        if (panel) panel.hidden = !pending;
        if (id) id.textContent = pending?.key ?? '';
    }
    function clearPending(form: HTMLFormElement) {
        showPending(form, null);
        try {
            sessionStorage.removeItem(storageKey(form));
        } catch (error) {
            logErrorType(error);
        }
    }
    function restorePending(form: HTMLFormElement, pending: RequestState) {
        const body = JSON.parse(pending.body) as Record<string, unknown>;
        for (const name of ['name', 'type', 'unit', 'expected', 'reason']) {
            const field = form.elements.namedItem(name);
            if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
                if (Object.hasOwn(body, name)) field.value = body[name] === null ? '' : String(body[name]);
            }
        }
        const details = form.closest('details');
        if (details) details.open = true;
    }
    async function send(state: RequestState, action?: string) {
        const response = await fetch('/api/admin/collection/components', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-NotBGG-Request': '1', 'Idempotency-Key': state.key },
            body: action ? JSON.stringify({ action }) : state.body,
        });
        return { ok: response.ok, status: response.status, payload: await response.json() as Payload | null };
    }
    function saved(action: string) {
        try { sessionStorage.setItem(noticeKey, action); } catch (error) { logErrorType(error); }
        location.reload();
    }
    async function runQuantity(form: HTMLFormElement, pending: RequestState, action?: string) {
        if (busy.has(form)) return;
        busy.add(form);
        showPending(form, pending);
        notify(t('正在核對操作結果…', 'Checking the operation result…'), 'pending');
        try {
            const { ok, status: httpStatus, payload } = await send(pending, action);
            const code = payload?.error?.code ?? '';
            const outcome = payload?.data?.outcome;
            if (outcome === 'COMMITTED' && ok && payload?.success === true) {
                clearPending(form);
                saved('edit');
            } else if (outcome === 'RETIRED' && (action ? ok : payload?.error?.code === 'D1_OPERATION_RETIRED')) {
                clearPending(form);
                notify(t('原操作已安全封閉。可重新核對資料後再提交。', 'The original operation is safely closed. Review the data before submitting again.'), 'success');
            } else if (httpStatus >= 400 && httpStatus < 500) {
                clearPending(form);
                notify(errors[code] ?? fallback);
            } else if (httpStatus >= 500 || !ok || outcome !== 'UNKNOWN') {
                notify(unknown);
            } else {
                // A status query without a receipt cannot establish that the original edit was rejected.
                notify(t('查詢未找到操作收據。請重送原操作。', 'The status check found no receipt. Retry the original operation.'));
            }
        } catch (error) {
            logErrorType(error);
            notify(unknown);
        } finally {
            busy.delete(form);
        }
    }

    for (const form of manager.querySelectorAll<HTMLFormElement>('form[data-physical-action="edit"]')) {
        try {
            const pending = readPending(form, true);
            showPending(form, pending);
            if (pending) restorePending(form, pending);
        } catch (error) {
            logErrorType(error);
            clearPending(form);
        }
    }

    manager.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest<HTMLButtonElement>('button[data-quantity-action]');
        const form = button?.form;
        if (!button || !form) return;
        event.preventDefault();
        if (button.dataset.quantityAction === 'retire') {
            notify(t('安全封閉操作仍在開發中。目前可查詢或重送原操作。',
                'Safely closing an operation is still in development. You can check or retry the original operation.'));
            return;
        }
        try {
            const pending = readPending(form);
            if (pending) {
                let action: string | undefined;
                if (button.dataset.quantityAction === 'status') action = 'quantity-status';
                void runQuantity(form, pending, action);
            }
        } catch (error) {
            logErrorType(error);
            notify(storageError);
        }
    });

    manager.addEventListener('submit', async event => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.dataset.physicalAction || !status) return;
        event.preventDefault();
        if (busy.has(form)) return;
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

        if (action === 'edit') {
            // Fail closed for actual quantity corrections if pending state cannot be read.
            const previous = data.get('previousExpected');
            const changesQuantity = data.has('expected') && typeof previous === 'string' &&
                body.expected !== (previous === '' ? null : Number(previous));
            let pending: RequestState | null = null;
            try {
                pending = readPending(form);
            } catch (error) {
                logErrorType(error);
                if (changesQuantity) { notify(storageError); return; }
            }
            try {
                if (pending) {
                    showPending(form, pending);
                    notify(unknown);
                    return;
                }
                if (changesQuantity) {
                    const reason = String(data.get('reason') ?? '').trim();
                    if (!reason) {
                        notify(errors.D1_QUANTITY_REASON_REQUIRED);
                        form.querySelector<HTMLElement>('[name="reason"]')?.focus();
                        return;
                    }
                    body.previousExpected = previous === '' ? null : Number(previous);
                    body.reason = reason;
                    const request = { body: JSON.stringify(body), key: crypto.randomUUID() };
                    sessionStorage.setItem(storageKey(form), JSON.stringify(request));
                    await runQuantity(form, request);
                    return;
                }
            } catch (error) {
                logErrorType(error);
                notify(storageError);
                return;
            }
        }

        const json = JSON.stringify(body);
        let pending = requests.get(form);
        if (pending?.body !== json) {
            pending = { body: json, key: crypto.randomUUID() };
            requests.set(form, pending);
        }
        const button = form.querySelector('button');
        if (button?.disabled) return;
        busy.add(form);
        if (button) button.disabled = true;
        notify(t('儲存中…', 'Saving…'), 'pending');
        try {
            const { ok, payload } = await send(pending);
            if (!ok || payload?.success !== true) {
                notify(errors[payload?.error?.code ?? ''] ?? fallback);
                return;
            }
            saved(action);
        } catch (error) {
            logErrorType(error);
            notify(t('無法確認儲存結果。請重試或重新載入。', 'Could not confirm the save. Retry or reload.'));
        } finally {
            busy.delete(form);
            if (button) button.disabled = false;
        }
    });
}
