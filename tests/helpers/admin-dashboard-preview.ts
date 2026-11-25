import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { transform } from '@astrojs/compiler-rs';
import { experimental_AstroContainer } from 'astro/container';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { sqliteD1 } from './sqlite-d1';

/** R01-only synthetic data; all writes are to disposable in-memory SQLite. */
export function r01Fixture(state: 'normal' | 'warning' | 'empty' | 'failure' = 'normal', failBatchAt?: number) {
    const sqlite = new DatabaseSync(':memory:');
    for (const file of readdirSync('migrations').filter(file => file.endsWith('.sql')).sort()) {
        sqlite.exec(readFileSync('migrations/' + file, 'utf8').replace(/^\uFEFF/, ''));
    }
    if (state !== 'empty') {
        sqlite.exec(`
            BEGIN;
            INSERT INTO v2_games(id,primary_name) VALUES (1,'Synthetic BGG'),(2,'Synthetic NotBGG');
            INSERT INTO v2_legacy_id_map(legacy_table,legacy_id,target_table,target_id) VALUES ('bgg_games',1,'v2_games',1);
            INSERT INTO notbgg_ids(seq, request_key, request_hash) VALUES (1,'synthetic','synthetic');
            INSERT INTO notbgg_games(seq, game_id, name, type) VALUES (1,2,'Synthetic NotBGG','boardgame');
            INSERT INTO notbgg_game_revisions(seq, revision, snapshot_json, actor) VALUES (1,1,'{}','fixture');
            INSERT INTO v2_collection_items(id,display_name,acquisition_status,wishlist,notes,record_scope) VALUES
              (1,'Owned','owned',0,NULL,'production'),
              (2,'Wishlist','owned',1,'{"owned":0}','production'),
              (3,'Preorder','preordered',0,'{"owned":1}','production'),
              (4,'Test','owned',1,NULL,'test');
            INSERT INTO v2_collection_management(collection_item_id,archived_at) VALUES (2,'2026-11-24');
            INSERT INTO v2_owned_copies(id,collection_item_id,copy_label) VALUES (1,1,'Synthetic');
            INSERT INTO v2_component_definitions(id,collection_item_id,component_name) VALUES (1,1,'Cards'),(2,4,'Test cards');
            INSERT INTO v2_copy_components(owned_copy_id,component_definition_id) VALUES (1,1);
            INSERT INTO v2_sleeve_sizes(id,width_tenth_mm,height_tenth_mm) VALUES (1,630,880),(2,450,680);
            INSERT INTO v2_sleeve_requirements(collection_item_id,size_id,quantity_sheets) VALUES (1,1,30),(4,1,30);
            INSERT INTO bgg_games(bgg_id,name,sync_status,last_attempt_at) VALUES
              (1,'Success','success','2026-11-24'),(2,'Pending','unknown','2026-11-24');
            INSERT INTO v2_purchase_orders(id,currency_code,item_subtotal_minor,refunded_minor,status) VALUES
              (1,'TWD',12000,2000,'paid'),(2,'JPY',500,0,'completed'),(3,'USD',1500,0,'partially_received'),
              (4,'TWD',3000,0,'open'),(5,'TWD',2000,0,'cancelled'),(6,'EUR',0,0,'paid');
            INSERT INTO v2_purchase_allocations(purchase_order_id,collection_item_id,owned_copy_id,allocated_minor,allocation_method) VALUES
              (1,1,NULL,7000,'manual'),(2,2,NULL,500,'weighted'),(3,NULL,1,1500,'direct'),
              (4,1,NULL,1000,'weighted'),(5,1,NULL,1000,'weighted'),(6,1,NULL,0,'manual');
            COMMIT;
        `);
    }
    if (state === 'warning') {
        // Model pre-existing malformed rows without changing the production schema or guards.
        sqlite.exec(`
            PRAGMA foreign_keys = OFF;
            DROP TRIGGER v2_allocation_validate_insert;
            INSERT INTO bgg_games(bgg_id,name,sync_status,last_attempt_at) VALUES (3,'Old failure','failed','2020-01-01');
            INSERT INTO v2_purchase_orders(id,currency_code,item_subtotal_minor,status) VALUES
              (7,'TWD',1000,'paid'),(8,'USD',2000,'paid'),(9,'TWD',200,'paid'),(10,'TWD',100,'paid'),
              (11,'TWD',100,'paid'),(12,'TWD',100,'paid'),(13,'TWD',100,'paid'),(14,'TWD',100,'paid');
            INSERT INTO v2_purchase_order_lines(id,purchase_order_id,line_number,description,collection_item_id) VALUES
              (1,8,1,'Same-order target',1),(2,13,1,'Mismatched target',2);
            INSERT INTO v2_purchase_allocations(purchase_order_id,purchase_order_line_id,collection_item_id,owned_copy_id,allocated_minor,allocation_method) VALUES
              (7,NULL,1,NULL,1500,'manual'),
              (8,1,1,NULL,1500,'weighted'),
              (9,1,1,NULL,200,'manual'),
              (10,NULL,NULL,999,100,'direct'),
              (11,NULL,999,NULL,100,'direct'),
              (12,999,1,NULL,100,'manual'),
              (13,2,1,NULL,100,'manual'),
              (14,NULL,1,NULL,10,'weighted'),(14,NULL,2,NULL,10,'manual');
            PRAGMA foreign_keys = ON;
        `);
    }
    const db = sqliteD1(sqlite);
    const prepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
        if (/\b(?:UNION|INTERSECT|EXCEPT)\b/i.test(sql)) throw new Error('Compound SELECT is forbidden in the R01 fixture');
        if (state === 'failure' && sql.includes('v2_component_definitions')) throw new Error('Synthetic component read failure');
        return prepare(sql);
    };
    if (failBatchAt !== undefined) {
        const batch = db.batch.bind(db);
        db.batch = <T>(statements: D1PreparedStatement[]) => batch<T>(
            statements.map((statement, index) => index === failBatchAt
                ? prepare('SELECT * FROM synthetic_missing_batch_table')
                : statement),
        );
    }
    return { sqlite, db };
}

