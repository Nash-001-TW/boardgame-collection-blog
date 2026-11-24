import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { transform } from '@astrojs/compiler-rs';
import { experimental_AstroContainer } from 'astro/container';
import { transformSync } from 'esbuild';

test('collection diagnostics return an uncached 404 before touching D1 outside dev', async () => {
    const filename = 'src/pages/dev/collection-v2-test.astro';
    const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
    const compiled = transform(source, {
        filename,
        internalURL: 'astro/compiler-runtime',
        resolvePath: (path) => path,
    });
    assert.deepEqual(compiled.diagnostics.filter(({ severity }) => severity === 'error'), []);

    const { code } = transformSync(compiled.code, {
        format: 'cjs',
        define: { 'import.meta.env.DEV': 'false' },
        // Keep the guarded code present with a stubbed binding for the render.
        minifySyntax: false,
    });
    const localRequire = createRequire(import.meta.url);
    let dbReads = 0;
    const module = { exports: {} as {
        default: Parameters<experimental_AstroContainer['renderToResponse']>[0];
    } };
    function requireForRender(id: string) {
        if (id === 'cloudflare:workers') {
            return { env: { get DB() { dbReads++; throw new Error('Unexpected D1 access'); } } };
        }
        if (id.startsWith('../../lib/')) return {};
        return localRequire(id);
    }
    new Function('require', 'module', code)(requireForRender, module);

    const container = await experimental_AstroContainer.create();
    const response = await container.renderToResponse(module.exports.default);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(await response.text(), 'Not Found');
    assert.equal(dbReads, 0);
});
