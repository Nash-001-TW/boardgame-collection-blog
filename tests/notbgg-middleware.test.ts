import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';

test('actual middleware protects new routes even with legacy LOCAL_ADMIN_DEV enabled', async () => {
    const auth = await accessFixture();
    try {
        const result = await build({ entryPoints: ['src/middleware.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
            define: { 'import.meta.env.DEV': 'true' }, plugins: [{ name: 'isolated-middleware-environment', setup(builder) {
                builder.onResolve({ filter: /^(cloudflare:workers|astro:middleware)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
                builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'cloudflare:workers'
                    ? 'export const env=TEST_BINDINGS;' : 'export const defineMiddleware=fn=>fn;', loader: 'js' }));
            } }] });
        type Context = { url: URL; request: Request };
        const module = { exports: {} as { onRequest: (context: Context, next: () => Promise<Response>) => Promise<Response> } };
        new Function('TEST_BINDINGS', 'module', 'exports', 'require', result.outputFiles[0].text)({ ...auth.bindings, LOCAL_ADMIN_DEV: 'true' }, module, module.exports, createRequire(import.meta.url));
        let nextCalls = 0;
        const invoke = (path: string, token?: string) => module.exports.onRequest({ url: new URL('http://localhost' + path),
            request: new Request('http://localhost' + path, { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} }) }, async () => { nextCalls++; return new Response('verified'); });
        for (const route of ['/admin/notbgg/000001/link','/api/admin/notbgg/NotBGG%3A000001/link','/api/admin/notbgg/NotBGG%3A000001/link/history','/admin/collection','/admin/collection/new','/admin/collection/1','/api/admin/collection','/api/admin/collection/1/archive','/admin/%63ollection/new','/admin/notbgg/000001/relations','/api/admin/notbgg/NotBGG%3A000001/relations','/admin/notbgg', '/admin/notbgg/new', '/admin/notbgg/000001', '/api/admin/notbgg', '/api/admin/notbgg/NotBGG%3A000001/archive', '/%61dmin/notbgg', '/admin/%6eotbgg/new', '/api/admin/auth-check']) {
            const response = await invoke(route); assert.equal(response.status, 401); assert.equal(response.headers.get('Cache-Control'), 'no-store');
        }
        assert.equal(nextCalls, 0);
        assert.equal((await invoke('/admin/notbgg', await auth.token({ email: 'other@example.test' }))).status, 403);
        assert.equal((await invoke('/admin/notbgg', await auth.token())).status, 200); assert.equal(nextCalls, 1);
        const endpoint = await build({ entryPoints: ['src/pages/api/admin/auth-check.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
            plugins: [{ name: 'isolated-api-binding', setup(builder) {
                builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'env', namespace: 'fixture' }));
                builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const env=TEST_BINDINGS;', loader: 'js' }));
            } }] });
        const api = { exports: {} as { GET: (context: { request: Request }) => Promise<Response> } };
        new Function('TEST_BINDINGS', 'module', 'exports', 'require', endpoint.outputFiles[0].text)({ ...auth.bindings, LOCAL_ADMIN_DEV: 'true' }, api, api.exports, createRequire(import.meta.url));
        assert.equal((await api.exports.GET({ request: new Request('http://localhost/api/admin/auth-check') })).status, 401);
        const checked = await api.exports.GET({ request: new Request('http://localhost/api/admin/auth-check', { headers: { 'Cf-Access-Jwt-Assertion': await auth.token() } }) });
        assert.equal(checked.status, 200); assert.ok(!(await checked.text()).includes('admin@example.test'));
    } finally { auth.restore(); }
});
