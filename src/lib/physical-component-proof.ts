const hexPattern = /^[0-9a-f]{64}$/;

export function isPhysicalDigest(value: unknown): value is string {
    return typeof value === 'string' && hexPattern.test(value);
}

function bytes(value: string) {
    return new TextEncoder().encode(value);
}

export function physicalSigningKey(secret: unknown) {
    if (typeof secret !== 'string' || bytes(secret).length < 32) return null;
    return crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export function physicalSourceMessage(token: string, collectionId: number, scope: string, actor: string, digest: string) {
    return JSON.stringify(['physical-component-v1', token, collectionId, scope, actor, digest]);
}

export async function signPhysicalValue(key: CryptoKey, value: string) {
    return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes(value))),
        byte => byte.toString(16).padStart(2, '0')).join('');
}

export function verifyPhysicalValue(key: CryptoKey, value: string, signature: string) {
    const mac = Uint8Array.from(signature.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
    return crypto.subtle.verify('HMAC', key, mac, bytes(value));
}
