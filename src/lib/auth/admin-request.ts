import { authenticateAccessAdmin } from './cloudflare-access';
export function normalizedAdminPath(path: string): string {
    try { return decodeURIComponent(path).replace(/\/+/g, '/'); } catch { return path; }
}
export function isNotBggAdminPath(path: string): boolean {
    return /^\/(?:api\/)?admin\/(?:notbgg|collection|sleeves|purchases|bgg)(?:\/|$)/.test(normalizedAdminPath(path));
}
export function authorizeAdminRequest(request: Request, bindings: Record<string, unknown>) {
    return authenticateAccessAdmin(request.headers.get('Cf-Access-Jwt-Assertion'), {
        teamDomain: String(bindings.ACCESS_TEAM_DOMAIN ?? ''), audience: String(bindings.ACCESS_AUD ?? ''), adminEmail: String(bindings.ADMIN_EMAIL ?? '')
    });
}