/** R02 synthetic rows exercise production/test scopes without reading local bindings. */
export function r02Fixture(failure?: 'counts' | 'list') {
    const {sqlite} = r01Fixture('empty');
    sqlite.exec(`
        BEGIN;
        INSERT INTO bgg_games(bgg_id,name,last_success_at,cache_json) VALUES
          (900001,'Synthetic BGG','2026-11-24','{"thumbnail":"https://example.invalid/cover.webp","minPlayers":1,"maxPlayers":4}'),
          (900002,'Unsafe cover','2026-11-24','{"image":"javascript:invalid","minPlayers":2,"maxPlayers":5}');
        INSERT INTO v2_games(id,bgg_id,primary_name) VALUES
          (1,900001,'Synthetic BGG'),(2,NULL,'Synthetic NotBGG'),(3,900002,'Unsafe cover');
        INSERT INTO notbgg_ids(seq,request_key,request_hash) VALUES (1,'synthetic','synthetic');
        INSERT INTO notbgg_games(seq,game_id,name,type,min_players,max_players,image_url) VALUES
          (1,2,'Synthetic NotBGG','boardgame',2,5,'/images/admin/empty-no-result.webp');
        INSERT INTO notbgg_game_revisions(seq,revision,snapshot_json,actor) VALUES (1,1,'{}','fixture');
        INSERT INTO v2_collection_items(id,game_id,display_name,acquisition_status,wishlist,notes,record_scope,updated_at) VALUES
          (1,1,'Alpha','owned',0,NULL,'production','2026-11-24 17:00:00'),
          (2,1,'Alpha','owned',1,'{"owned":0}','production','2026-11-24 17:00:00'),
          (3,2,'Bravo','preordered',1,'{"owned":1}','production','2026-11-23'),
          (4,3,'Charlie','unknown',0,'plain text','production','2026-11-22'),
          (5,NULL,'Unknown players','owned',0,NULL,'production','2026-11-21'),
          (6,2,'Test record','owned',1,NULL,'test','2026-11-24');
        INSERT INTO v2_collection_management(collection_item_id,archived_at) VALUES (2,'2026-11-25');
        INSERT INTO v2_owned_copies(id,collection_item_id,copy_label,inventory_status) VALUES
          (1,1,'On shelf','in_collection'),(2,1,'Loaned','loaned'),(3,1,'Sold','sold'),(4,2,'Other','loaned');
        COMMIT;
    `);
    const insert = sqlite.prepare(`INSERT INTO v2_collection_items(id,game_id,display_name,updated_at)
        VALUES (?,2,?,'2026-11-20')`);
    for (let id = 10; id < 53; id++) insert.run(id, 'Synthetic edition ' + id);
    const db = sqliteD1(sqlite);
    const prepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
        if ((sql.match(/\b(?:UNION|INTERSECT|EXCEPT)\b/gi)?.length ?? 0) >= 4) {
            throw new Error('D1 compound SELECT term limit');
        }
        if ((failure === 'counts' && sql.includes('COUNT(*) AS "all"')) ||
            (failure === 'list' && sql.includes('bounds AS'))) throw new Error('Synthetic R02 read failure');
        return prepare(sql);
    };
    return {sqlite, db};
}

