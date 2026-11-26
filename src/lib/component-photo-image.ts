import { HttpError } from './notbgg-admin-api';

export const photoBytes = 1024 * 1024;
export const thumbBytes = 100 * 1024;
export type PhotoType = 'image/webp' | 'image/jpeg';

function jpeg(bytes: Uint8Array, view: DataView) {
    const end = bytes.length - 2;
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[end] !== 255 || bytes[end + 1] !== 217) return;
    let size: { width: number; height: number } | undefined;
    let scanning = false;
    let sawScan = false;
    for (let offset = 2; offset <= end;) {
        if (bytes[offset++] !== 255) {
            if (scanning) continue;
            return;
        }
        while (offset <= end && bytes[offset] === 255) offset++;
        const marker = bytes[offset++];
        if (marker === 0xd9) return sawScan && offset === bytes.length ? size : undefined;
        if (scanning && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
        scanning = false;
        if (offset + 2 > end) return;
        const length = view.getUint16(offset);
        if (length < 2 || offset + length > end) return;
        // Browser encoders may use JFIF and ICC; reject other application data and comments.
        if ((marker >= 0xe0 && marker <= 0xef && ![0xe0, 0xe2, 0xee].includes(marker)) || marker === 0xfe) return;
        if (marker === 0xda) {
            if (!size || offset + length >= end) return;
            scanning = sawScan = true;
        }
        if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
            if (size) return;
            size = { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
        }
        offset += length;
    }
}

function webp(bytes: Uint8Array, view: DataView) {
    const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (bytes.length < 20 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP'
        || view.getUint32(4, true) !== bytes.length - 8) return;
    let size: { width: number; height: number } | undefined;
    let canvas: typeof size;
    for (let offset = 12; offset < bytes.length;) {
        if (offset + 8 > bytes.length) return;
        const kind = tag(offset);
        const length = view.getUint32(offset + 4, true);
        const start = offset + 8;
        offset = start + length + length % 2;
        if (offset > bytes.length || !['VP8X', 'ICCP', 'ALPH', 'VP8 ', 'VP8L'].includes(kind)) return;
        if (kind === 'VP8X') {
            if (length !== 10 || canvas || (bytes[start] & 0x0e)) return;
            const dimension = (index: number) => 1 + bytes[index] + bytes[index + 1] * 256 + bytes[index + 2] * 65536;
            canvas = { width: dimension(start + 4), height: dimension(start + 7) };
        }
        if (kind === 'VP8 ' || kind === 'VP8L') {
            if (size) return;
            if (kind === 'VP8 ' && length > 10 && (bytes[start] & 1) === 0
                && bytes[start + 3] === 0x9d && bytes[start + 4] === 1 && bytes[start + 5] === 0x2a) {
                size = { width: view.getUint16(start + 6, true) & 0x3fff, height: view.getUint16(start + 8, true) & 0x3fff };
            } else if (kind === 'VP8L' && length > 5 && bytes[start] === 0x2f) {
                const dimensions = view.getUint32(start + 1, true);
                if (dimensions >>> 29) return;
                size = { width: (dimensions & 0x3fff) + 1, height: ((dimensions >>> 14) & 0x3fff) + 1 };
            } else return;
        }
    }
    if (canvas && (canvas.width !== size?.width || canvas.height !== size.height)) return;
    return size;
}

export async function validatePhoto(file: FormDataEntryValue | null, limit: number, longest: number) {
    if (!(file instanceof Blob) || !file.size) throw new HttpError(400, 'PHOTO_FILE_REQUIRED');
    if (file.size > limit) throw new HttpError(413, 'PHOTO_TOO_LARGE');
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const type = file.type;
    if (type !== 'image/jpeg' && type !== 'image/webp') throw new HttpError(415, 'PHOTO_INVALID_TYPE');
    const size = type === 'image/jpeg' ? jpeg(bytes, view) : webp(bytes, view);
    if (!size) throw new HttpError(415, 'PHOTO_INVALID_TYPE');
    if (Math.min(size.width, size.height) < 1 || Math.max(size.width, size.height) > longest)
        throw new HttpError(400, 'PHOTO_INVALID_DIMENSIONS');
    return { ...size, buffer, type, byteSize: file.size };
}
