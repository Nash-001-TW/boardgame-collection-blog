import { generateKeyPair, exportJWK, SignJWT } from 'jose';

/** Test-only transport fixture: real signatures/claims, no production auth override. */
export async function accessFixture() {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const kid = crypto.randomUUID(), domain = `notbgg-${crypto.randomUUID()}.cloudflareaccess.com`;
    const jwk = { ...await exportJWK(publicKey), kid, alg: 'RS256', use: 'sig' };
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url === `https://${domain}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
        return original(input, init);
    };
    const bindings = { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: 'notbgg-test-audience', ADMIN_EMAIL: 'admin@example.test' };
    async function token(options: { email?: string; subject?: string; issuer?: string; audience?: string; exp?: number | null; wrongKey?: boolean } = {}) {
        const now = Math.floor(Date.now() / 1000);
        let jwt = new SignJWT({ email: options.email ?? bindings.ADMIN_EMAIL }).setProtectedHeader({ alg: 'RS256', kid })
            .setIssuer(options.issuer ?? `https://${domain}`).setAudience(options.audience ?? bindings.ACCESS_AUD)
            .setSubject(options.subject ?? 'verified-admin-subject').setIssuedAt(now);
        if (options.exp !== null) jwt = jwt.setExpirationTime(options.exp ?? now + 3600);
        const key = options.wrongKey ? (await generateKeyPair('RS256')).privateKey : privateKey;
        return jwt.sign(key);
    }
    return { bindings, token, restore: () => { globalThis.fetch = original; } };
}
