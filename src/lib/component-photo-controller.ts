const endpoint = '/api/admin/collection/component-photos';
const originalLimit = 20 * 1024 * 1024;

function canvasFor(image: CanvasImageSource, width: number, height: number, longest: number) {
    const scale = Math.min(1, longest / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('DECODE');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
}

async function encode(canvas: HTMLCanvasElement, type: string, limit: number) {
    if (type === 'image/jpeg') {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('DECODE');
        context.globalCompositeOperation = 'destination-over';
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
    }
    for (const quality of [0.86, 0.73, 0.58, 0.43, 0.28, 0.15]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
        if (!blob || blob.type !== type) return null;
        if (blob.size <= limit) return blob;
    }
    return null;
}

async function supportedOriginal(file: File) {
    const bytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
    const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
    if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, offset) => bytes[offset] === byte)) return true;
    if (tag(0) === 'RIFF' && tag(8) === 'WEBP') return true;
    if (bytes.length < 16 || tag(4) !== 'ftyp') return false;
    const length = Math.min(bytes.length, new DataView(bytes.buffer).getUint32(0));
    const brands = [tag(8)];
    for (let offset = 16; offset + 4 <= length; offset += 4) brands.push(tag(offset));
    return !brands.some(brand => ['avif', 'avis'].includes(brand))
        && brands.some(brand => /^(hei[cmsx]|hev[cmsx]|mif1|msf1)$/.test(brand));
}

