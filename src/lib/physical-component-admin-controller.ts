import { quantityPreviewView } from './d1-quantity-preview-view';
import type { previewSharedQuantity } from './shared-quantity-preview';

const quantityTimeoutMs = 20_000;
type QuantityPreview = Awaited<ReturnType<typeof previewSharedQuantity>>;

const manager = document.querySelector<HTMLElement>('[data-physical-manager]');
if (manager) {
    const en = manager.dataset.lang === 'en';
    const t = (zh: string, english: string) => en ? english : zh;
    const status = manager.querySelector<HTMLElement>('[data-physical-status]');
    const noticeKey = () => 'physical-component-saved:' + location.pathname + location.search;
    try {
        const action = sessionStorage.getItem(noticeKey());
        if (action && status) {
            sessionStorage.removeItem(noticeKey());
            if (action.startsWith('{')) {
                const notice = JSON.parse(action) as { message: string; tone: string };
                status.textContent = notice.message;
                status.dataset.tone = notice.tone;
                status.dataset.quantityNotice = '';
            } else {
                status.textContent = t('已儲存，畫面已更新。', 'Saved. The page is up to date.');
                status.dataset.tone = 'success';
            }
        }
    } catch (error) { logErrorType(error); }

    function logErrorType(error: unknown) {
        const type = error instanceof DOMException ? 'DOMException' : error instanceof SyntaxError ? 'SyntaxError'
            : error instanceof TypeError ? 'TypeError' : error instanceof Error ? 'Error' : 'UnknownError';
        console.warn('Physical component admin operation failed', type);
    }

    type RequestState = { body: string; key: string; affected?: number };
    type Payload = { success?: boolean; data?: { outcome?: string }; error?: { code?: string } };
    type QuantityBody = { definitionId: number; name: string; previousExpected: number | null; expected: number | null; reason: string };
    const requests = new WeakMap<HTMLFormElement, RequestState>();
    const busy = new WeakSet<HTMLFormElement>();
    const errors: Record<string, string> = {
        COMPONENT_STATE_CHANGED: t('資料已變更或歸屬不符，請重新載入後再試。', 'The record changed or belongs to another collection. Reload and try again.'),
        COMPONENT_INELIGIBLE: t('組件來源或用途不符合資格。', 'The component source or type is ineligible.'),
        PHYSICAL_TYPE_IN_USE: t('已有清點或卡套關聯，無法變更類型或單位。', 'Counts or sleeve assignments already exist. Type and unit are locked.'),
        INVALID_COMPONENT_INPUT: t('請檢查名稱、數量及類型與單位。卡牌必須使用張。', 'Check the name, quantities, type, and unit. Cards require the card unit.'),
        EVIDENCE_UNAVAILABLE: t('無法驗證完整的分類證據。', 'Complete classification evidence could not be verified.'),
        D1_QUANTITY_REASON_REQUIRED: t('請填寫更正理由。', 'Enter a reason for this correction.'),
        D1_EVIDENCE_CAPACITY_EXCEEDED: t('歷史證據超過本次更正上限。', 'The history evidence exceeds the correction limit.'),
        IDEMPOTENCY_CONFLICT: t('此操作識別不符合目前身分或內容。', 'This operation ID does not match the current identity or payload.'),
    };
    const fallback = t('無法儲存，請確認權限或稍後再試。', 'Could not save. Check your access or try again.');
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
    const dialog = manager.querySelector<HTMLDialogElement>('[data-d1-preview]');
    const confirmButton = dialog?.querySelector<HTMLButtonElement>('[data-d1-confirm]');
    const cancelButton = dialog?.querySelector<HTMLButtonElement>('[data-d1-cancel]');
    const title = dialog?.querySelector<HTMLElement>('[data-d1-title]');
    const copyNames = new Map<number, string>(JSON.parse(dialog?.dataset.copies ?? '[]'));
    const retryAllowed = new WeakSet<HTMLFormElement>();
    let quantityBusy = false;
    let activePreview: { form: HTMLFormElement; request: RequestState } | undefined;
    const number = new Intl.NumberFormat(en ? 'en' : 'zh-TW');
    const quantity = (value: number | null) => value === null ? '—' : number.format(value);
    const quantityBody = (pending: RequestState) => JSON.parse(pending.body) as QuantityBody;

    function readPending(form: HTMLFormElement, onPageLoad = false): RequestState | null {
        const raw = sessionStorage.getItem(storageKey(form));
        if (!raw) return null;
        const record = JSON.parse(raw) as Partial<RequestState>;
        if (typeof record.key !== 'string') throw new Error('Invalid pending operation ID');
        // The former edit flow could not write a quantity without a confirmed preview.
        if (onPageLoad && !record.key.startsWith('q1.')) {
            sessionStorage.removeItem(storageKey(form));
            return null;
        }
        if (!/^q1\.[0-9a-f]{32}\.[0-9a-f]{64}$/.test(record.key) ||
            typeof record.body !== 'string') throw new Error('Invalid pending operation');
        const body = JSON.parse(record.body) as { action?: unknown; definitionId?: unknown };
        if (body.action !== 'quantity-commit' || String(body.definitionId) !== new FormData(form).get('definitionId')) {
            throw new Error('Pending operation belongs to a different definition');
        }
        return { key: record.key, body: record.body, affected: record.affected };
    }
    function changed(form: HTMLFormElement) {
        const input = form.querySelector<HTMLInputElement>('[name="expected"]');
        const previous = form.querySelector<HTMLInputElement>('[name="previousExpected"]');
        if (!input || !previous) return false;
        if (input.validity.badInput || input.value === '' || previous.value === '') return input.validity.badInput || input.value !== previous.value;
        return input.valueAsNumber !== Number(previous.value);
    }
    function syncEdit(form: HTMLFormElement, locked = false) {
        const reason = form.querySelector<HTMLTextAreaElement>('[name="reason"]');
        const label = form.querySelector<HTMLElement>('[data-quantity-reason]');
        const expected = form.querySelector<HTMLInputElement>('[name="expected"]');
        const submit = form.querySelector<HTMLButtonElement>('[data-quantity-submit]');
        const showReason = changed(form) || locked;
        if (label) label.hidden = !showReason;
        if (reason) reason.required = showReason && !locked;
        if (expected) expected.disabled = locked;
        if (submit) {
            submit.textContent = showReason ? t('預覽更正', 'Preview correction') : t('儲存', 'Save');
            submit.disabled = locked;
        }
    }
    function formNotice(form: HTMLFormElement, message: string, previewAgain = false) {
        const panel = form.querySelector<HTMLElement>('[data-quantity-notice]');
        const text = form.querySelector<HTMLElement>('[data-quantity-message]');
        const button = form.querySelector<HTMLButtonElement>('[data-quantity-action="preview"]');
        if (panel) panel.hidden = !message;
        if (text) text.textContent = message;
        if (button) button.hidden = !previewAgain;
        if (message) text?.focus();
    }
    function showPending(form: HTMLFormElement, pending: RequestState | null, message = '', focus = false) {
        const panel = form.querySelector<HTMLElement>('[data-quantity-recovery]');
        const id = form.querySelector<HTMLElement>('[data-quantity-operation-id]');
        const text = form.querySelector<HTMLElement>('[data-quantity-recovery-message]');
        const statusButton = form.querySelector<HTMLButtonElement>('[data-quantity-action="status"]');
        const retryButton = form.querySelector<HTMLButtonElement>('[data-quantity-action="retry"]');
        const canRetry = retryAllowed.has(form);
        if (panel) panel.hidden = !pending;
        if (id) id.textContent = pending?.key ?? '';
        if (text) text.textContent = message;
        if (statusButton) {
            statusButton.textContent = canRetry ? t('再查詢一次', 'Check again') : t('查詢結果', 'Check result');
            statusButton.disabled = quantityBusy;
        }
        if (retryButton) {
            retryButton.hidden = !canRetry;
            retryButton.disabled = quantityBusy;
        }
        syncEdit(form, !!pending);
        if (focus) text?.focus();
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
    async function send(state: RequestState, signal?: AbortSignal) {
        const response = await fetch('/api/admin/collection/components', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-NotBGG-Request': '1', 'Idempotency-Key': state.key },
            body: state.body, signal,
        });
        return { ok: response.ok, payload: await response.json() as Payload | null };
    }
    async function sendQuantity(action: string, body: string, key?: string) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), quantityTimeoutMs);
        let httpStatus = 0;
        try {
            const headers = new Headers({ 'Content-Type': 'application/json', 'X-NotBGG-Request': '1' });
            if (key) headers.set('Idempotency-Key', key);
            const response = await fetch('/api/admin/collection/components', {
                method: 'POST', headers, body, signal: controller.signal,
            });
            httpStatus = response.status;
            const payload = await response.json() as {
                data?: QuantityPreview & { outcome?: string; code?: string };
                error?: { code?: string };
            } | null;
            return { httpStatus, payload };
        } catch (error) {
            logErrorType(error);
            return { httpStatus, payload: null, timedOut: controller.signal.aborted && action === 'quantity-preview' };
        } finally {
            clearTimeout(timer);
        }
    }
    function saved(action: string) {
        try { sessionStorage.setItem(noticeKey(), action); } catch (error) { logErrorType(error); }
        location.reload();
    }
    function recoveryMessage(form: HTMLFormElement, pending: RequestState) {
        const { previousExpected, expected } = quantityBody(pending);
        if (retryAllowed.has(form)) return t(
            '仍無法確認。原請求可能沒有送達。可重新送出同一次更正，已完成時會取回原結果。',
            'Still unable to confirm. The original request may not have arrived. Resending the same correction retrieves the original result if already applied.',
        );
        return t(
            '無法確認更正是否完成。資料可能已改為 ' + quantity(expected) + '，也可能仍是 ' + quantity(previousExpected) + '。請先查詢結果。',
            'Unable to confirm the correction. The quantity may be ' + quantity(expected) + ' or still ' + quantity(previousExpected) + '. Check the result first.',
        );
    }
    const rejectionMessages: Record<string, string> = {
        D1_CONFIRMATION_SUPERSEDED: t('預覽之後資料有變動，請重新預覽。', 'The data changed after the preview. Preview again.'),
        COLLECTION_ARCHIVED: t('這個收藏已封存，不能更正。', 'This collection is archived and cannot be corrected.'),
        D1_PREVIEW_INVALID: t('預覽已失效，請重新預覽。', 'The preview has expired. Preview again.'),
        IDEMPOTENCY_CONFLICT: t('這次確認與原本的預覽內容不同，請重新預覽。', 'The confirmation differs from the original preview. Preview again.'),
        EVIDENCE_UNAVAILABLE: t('分類資料暫時無法使用（可能超過容量），請稍後再試。', 'Classification data is temporarily unavailable and may exceed capacity. Try again later.'),
    };
    const previewErrors: Record<string, string> = {
        COMPONENT_STATE_CHANGED: t('這個組件剛被修改過，頁面將重新載入。', 'This component changed. The page will reload.'),
        COMPONENT_INELIGIBLE: t('這個組件目前不能用於清點，無法更正預期量。', 'This component is ineligible for counting and quantity corrections.'),
        D1_EVIDENCE_TOO_LARGE: t('副本超過 200 盒或資料過大，無法一次預覽。', 'The preview exceeds 200 copies or the data limit.'),
        EVIDENCE_UNAVAILABLE: t('分類資料暫時無法使用，請稍後再試。', 'Classification data is temporarily unavailable. Try again later.'),
    };
    async function runQuantity(form: HTMLFormElement, pending: RequestState, check: boolean, fromDialog = false, automatic = false) {
        if (quantityBusy) return;
        quantityBusy = true;
        const action = check ? 'quantity-status' : 'quantity-commit';
        const progress = check ? t('正在查詢結果…', 'Checking result…') : t('正在更正…', 'Applying correction…');
        if (!fromDialog) showPending(form, pending, progress);
        const body = check ? JSON.stringify({ ...JSON.parse(pending.body), action }) : pending.body;
        const { httpStatus, payload } = await sendQuantity(action, body, pending.key);
        quantityBusy = false;
        if (fromDialog) {
            setDialogBusy(false);
            dialog?.close();
        }
        const outcome = payload?.data?.outcome;
        const code = payload?.data?.code ?? payload?.error?.code ?? '';
        if (!(check && httpStatus >= 400 && httpStatus < 500) &&
            (outcome === 'COMMITTED' || outcome === 'NOT_COMMITTED')) {
            try {
                sessionStorage.removeItem(storageKey(form));
            } catch (error) {
                logErrorType(error);
                showPending(form, pending, t('無法清除待處理紀錄，請重新查詢。', 'Could not clear the pending record. Check again.'), true);
                return;
            }
            retryAllowed.delete(form);
            showPending(form, null);
            const { name, previousExpected, expected } = quantityBody(pending);
            const previous = quantity(previousExpected);
            if (outcome === 'COMMITTED') {
                // Keep this form locked until the old page is replaced.
                syncEdit(form, true);
                const change = previous + ' → ' + quantity(expected);
                const affected = number.format(pending.affected ?? 0);
                saved(JSON.stringify({ tone: 'success', message: t(
                    '已更正「' + name + '」預期數量：' + change + '。' + affected + ' 盒的實點與清點日期未改動。',
                    'Corrected the expected quantity for “' + name + '”: ' + change + '. Actual counts and count dates unchanged for ' + affected + ' copies.',
                ) }));
                return true;
            } else {
                const reason = rejectionMessages[code] ?? t(
                    '無法更正，請重新預覽；若持續發生請記下操作識別。',
                    'Could not apply the correction. Preview again. If the issue persists, note the operation ID.',
                ) + ' ' + pending.key;
                formNotice(form, t('沒有更正，資料維持原值。', 'No correction was applied. The original value is unchanged.') + ' ' + reason, true);
            }
            return;
        }
        if (check && !automatic && !(httpStatus >= 400 && httpStatus < 500)) retryAllowed.add(form);
        const message = check && httpStatus >= 400 && httpStatus < 500
            ? t('無法查詢結果，請確認權限或稍後再查詢。', 'Could not check the result. Check your access or try again.') + ' ' + recoveryMessage(form, pending)
            : recoveryMessage(form, pending);
        showPending(form, pending, message, true);
    }

    function setDialogBusy(value: boolean) {
        if (confirmButton) confirmButton.disabled = value;
        if (cancelButton) cancelButton.disabled = value;
        if (value) dialog?.setAttribute('closedby', 'none');
        else dialog?.removeAttribute('closedby');
        const progress = dialog?.querySelector<HTMLElement>('[data-d1-progress]');
        if (progress) progress.textContent = value ? t('正在更正…', 'Applying correction…') : '';
    }
    function showPreview(form: HTMLFormElement, body: Record<string, unknown>, preview: QuantityPreview) {
        if (!dialog || !title) throw new Error('Missing quantity dialog');
        const unitField = form.elements.namedItem('unit');
        const unit = unitField instanceof HTMLSelectElement ? unitField.selectedOptions[0]?.text ?? '' : '';
        const displayUnit = en ? unit.toLowerCase() : unit;
        const view = quantityPreviewView(preview.impact, copyNames, en, displayUnit);
        const set = (selector: string, text: string) => {
            const node = dialog.querySelector(selector);
            if (node) node.textContent = text;
        };
        title.textContent = t('確認更正「' + body.name + '」的預期數量', 'Confirm expected quantity correction for “' + body.name + '”');
        set('[data-d1-change]', t('預期數量', 'Expected quantity') + ' ' + quantity(body.previousExpected as number | null) +
            ' → ' + quantity(body.expected as number | null) + ' ' + displayUnit);
        set('[data-d1-reason]', t('更正理由：', 'Reason: ') + body.reason);
        set('[data-d1-affected]', t(number.format(view.affected) + ' 盒', number.format(view.affected)));
        set('[data-d1-missing-label]', t('缺件數量（' + displayUnit + '）', 'Missing quantity'));
        set('[data-d1-missing]', view.missing);
        set('[data-d1-unreadable]', number.format(view.unreadable));
        set('[data-d1-excluded]', t('不列入 ' + number.format(view.excluded) + ' 盒（例如已出售）。',
            'Excluded copies (e.g. sold): ' + number.format(view.excluded)));
        set('[data-d1-confirm-label]', t('確認更正（影響 ' + number.format(view.affected) + ' 盒）',
            'Confirm correction (' + number.format(view.affected) + ' affected copies)'));
        const groups = dialog.querySelector('[data-d1-details]');
        const groupTemplate = dialog.querySelector<HTMLTemplateElement>('[data-d1-group]');
        const rowTemplate = dialog.querySelector<HTMLTemplateElement>('[data-d1-row]');
        if (!groups || !groupTemplate || !rowTemplate) throw new Error('Missing quantity details');
        groups.replaceChildren();
        for (const group of view.groups) {
            const element = groupTemplate.content.firstElementChild!.cloneNode(true) as HTMLDetailsElement;
            element.open = group.open;
            element.querySelector('summary')!.textContent = group.label + ' (' + number.format(group.rows.length) + ')';
            const list = element.querySelector('ul')!;
            for (const row of group.rows) {
                const item = rowTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
                item.querySelector('strong')!.textContent = row.name;
                item.querySelector('[data-d1-actual]')!.textContent = row.actual;
                item.querySelector('[data-d1-before]')!.textContent = row.before;
                item.querySelector('[data-d1-after]')!.textContent = row.after;
                list.appendChild(item);
            }
            groups.appendChild(element);
        }
        const request = { key: preview.operationId, affected: view.affected,
            body: JSON.stringify({ ...body, action: 'quantity-commit', baseline: preview.baseline, previewToken: preview.previewToken }) };
        activePreview = { form, request };
        dialog.scrollTop = 0;
        dialog.showModal();
        title.focus();
    }
    async function previewQuantity(form: HTMLFormElement, body: Record<string, unknown>) {
        if (quantityBusy || dialog?.open) return;
        quantityBusy = true;
        const submit = form.querySelector<HTMLButtonElement>('[data-quantity-submit]');
        const controls: (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[] = [];
        for (const control of form.elements) {
            if ((control instanceof HTMLInputElement && control.type !== 'hidden') ||
                control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) controls.push(control);
        }
        if (submit) submit.disabled = true;
        for (const control of controls) control.disabled = true;
        formNotice(form, '');
        const { payload, timedOut } = await sendQuantity('quantity-preview', JSON.stringify(body));
        for (const control of controls) control.disabled = false;
        if (submit) submit.disabled = false;
        quantityBusy = false;
        const preview = payload?.data;
        if (preview?.impact?.status === 'READY' && typeof preview.operationId === 'string' &&
            preview.baseline && typeof preview.previewToken === 'string') {
            try {
                showPreview(form, body, preview);
                return;
            } catch (error) { logErrorType(error); }
        }
        const code = payload?.error?.code ?? '';
        const message = timedOut ? t('預覽逾時，請再試一次。', 'The preview timed out. Try again.')
            : previewErrors[code] ?? errors[code] ?? t('無法預覽更正，請稍後再試。', 'Could not preview the correction. Try again later.');
        formNotice(form, message);
        if (code === 'COMPONENT_STATE_CHANGED') saved(JSON.stringify({ tone: 'error', message }));
    }

    cancelButton?.addEventListener('click', () => dialog?.close());
    dialog?.addEventListener('keydown', event => {
        if (quantityBusy && event.key === 'Escape') event.preventDefault();
    });
    dialog?.addEventListener('cancel', event => { if (quantityBusy) event.preventDefault(); });
    dialog?.addEventListener('close', () => {
        const previous = activePreview;
        activePreview = undefined;
        const submit = previous?.form.querySelector<HTMLButtonElement>('[data-quantity-submit]');
        if (submit && !submit.disabled && previous?.form.querySelector('[data-quantity-notice]')?.hasAttribute('hidden')) submit.focus();
    });
    confirmButton?.addEventListener('click', () => {
        if (!activePreview || quantityBusy) return;
        const { form, request } = activePreview;
        try {
            sessionStorage.setItem(storageKey(form), JSON.stringify(request));
        } catch (error) {
            logErrorType(error);
            dialog?.close();
            formNotice(form, storageError);
            return;
        }
        setDialogBusy(true);
        void runQuantity(form, request, false, true);
    });

    async function restoreQuantityOperations() {
        for (const form of manager!.querySelectorAll<HTMLFormElement>('form[data-physical-action="edit"]')) {
            syncEdit(form);
            form.addEventListener('input', () => {
                if (!form.querySelector<HTMLInputElement>('[name="expected"]')?.disabled) syncEdit(form);
            });
        }
        // Lock every queued form before awaiting the first read-only status request.
        const queued: { form: HTMLFormElement; pending: RequestState }[] = [];
        for (const form of manager!.querySelectorAll<HTMLFormElement>('form[data-physical-action="edit"]')) {
            try {
                const pending = readPending(form, true);
                if (!pending) continue;
                restorePending(form, pending);
                showPending(form, pending, t('正在查詢結果…', 'Checking result…'));
                queued.push({ form, pending });
            } catch (error) {
                logErrorType(error);
                formNotice(form, storageError);
            }
        }
        for (const { form, pending } of queued) {
            if (await runQuantity(form, pending, true, false, true)) return;
        }
    }
    void restoreQuantityOperations();

    manager.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest<HTMLButtonElement>('button[data-quantity-action]');
        const form = button?.form;
        if (!button || !form || quantityBusy) return;
        const action = button.dataset.quantityAction;
        if (action === 'preview') {
            form.requestSubmit();
            return;
        }
        try {
            const pending = readPending(form);
            if (pending && (action === 'status' || retryAllowed.has(form))) void runQuantity(form, pending, action === 'status');
        } catch (error) {
            logErrorType(error);
            formNotice(form, storageError);
        }
    });

    const picker = manager.querySelector('[data-count-copy]');
    if (picker instanceof HTMLSelectElement) {
        const copyPicker = picker;
        const previous = manager.querySelector<HTMLButtonElement>('[data-count-step="-1"]')!;
        const next = manager.querySelector<HTMLButtonElement>('[data-count-step="1"]')!;
        const uncounted = t('未清點', 'Uncounted');
        let selectedCopy = copyPicker.value;
        let saving = 0;

        function rememberCopy() {
            const url = new URL(location.href);
            if (url.searchParams.get('copy') === selectedCopy) return;
            url.searchParams.set('copy', selectedCopy);
            history.replaceState(history.state, '', url);
        }

        function syncPicker() {
            copyPicker.disabled = saving > 0;
            previous.disabled = saving > 0 || copyPicker.selectedIndex === 0;
            next.disabled = saving > 0 || copyPicker.selectedIndex === copyPicker.options.length - 1;
        }

        const rows = Array.from(manager.querySelectorAll<HTMLElement>('[data-count-values]'), row => {
            type Count = { actual: number | null; revision: number };
            const values = new Map<string, Count>(JSON.parse(row.dataset.countValues!));
            const current = row.querySelector<HTMLElement>('[data-count-current]')!;
            const form = row.querySelector<HTMLFormElement>('form');
            const input = form?.querySelector<HTMLInputElement>('[name="actual"]');
            const message = form?.querySelector<HTMLElement>('[data-count-status]');
            const save = form?.querySelector<HTMLButtonElement>('[data-count-save]');
            const retry = form?.querySelector<HTMLButtonElement>('[data-count-retry]');
            const reload = form?.querySelector<HTMLButtonElement>('[data-count-reload]');
            type Pair = { revision: number; excluded: boolean };
            const pairs = new Map<string, Pair>(JSON.parse(row.dataset.applicabilityValues!));
            const applicableCount = row.querySelector<HTMLElement>('[data-applicable-count]')!;
            const excluded = row.querySelector<HTMLElement>('[data-applicability-excluded]')!;
            const toggle = row.querySelector<HTMLButtonElement>('[data-applicability-toggle]');
            const applicabilityMessage = row.querySelector<HTMLElement>('[data-applicability-status]');
            const applicabilityRetry = row.querySelector<HTMLButtonElement>('[data-applicability-retry]');
            const applicabilityReload = row.querySelector<HTMLButtonElement>('[data-applicability-reload]');
            let toggleRequest: RequestState | undefined;
            let toggleBlocked = false;
            let pending: RequestState | undefined;
            let blocked = false;
            let inFlight = false;

            const count = () => values.get(selectedCopy)!;
            const pair = () => pairs.get(selectedCopy)!;
            const dirty = () => !!input && (input.validity.badInput ||
                (input.value === '' ? null : Number(input.value)) !== count().actual);
            function syncRow() {
                if (input && save && retry && reload) {
                    input.disabled = inFlight || !!pending || blocked || pair().excluded || !!toggleRequest || toggleBlocked;
                    save.disabled = input.disabled || !dirty() || !input.validity.valid;
                    retry.hidden = inFlight || !pending;
                    reload.hidden = !blocked;
                }
                if (toggle && applicabilityRetry && applicabilityReload) {
                    toggle.disabled = inFlight || !!pending || blocked || !!toggleRequest || toggleBlocked;
                    applicabilityRetry.hidden = inFlight || !toggleRequest;
                    applicabilityReload.hidden = !toggleBlocked;
                }
            }

            function render() {
                current.textContent = String(count().actual ?? uncounted);
                if (form && input && message) {
                    form.querySelector<HTMLInputElement>('[name="copyId"]')!.value = selectedCopy;
                    form.querySelector<HTMLInputElement>('[name="revision"]')!.value = String(count().revision);
                    input.value = String(count().actual ?? '');
                    message.textContent = '';
                }
                pending = undefined;
                blocked = false;
                toggleRequest = undefined;
                toggleBlocked = false;
                if (applicabilityMessage) applicabilityMessage.textContent = '';
                const isExcluded = pair().excluded;
                applicableCount.hidden = isExcluded;
                excluded.hidden = !isExcluded;
                row.closest('[data-count-row]')?.classList.toggle('count-excluded', isExcluded);
                if (toggle) toggle.textContent = isExcluded
                    ? t('恢復適用', 'Restore applicability')
                    : t('此副本不適用', 'Mark not applicable to this copy');
                syncRow();
            }

            async function saveCount() {
                if (!pending || !message || !form || inFlight) return;
                inFlight = true;
                saving++;
                syncPicker();
                syncRow();
                message.textContent = t('儲存中…', 'Saving…');
                try {
                    const { ok, payload } = await send(pending, AbortSignal.timeout(quantityTimeoutMs));
                    const code = payload?.error?.code;
                    if (ok && payload?.success === true) {
                        const { actual, revision } = JSON.parse(pending.body);
                        values.set(selectedCopy, { actual, revision: revision + 1 });
                        render();
                        message.textContent = t('已確認', 'Confirmed');
                    } else if (code && code !== 'SERVICE_UNAVAILABLE') {
                        pending = undefined;
                        blocked = true;
                        message.textContent = code === 'COMPONENT_NOT_APPLICABLE'
                            ? t('此副本已設為不適用，無法清點。', 'This component is not applicable to this copy and cannot be counted.')
                            : errors[code] ?? fallback;
                    } else {
                        message.textContent = t('儲存失敗，可重試。', 'Save failed. You can retry.');
                    }
                } catch (error) {
                    logErrorType(error);
                    message.textContent = t('儲存失敗，可重試。', 'Save failed. You can retry.');
                } finally {
                    inFlight = false;
                    saving--;
                    syncPicker();
                    syncRow();
                }
            }

            form?.addEventListener('submit', event => {
                event.preventDefault();
                if (!save || save.disabled) return;
                const data = new FormData(form);
                const body = Object.fromEntries(Array.from(data, ([name, value]) => [name, Number(value)]));
                pending = { body: JSON.stringify({ action: 'count', ...body }), key: crypto.randomUUID() };
                void saveCount();
            });
            input?.addEventListener('input', () => {
                if (message) message.textContent = '';
                syncRow();
            });
            retry?.addEventListener('click', () => void saveCount());
            reload?.addEventListener('click', () => location.reload());
            const definitionId = form?.querySelector<HTMLInputElement>('[name="definitionId"]')?.value;
            const copyLabel = () => copyPicker.selectedOptions[0].textContent?.trim() ?? selectedCopy;
            const historyPanel = manager.querySelector<HTMLDetailsElement>(`[data-applicability-history="${definitionId}"]`);
            async function saveApplicability(checkFirst = false) {
                if (!toggleRequest || !applicabilityMessage || inFlight) return;
                inFlight = true;
                saving++;
                syncPicker();
                syncRow();
                applicabilityMessage.textContent = t('儲存中…', 'Saving…');
                const requested = JSON.parse(toggleRequest.body) as { revision: number; next: string };
                const nextPair = { revision: requested.revision + 1, excluded: requested.next === 'not_applicable' };
                function complete() {
                    pairs.set(selectedCopy, nextPair);
                    render();
                    applicabilityMessage!.textContent = nextPair.excluded
                        ? t('已設為不適用。', 'Marked not applicable.')
                        : t('已恢復適用。', 'Applicability restored.');
                }
                function reject(code: string) {
                    toggleRequest = undefined;
                    toggleBlocked = true;
                    applicabilityMessage!.textContent = errors[code] ?? fallback;
                }
                try {
                    if (checkFirst) {
                        // Resolve a lost response using the current server-rendered pair revision before retrying.
                        const response = await fetch(location.href, { cache: 'no-store', signal: AbortSignal.timeout(quantityTimeoutMs) });
                        if (!response.ok) throw new Error('Applicability refresh failed');
                        const page = new DOMParser().parseFromString(await response.text(), 'text/html');
                        const freshRow = page.querySelector(`[data-count-values]:has([name="definitionId"][value="${definitionId}"])`);
                        if (!freshRow) return reject('COMPONENT_STATE_CHANGED');
                        const freshPair = new Map<string, Pair>(JSON.parse(freshRow.getAttribute('data-applicability-values')!)).get(selectedCopy);
                        if (freshPair?.revision === nextPair.revision && freshPair.excluded === nextPair.excluded) {
                            const freshHistory = page.querySelector(`[data-applicability-history="${definitionId}"]`);
                            if (freshHistory && historyPanel) historyPanel.replaceChildren(...freshHistory.childNodes);
                            return complete();
                        }
                        if (freshPair?.revision !== requested.revision) return reject('COMPONENT_STATE_CHANGED');
                    }
                    const { ok, payload } = await send(toggleRequest, AbortSignal.timeout(quantityTimeoutMs));
                    const data = payload?.data as { status?: string; revision?: number; actor?: string; occurredAt?: number } | undefined;
                    if (ok && payload?.success === true && data?.revision === nextPair.revision && data.status === requested.next
                        && typeof data.actor === 'string' && typeof data.occurredAt === 'number') {
                        if (historyPanel) {
                            const item = document.createElement('li');
                            const time = document.createElement('time');
                            const date = new Date(data.occurredAt * 1000);
                            time.dateTime = date.toISOString();
                            time.textContent = new Intl.DateTimeFormat(en ? 'en' : 'zh-TW', {
                                timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'medium',
                            }).format(date);
                            item.appendChild(time);
                            item.appendChild(document.createTextNode(' · ' + copyLabel() + ' · ' + (nextPair.excluded
                                ? t('適用 → 不適用', 'Applicable → Not applicable')
                                : t('不適用 → 適用', 'Not applicable → Applicable')) + ' · ' + data.actor));
                            const list = historyPanel.querySelector('ul');
                            list?.insertBefore(item, list.firstChild);
                            historyPanel.querySelector<HTMLElement>('[data-applicability-empty]')!.hidden = true;
                        }
                        complete();
                    } else if (payload?.error?.code && payload.error.code !== 'SERVICE_UNAVAILABLE') {
                        reject(payload.error.code);
                    } else {
                        throw new Error('Applicability result unknown');
                    }
                } catch (error) {
                    logErrorType(error);
                    applicabilityMessage.textContent = t('儲存失敗，可重試。', 'Save failed. You can retry.');
                } finally {
                    inFlight = false;
                    saving--;
                    syncPicker();
                    syncRow();
                    if (toggleBlocked) applicabilityReload?.focus();
                    else if (toggleRequest) applicabilityRetry?.focus();
                    else toggle?.focus();
                }
            }
            toggle?.addEventListener('click', () => {
                if (!form || toggle.disabled) return;
                const currentPair = pair();
                const label = copyLabel();
                const name = row.dataset.componentName;
                const prompt = currentPair.excluded
                    ? t(`恢復 ${label} 的「${name}」適用性？`, `Restore “${name}” for ${label}?`)
                    : t(`${label} 不適用「${name}」？之後可恢復。`, `Mark “${name}” not applicable to ${label}? You can restore it later.`);
                if (!window.confirm(prompt + (dirty() ? t(' 未儲存的實點會捨棄。', ' The unsaved count will be discarded.') : ''))) return;
                const definitionRevision = form.querySelector<HTMLInputElement>('[name="definitionRevision"]')!.value;
                toggleRequest = { key: crypto.randomUUID(), body: JSON.stringify({
                    action: 'applicability', definitionId: Number(definitionId), definitionRevision: Number(definitionRevision),
                    copyId: Number(selectedCopy), revision: currentPair.revision,
                    next: currentPair.excluded ? 'applicable' : 'not_applicable',
                }) };
                void saveApplicability();
            });
            applicabilityRetry?.addEventListener('click', () => void saveApplicability(true));
            applicabilityReload?.addEventListener('click', () => location.reload());
            return { dirty, render };
        });

        function switchCopy(copy: string) {
            if (copy === selectedCopy) return;
            const unsaved = rows.filter(row => row.dirty()).length;
            if (saving || (unsaved && !window.confirm(t(
                '有 ' + unsaved + ' 列尚未儲存，切換會捨棄。',
                unsaved + ' row(s) have unsaved changes. Switching copies will discard them.',
            )))) {
                copyPicker.value = selectedCopy;
                return;
            }
            selectedCopy = copy;
            copyPicker.value = copy;
            rememberCopy();
            rows.forEach(row => row.render());
            syncPicker();
        }

        copyPicker.addEventListener('change', () => switchCopy(copyPicker.value));
        previous.addEventListener('click', () => switchCopy(copyPicker.options[copyPicker.selectedIndex - 1].value));
        next.addEventListener('click', () => switchCopy(copyPicker.options[copyPicker.selectedIndex + 1].value));
        rememberCopy();
        rows.forEach(row => row.render());
        syncPicker();
    }

    manager.addEventListener('submit', async event => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.dataset.physicalAction || !status) return;
        event.preventDefault();
        if (busy.has(form)) return;
        const action = form.dataset.physicalAction;
        if (action === 'count') return;
        const data = new FormData(form);
        const body: Record<string, unknown> = { action };
        for (const name of ['name', 'type', 'unit']) if (data.has(name)) body[name] = data.get(name);
        for (const name of ['collectionId', 'definitionId', 'definitionRevision', 'actual', 'copyId', 'requirementId']) {
            if (data.has(name)) body[name] = Number(data.get(name));
        }
        if (data.has('expected')) body.expected = data.get('expected') === '' ? null : Number(data.get('expected'));
        if (action === 'create') body.confirmed = data.has('confirmed');
        if (action === 'assign') {
            const select = form.elements.namedItem('requirementId');
            if (select instanceof HTMLSelectElement) body.revision = Number(select.selectedOptions[0]?.dataset.revision);
        }

        if (action === 'edit') {
            if (quantityBusy || dialog?.open) return;
            try {
                if (readPending(form)) return;
            } catch (error) {
                logErrorType(error);
                if (changed(form)) { formNotice(form, storageError); return; }
            }
            if (changed(form)) {
                const reason = String(data.get('reason') ?? '').trim();
                if (!reason) {
                    formNotice(form, errors.D1_QUANTITY_REASON_REQUIRED);
                    form.querySelector<HTMLElement>('[name="reason"]')?.focus();
                    return;
                }
                const previous = data.get('previousExpected');
                body.previousExpected = previous === '' ? null : Number(previous);
                body.reason = reason;
                body.action = 'quantity-preview';
                await previewQuantity(form, body);
                return;
            }
        }

        const json = JSON.stringify(body);
        let pending = requests.get(form);
        if (pending?.body !== json) {
            pending = { body: json, key: crypto.randomUUID() };
            requests.set(form, pending);
        }
        const button = form.querySelector<HTMLButtonElement>(action === 'edit' ? '[data-quantity-submit]' : 'button');
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
