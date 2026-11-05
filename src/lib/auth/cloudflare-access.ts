import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface AccessAuthConfig {
  teamDomain: string;
  audience: string;
  adminEmail: string;
}

export interface AccessAdmin {
  email: string;
  subject: string;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export type AccessAuthorization = { admin: AccessAdmin } | { status: 401 | 403 };

export async function authenticateAccessAdmin(token: string | null, config: AccessAuthConfig): Promise<AccessAuthorization> {
  const domain = config.teamDomain.trim().toLowerCase();
  if (!token) return { status: 401 };
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !config.audience.trim() || !config.adminEmail.trim()) return { status: 403 };
  try {
    let keys = keySets.get(domain);
    if (!keys) { keys = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`)); keySets.set(domain, keys); }
    const { payload } = await jwtVerify(token, keys, { issuer: `https://${domain}`, audience: config.audience.trim(),
      algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'], clockTolerance: 5 });
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string') return { status: 401 };
    if (payload.email.toLowerCase() !== config.adminEmail.trim().toLowerCase()) return { status: 403 };
    return { admin: { email: payload.email, subject: payload.sub } };
  } catch { return { status: 401 }; } // Never log tokens, claims, JWKS responses or exceptions.
}

export async function verifyAccessAdmin(
  token: string | null,
  config: AccessAuthConfig
): Promise<AccessAdmin | null> {
  const result = await authenticateAccessAdmin(token, config);
  return 'admin' in result ? result.admin : null;
}