export function collectionDetailFixture(failure?: 'header' | 'copies') {
    const {db, sqlite} = r02Fixture();
    const prepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
        if ((failure === 'header' && sql.includes('AS game_name') && sql.includes('WITH static')) ||
            (failure === 'copies' && sql.includes('condition_details') && sql.includes('LIMIT 21'))) {
            throw new Error('Synthetic detail read failure');
        }
        return prepare(sql);
    };
    return {db, sqlite};
}

/** Test-only injected bindings; real Astro pages and real middleware, no dev exemption. */
export async function dashboardPreview(bindings: Record<string, unknown>, uiKit?: { dev: boolean }) {
    async function compile(entry: string) {
        const css: string[] = [];
        const compiled = await build({ entryPoints: [entry], bundle: true, write: false,
            format: 'cjs', platform: 'node', packages: 'external', define:{'import.meta.env.DEV':String(entry === 'src/pages/dev/ui-kit.astro' && uiKit?.dev === true)}, plugins: [{ name: 'admin-astro', setup(builder) {
                builder.onResolve({ filter: /^(cloudflare:workers|astro:middleware)$/ }, args => ({path:args.path,namespace:'test-bindings'}));
                builder.onLoad({filter:/.*/,namespace:'test-bindings'},args=>({contents:args.path==='cloudflare:workers'?'export const env=TEST_BINDINGS;':'export const defineMiddleware=fn=>fn;',loader:'js'}));
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
        new Function('TEST_BINDINGS','require', 'module', 'exports', compiled.outputFiles[0].text)(bindings,createRequire(import.meta.url), module, module.exports);
        return { exports: module.exports, component: module.exports.default, css: css.join('\n') };
    }

 const views = new Map();
 for (const [route,entry] of uiKit ? [['/dev/ui-kit','src/pages/dev/ui-kit.astro']] : [
  ['/admin','src/pages/admin/index.astro'],
  ['/admin/sleeves','src/pages/admin/sleeves/index.astro'],
  ['/admin/purchases','src/pages/admin/purchases/index.astro'],
  ['/admin/bgg','src/pages/admin/bgg/index.astro'],
  ['/admin/sleeves/requirements','src/pages/admin/sleeves/requirements.astro'],
  ['/admin/collection','src/pages/admin/collection/index.astro'],
  ['/admin/collection/copies','src/pages/admin/collection/[id]/copies.astro'],
  ['/admin/collection/components/classification','src/pages/admin/collection/components/classification.astro'],
  ['/admin/collection/components/manage','src/pages/admin/collection/components/manage.astro'],
  ['/admin/collection/new','src/pages/admin/collection/new.astro'],
  ['/admin/collection/[id]','src/pages/admin/collection/[id].astro'],
  ['/admin/notbgg','src/pages/admin/notbgg/index.astro'],
  ['/admin/notbgg/new','src/pages/admin/notbgg/new.astro'],
  ['/admin/notbgg/[id]','src/pages/admin/notbgg/[id].astro'],
  ['/admin/notbgg/[id]/link','src/pages/admin/notbgg/[id]/link.astro'],
  ['/admin/notbgg/[id]/relations','src/pages/admin/notbgg/[id]/relations.astro']
 ]) views.set(route,await compile(entry));
 const middleware=await compile('src/middleware.ts');
 const container=await experimental_AstroContainer.create();
 return async (request:Request):Promise<Response> => {
  const url=new URL(request.url),copyRoute=url.pathname.match(/^\/admin\/collection\/([1-9][0-9]*)\/copies\/?$/);
  const collectionRoute=url.pathname.match(/^\/admin\/collection\/([1-9][0-9]*)\/?$/);
  const notBggRoute=url.pathname.match(/^\/admin\/notbgg\/([0-9]{6,})(?:\/(link|relations))?\/?$/);
  const id=copyRoute?.[1] ?? collectionRoute?.[1] ?? notBggRoute?.[1];
  let route=url.pathname;
  if(copyRoute) route='/admin/collection/copies';
  if(collectionRoute) route='/admin/collection/[id]';
  if(notBggRoute) route='/admin/notbgg/[id]' + (notBggRoute[2] ? '/' + notBggRoute[2] : '');
  const view=views.get(route);
  if(!view)return new Response('Not found',{status:404});
  return (middleware.exports as any).onRequest({request,url},async()=>{
   const response=await container.renderToResponse(view.component,{request,params:id?{id}:{}});
   const html=await response.text();
   if (route === '/dev/ui-kit') return new Response(html.replace('</head>','<style>' + view.css + '</style></head>'),{status:response.status,headers:response.headers});
   return new Response(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('</head>',`<style>${view.css}</style></head>`),{status:response.status,headers:response.headers});
  });
 };
}
