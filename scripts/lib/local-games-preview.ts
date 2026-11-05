// In-memory rendering for local UI previews/tests. Never loads Astro's Cloudflare config.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { transform } from "@astrojs/compiler-rs";
import { experimental_AstroContainer } from "astro/container";
import { getGames, getGameDetails } from "../../src/lib/games.ts";
import { loadPublicCatalog, resolveNotBggPage } from "../../src/lib/notbgg-public.ts";
import {bggIdentityDecision} from "../../src/lib/bgg-identity-gateway.ts";
import {publicIdentityIndex} from "../../src/lib/identity-resolution.ts";
import { isNotBggId } from "../../src/lib/game-identity.ts";
import { CollectionV2Repository } from "../../src/lib/collection-v2-repository.ts";
import { adaptCollectionV2Rows } from "../../src/lib/collection-v2-adapter.ts";
import { translateGameName } from "../../src/i18n/utils.ts";

export async function createLocalGamesPreview(options?: { publicDb:D1Database }) {
    const css = new Set<string>();
    const scripts = new Map<string, { code: string; directory: string }>();
    async function compile(file: string) {
        const bundle = await build({ entryPoints: [file], bundle: true, write: false,
            format: "cjs", platform: "node", packages: "external", plugins: [{ name: "local-astro",
                setup(builder) {
                    builder.onLoad({ filter: /\.astro$/ }, async args => {
                        const filename = args.path.replaceAll("\\", "/");
                        const result = transform(await fs.readFile(args.path, "utf8"), {
                            filename, internalURL: "astro/compiler-runtime", resultScopedSlot: true, resolvePath: p => p
                        });
                        const errors = result.diagnostics.filter(d => d.severity === "error");
                        if (errors.length) throw new Error(`Astro compilation failed: ${file}`);
                        result.css.forEach(style => css.add(typeof style === "string" ? style : String(style)));
                        result.scripts.forEach((script, i) => {
                            if (typeof script.code === "string") scripts.set(`${filename}:${i}`, { code: script.code, directory: path.dirname(args.path) });
                        });
                        return { contents: result.code.replace(/^import ["'][^"']+\?astro&type=style[^"']*["'];?$/gm, ""), loader: "ts" };
                    });
                    builder.onLoad({ filter: /\.css$/ }, async args => { css.add(await fs.readFile(args.path, "utf8")); return { contents: "", loader: "js" }; });
                }
            }] });
        const module = { exports: {} as { default: Parameters<experimental_AstroContainer["renderToString"]>[0] } };
        new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
        return module.exports.default;
    }
    const [list, detail, layout, home, notbggDetail, collectionPage] = await Promise.all([
        compile("src/components/GameList.astro"), compile("src/components/GameDetail.astro"), compile("src/layouts/Layout.astro"), compile("src/components/HomePage.astro"), ...(options ? [compile("src/components/NotBggDetail.astro"),compile("src/components/CollectionPage.astro")] : [])
    ]);
    const container = await experimental_AstroContainer.create();
    const browser = await build({ stdin: { contents: [...scripts.keys()].map(id => `import ${JSON.stringify(`preview-script:${id}`)};`).join("\n"), resolveDir: process.cwd() },
        bundle: true, write: false, format: "iife", platform: "browser", plugins: [{ name: "local-scripts",
            setup(builder) {
                builder.onResolve({ filter: /^preview-script:/ }, args => ({ path: args.path.slice(15), namespace: "preview" }));
                builder.onLoad({ filter: /.*/, namespace: "preview" }, args => {
                    const script = scripts.get(args.path)!;
                    return { contents: script.code, loader: "ts", resolveDir: script.directory };
                });
            }
        }] });
    return {
        javascript: browser.outputFiles[0].text,
        async redirect(url:URL){
            if(!options)return null;
            const decision=await bggIdentityDecision(new Request(url),options.publicDb,getGames());if(decision?.redirect)return decision.redirect+url.search;
            const segment=url.pathname.match(/^\/(?:en\/)?games\/notbgg\/([^/]+)\/?$/)?.[1],id=`NotBGG:${segment}`;
            if(segment&&isNotBggId(id)){const result=await resolveNotBggPage(options.publicDb,id,getGames(),url.pathname.startsWith('/en/')?'en':'zh-TW');if(result.redirect)return result.redirect+url.search;}
            return null;
        },
        async html(url: URL) {
            const lang = /^\/en(?:\/|$)/.test(url.pathname) ? "en" : "zh-TW";
            const isHome = ["/", "/en", "/en/"].includes(url.pathname);
            const slug = url.pathname.match(/^\/(?:en\/)?games\/([^/]+)\/?$/)?.[1];
            const game = slug ? getGameDetails().find(game => game.slug === decodeURIComponent(slug)) : null;
            if (slug && !game) return null;
            const notbggSegment = url.pathname.match(/^\/(?:en\/)?games\/notbgg\/([^/]+)\/?$/)?.[1];
            const notbggId=`NotBGG:${notbggSegment}`;
            const resolvedPage=notbggSegment&&options&&isNotBggId(notbggId)?await resolveNotBggPage(options.publicDb,notbggId,getGames(),lang):null;
            const publicDetail=resolvedPage?.detail??null;
            if(notbggSegment&&!publicDetail)return null;
            const publicCatalog=options&&!game&&!isHome&&!publicDetail?await loadPublicCatalog(getGames(),options.publicDb,lang):null;
            const collectionGames=options&&/^\/(?:en\/)?collection\/?$/.test(url.pathname)?adaptCollectionV2Rows(await new CollectionV2Repository(options.publicDb).getProductionItems(),lang):null;
            const content = await container.renderToString(collectionGames ? collectionPage : publicDetail ? notbggDetail : isHome ? home : game ? detail : list, { request:new Request(url), props: collectionGames ? {collectionGames,lang} : publicDetail ? {detail:publicDetail,lang} : isHome ? { lang } : game ? { game, lang } : { games: getGames(), lang, ...(publicCatalog ? {payload:publicCatalog.payload,live:true} : {}) } });
            const heading = collectionGames || publicDetail || game || isHome ? "" : `<h1>${lang === "en" ? "Game Database" : "遊戲資料庫"}</h1><p>${lang === "en" ? "Browse every imported game, expansion and accessory." : "探索基本遊戲、擴充與配件，尋找下一款桌遊。"}</p>`;
            const html = await container.renderToString(layout, { request: new Request(url), props: {
                title: publicDetail ? publicDetail.game.name : isHome ? "Home" : game ? translateGameName(game.bggId, game.bgg.name, lang) : (lang === "en" ? "Game Database" : "遊戲資料庫"), lang, canonical:game||publicDetail?url.origin+url.pathname:undefined, catalogPage: !isHome&&!collectionGames, detailPage: !!game||!!publicDetail
            }, slots: { default: heading + (resolvedPage?.identity?`<p data-identity-notice>${resolvedPage.identity.notBggId} · BGG #${resolvedPage.identity.bggId}</p>`:game&&options?await publicIdentityIndex(options.publicDb,getGames()).then(index=>{const i=index.byBgg.get(game.bggId);return i?`<p data-identity-notice>${i.notBggId} · BGG #${i.bggId}</p>`:'';}):'') + content } });
            // The local harness supplies the actual compiled component scripts as one bundle.
            return html.replace(/<script\b(?![^>]*type="application\/json")[^>]*>[\s\S]*?<\/script>/g, "").replace("</head>", `<style>${[...css].join("\n")}</style></head>`)
                .replace("</body>", '<script src="/preview-games.js"></script></body>');
        }
    };
}
