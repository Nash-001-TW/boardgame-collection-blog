import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { transform } from '@astrojs/compiler-rs';
import { experimental_AstroContainer } from 'astro/container';

/** Real component/CSS/controller rendering, isolated from production bindings. */
export async function adminPreview(kind: 'notbgg'|'collection'|'link'='notbgg') {
    async function compile(entry: string) {
        const css: string[] = [];
        const compiled = await build({ entryPoints: [entry], bundle: true, write: false,
            format: 'cjs', platform: 'node', packages: 'external', plugins: [{ name: 'admin-astro', setup(builder) {
                builder.onLoad({ filter: /\.css$/ }, async args => {
                    css.push(await readFile(args.path, 'utf8')); return { contents: '', loader: 'js' };
                });
                builder.onLoad({ filter: /\.astro$/ }, async args => {
                    const result = transform(await readFile(args.path, 'utf8'), { filename: args.path.replaceAll('\\', '/'),
                        internalURL: 'astro/compiler-runtime', resultScopedSlot: true, resolvePath: p => p });
                    for (const item of result.css) css.push(String(item));
                    if (result.diagnostics.some(item => item.severity === 'error')) throw new Error('Component compile failed');
                    return { contents: result.code.replace(/^import ["'][^"']+\?astro&type=style[^"']*["'];?$/gm, ''), loader: 'ts' };
                });
            } }] });
        const module = { exports: {} as { default: Parameters<experimental_AstroContainer['renderToString']>[0] } };
        new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
        return { component: module.exports.default, css: css.join('\n') };
    }
    const legacy = await compile(kind === 'link' ? 'src/components/NotBggLinkAdmin.astro' : kind === 'collection' ? 'src/components/CollectionAdmin.astro' : 'src/components/NotBggAdmin.astro');
    const editor = kind === 'notbgg' ? await compile('src/components/NotBggEditor.astro') : legacy;
    const container = await experimental_AstroContainer.create();
    const browser = await build({ stdin: { contents: kind==='link'?"import {initializeNotBggLinkAdmin} from './src/lib/notbgg-link-controller';document.querySelectorAll('[data-link-admin]').forEach(initializeNotBggLinkAdmin);":kind==='collection'?"import {initializeCollectionAdmin} from './src/lib/collection-admin-controller';document.querySelectorAll('[data-collection-admin]').forEach(initializeCollectionAdmin);":"import {initializeNotBggAdmin} from './src/lib/notbgg-admin-controller';document.querySelectorAll('[data-notbgg-admin]').forEach(initializeNotBggAdmin);", resolveDir: process.cwd() },
        bundle: true, write: false, format: 'iife', platform: 'browser' });
    return { javascript: browser.outputFiles[0].text, async html(mode: 'list' | 'new' | 'edit' | 'relations', id = '', lang: 'en' | 'zh-TW' = 'zh-TW', request?: Request) {
        const view = kind === 'notbgg' && mode !== 'list' ? editor : legacy;
        const html = await container.renderToString(view.component, { props: { mode, id, lang }, request });
        return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace('</head>', `<style>${view.css}</style></head>`)
            .replace('</body>', '<script src="/admin-fixture.js"></script></body>');
    } };
}
