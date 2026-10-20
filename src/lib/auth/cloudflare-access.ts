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

export async function verifyAccessAdmin(
  token: string | null,
  config: AccessAuthConfig
): Promise<AccessAdmin | null> {
  const teamDomain = config.teamDomain.trim().toLowerCase();
  const audience = config.audience.trim();
  const adminEmail = config.adminEmail.trim().toLowerCase();

  // 設定不完整時，一律拒絕存取。
  if (!token || !teamDomain || !audience || !adminEmail) {
    return null;
  }

  // 僅允許 Cloudflare Access Team Domain。
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain)) {
    return null;
  }

  const issuer = `https://${teamDomain}`;
  const jwksUrl = new URL(`${issuer}/cdn-cgi/access/certs`);

  try {
    const jwks = createRemoteJWKSet(jwksUrl);

    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience,
      algorithms: ['RS256'],
      clockTolerance: 5
    });

    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.email !== 'string' ||
      payload.email.toLowerCase() !== adminEmail
    ) {
      return null;
    }

    return {
      email: payload.email,
      subject: payload.sub
    };
  } catch {
    // JWT 無效、過期或無法驗證時，一律拒絕。
    return null;
  }
}