async function preparePhoto(file: File) {
    if (file.size > originalLimit) throw new Error('ORIGINAL_SIZE');
    if (!await supportedOriginal(file)) throw new Error('DECODE');
    let bitmap: ImageBitmap | undefined;
    let image: HTMLImageElement | undefined;
    let url: string | undefined;
    try {
        try {
            bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch {
            // Safari can decode some HEIC files through the image element only.
            url = URL.createObjectURL(file);
            image = new Image();
            image.src = url;
            await image.decode();
        }
        const source = bitmap ?? image;
        if (!source) throw new Error('DECODE');
        const width = bitmap?.width ?? image!.naturalWidth;
        const height = bitmap?.height ?? image!.naturalHeight;
        const full = canvasFor(source, width, height, 1600);
        const small = canvasFor(source, width, height, 224);
        for (const type of ['image/webp', 'image/jpeg']) {
            const photo = await encode(full, type, 1024 * 1024);
            const thumb = await encode(small, type, 100 * 1024);
            if (photo && thumb) return { photo, thumb };
        }
        throw new Error('OUTPUT_SIZE');
    } finally {
        bitmap?.close();
        if (url) URL.revokeObjectURL(url);
    }
}

export function initComponentPhotoDialog(root: HTMLElement) {
    const dialog = root.querySelector<HTMLDialogElement>('[data-component-photo-dialog]');
    if (!dialog) return;
    const find = <T extends HTMLElement>(id: string) => dialog.querySelector<T>('[data-photo-' + id + ']')!;
    const current = find<HTMLImageElement>('current');
    const preview = find<HTMLImageElement>('preview');
    const privateBox = find<HTMLInputElement>('private');
    const save = find<HTMLButtonElement>('save');
    const remove = find<HTMLButtonElement>('remove');
    const close = find<HTMLButtonElement>('close');
    const controls = find<HTMLElement>('controls');
    const status = find<HTMLElement>('status');
    const t = (zh: string, en: string) => root.dataset.lang === 'en' ? en : zh;
    let trigger: HTMLButtonElement | undefined;
    let pending: Awaited<ReturnType<typeof preparePhoto>> | undefined;
    let retry: { id: string; action: string; body: FormData } | undefined;
    let generation = 0;
    let busy = false;
    let processing = false;
    let previewUrl: string | undefined;

    function clearPreview() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = undefined;
        preview.hidden = true;
        preview.removeAttribute('src');
        current.hidden = !trigger?.dataset.photoFull;
    }
    function refresh() {
        const changed = privateBox.checked !== (trigger?.dataset.photoPublic === '0');
        save.disabled = busy || processing || (!pending && !(trigger?.dataset.photoFull && changed));
        remove.disabled = busy || processing;
        privateBox.disabled = busy || processing;
        close.disabled = busy;
        for (const picker of dialog!.querySelectorAll<HTMLButtonElement>('[data-photo-pick]')) picker.disabled = busy;
    }
    root.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        const opener = event.target.closest<HTMLButtonElement>('[data-component-photo-open]');
        if (!opener || dialog.open) return;
        trigger = opener;
        pending = retry = undefined;
        processing = false;
        const full = opener.dataset.photoFull;
        current.hidden = !full;
        if (full) current.src = endpoint + '/' + full;
        else current.removeAttribute('src');
        privateBox.checked = opener.dataset.photoPublic === '0';
        controls.hidden = opener.dataset.photoWritable !== '1';
        remove.hidden = !full;
        status.textContent = '';
        find('title').textContent = t('設定照片', 'Component photo') + ' · ' + opener.dataset.photoName;
        refresh();
        dialog.showModal();
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => {
        generation++;
        clearPreview();
        current.removeAttribute('src');
        trigger?.focus();
    });
    current.addEventListener('error', () => {
        if (dialog.open) status.textContent = t('無法讀取照片。', 'Could not load the photo.');
    });
    privateBox.addEventListener('change', () => { retry = undefined; refresh(); });
    for (const picker of dialog.querySelectorAll<HTMLButtonElement>('[data-photo-pick]')) {
        const input = dialog.querySelector<HTMLInputElement>('[data-photo-input="' + picker.dataset.photoPick + '"]')!;
        picker.addEventListener('click', () => input.click());
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            input.value = '';
            if (!file || busy) return;
            const ticket = ++generation;
            retry = pending = undefined;
            processing = true;
            clearPreview();
            status.textContent = t('正在處理照片…', 'Preparing photo…');
            refresh();
            try {
                const result = await preparePhoto(file);
                if (ticket !== generation) return;
                pending = result;
                previewUrl = URL.createObjectURL(result.photo);
                preview.src = previewUrl;
                preview.hidden = false;
                current.hidden = true;
                status.textContent = '';
            } catch (error) {
                if (ticket !== generation) return;
                const code = error instanceof Error ? error.message : '';
                status.textContent = code === 'ORIGINAL_SIZE' ? t('原始照片不得超過 20 MB。', 'The original photo must be 20 MB or smaller.')
                    : code === 'OUTPUT_SIZE' ? t('照片壓縮後仍太大，請選擇另一張。', 'The encoded photo is too large. Choose another image.')
                    : t('無法解碼這張照片，請改用 JPEG。', 'Could not decode this photo. Try a JPEG.');
            } finally {
                if (ticket === generation) { processing = false; refresh(); }
            }
        });
    }

    async function submit(action: 'upload' | 'remove') {
        if (!trigger || busy || processing || controls.hidden) return;
        busy = true;
        status.textContent = t('正在儲存…', 'Saving…');
        refresh();
        try {
            if (retry?.action !== action) {
                const body = new FormData();
                body.set('action', action);
                body.set('definitionId', trigger.dataset.componentPhotoOpen!);
                body.set('photoId', trigger.dataset.photoId ?? '0');
                body.set('revision', trigger.dataset.photoRevision ?? '0');
                if (action === 'upload') {
                    let images = pending;
                    // Visibility changes reuse the encoded bytes and obtain new URLs in the same guarded write.
                    if (!images && trigger.dataset.photoFull && trigger.dataset.photoThumb) {
                        const blobs = await Promise.all([trigger.dataset.photoFull, trigger.dataset.photoThumb].map(async key => {
                            const result = await fetch(endpoint + '/' + key, { signal: AbortSignal.timeout(15000) });
                            if (!result.ok) throw new Error('READ');
                            return result.blob();
                        }));
                        images = { photo: blobs[0], thumb: blobs[1] };
                    }
                    if (!images) return;
                    body.set('photo', images.photo, 'photo');
                    body.set('thumb', images.thumb, 'thumb');
                    body.set('isPublic', privateBox.checked ? '0' : '1');
                }
                retry = { id: crypto.randomUUID(), action, body };
            }
            const result = await fetch(endpoint, { method: 'POST', headers: {
                'X-NotBGG-Request': '1', 'Idempotency-Key': retry.id,
            }, body: retry.body, signal: AbortSignal.timeout(30000) });
            const payload = await result.json() as { success?: boolean };
            if (!result.ok || !payload.success) {
                status.textContent = result.status === 409
                    ? t('照片已被更新。請重新整理頁面後再試。', 'The photo changed. Reload this page and try again.')
                    : t('無法儲存照片。請重試。', 'Could not save the photo. Try again.');
                return;
            }
            window.location.reload();
        } catch {
            status.textContent = t('無法確認儲存結果。可用同一筆操作重試。', 'Could not confirm the result. Retry the same operation.');
        } finally {
            busy = false;
            refresh();
        }
    }
    save.addEventListener('click', () => void submit('upload'));
    remove.addEventListener('click', () => {
        if (window.confirm(t('要移除所有副本共用的照片嗎？', 'Remove the photo shared by all copies?'))) void submit('remove');
    });
}
