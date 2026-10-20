import fs from 'node:fs';
import path from 'node:path';

// Generate an inspectable SQLite SQL import. Does NOT connect to Cloudflare.
const root = process.cwd();
const arg = (key: string, fallback: string) => {
  const i = process.argv.indexOf(key);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const read = (p: string) => fs.readFileSync(path.resolve(root, p), 'utf8').replace(/^\uFEFF/, '');
const gamesPath = arg('--games', 'src/data/bgg-cache.json');
const collectionPath = arg('--collection', 'src/data/bgg-collection-cache.json');
const matchPath = arg('--matches', 'imports/10_Excel_BGG配對總覽.csv');
const sleevePath = arg('--sleeves', 'imports/12_牌套需求BGG關聯草稿.csv');
const output = arg('--output', 'imports/generated/0001_import_data.sql');
const games = JSON.parse(read(gamesPath)) as Record<string, any>;
const collection = JSON.parse(read(collectionPath)) as { items: Record<string, any[]> };

function csv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i+1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new Error('CSV has an unclosed quote');
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
function records(text: string): Record<string,string>[] {
  const [header, ...rows] = csv(text);
  if (!header) throw new Error('Empty CSV');
  return rows.map((row) => Object.fromEntries(header.map((h,i) => [h.trim(), (row[i] ?? '').trim()])));
}
const q = (s: unknown) => s === null || s === undefined ? 'NULL' : "'" + String(s).replace(/'/g,"''") + "'";
const int = (s: unknown) => /^\d+$/.test(String(s ?? '')) ? Number(s) : null;
const sql: string[] = ['-- Generated from local cache and reviewed Excel mapping CSVs.', '-- Run only against the LOCAL D1 database first.', 'PRAGMA foreign_keys=ON;', 'BEGIN TRANSACTION;'];
const push = (s: string) => sql.push(s);
const gameIds = new Set(Object.keys(games).map(Number));
for (const [key, game] of Object.entries(games)) {
  const id = int(key); if (!id || !game?.name) continue;
  const type = String(game.gameType ?? 'unknown');
  push(`INSERT INTO bgg_games(bgg_id,name,game_type,is_expansion) VALUES(${id},${q(game.name)},${q(type)},${type === 'boardgameexpansion' ? 1 : 0}) ON CONFLICT(bgg_id) DO UPDATE SET name=excluded.name,game_type=excluded.game_type,is_expansion=excluded.is_expansion,updated_at=CURRENT_TIMESTAMP;`);
}
let relationCount = 0;
const relationSeen = new Set<string>();
for (const [key, game] of Object.entries(games)) {
  const parent = int(key); if (!parent) continue;
  for (const [field, kind] of [['expansions','expansion'], ['implementations','implementation'], ['compilations','compilation']] as const) {
    for (const item of (Array.isArray(game[field]) ? game[field] : [])) {
      const child = int(item?.id); if (!child || !gameIds.has(child) || child === parent) continue;
      const k = `${parent}:${child}:${kind}`; if (relationSeen.has(k)) continue;
      relationSeen.add(k); relationCount++;
      push(`INSERT OR IGNORE INTO bgg_game_relations(parent_bgg_id,child_bgg_id,relation_type) VALUES(${parent},${child},${q(kind)});`);
    }
  }
}
const matches = records(read(matchPath));
const byRow = new Map<string,Record<string,string>>();
let exact = 0, unmatched = 0;
for (const m of matches) {
  const row = int(m['Excel列號']);
  if (!row || !m['Excel收藏項目']) throw new Error('Invalid match row: ' + JSON.stringify(m));
  const key = String(row); if (byRow.has(key)) throw new Error('Duplicate Excel row ' + key);
  byRow.set(key,m);
  const id = int(m['BGG_ID']);
  const validId = id && gameIds.has(id) ? id : null;
  const status = validId && m['配對狀態'] === '精確名稱配對' ? 'exact' : validId ? 'ambiguous' : 'unmatched';
  if (status === 'exact') exact++; else unmatched++;
  const source = `excel:sheet1:row:${row}`;
  // Manual assignments must not be overwritten on re-import.
  push(`INSERT INTO collection_items(source_key,source_row,source_serial,display_name,bgg_id,match_status,owned,notes) VALUES(${q(source)},${row},${q(m['流水號'])},${q(m['Excel收藏項目'])},${validId ?? 'NULL'},${q(status)},1,${q('Imported from Excel BGG mapping; review ownership and bundled components.')}) ON CONFLICT(source_key) DO UPDATE SET source_serial=excluded.source_serial,display_name=excluded.display_name,bgg_id=CASE WHEN collection_items.match_status='manual' THEN collection_items.bgg_id ELSE excluded.bgg_id END,match_status=CASE WHEN collection_items.match_status='manual' THEN 'manual' ELSE excluded.match_status END,updated_at=CURRENT_TIMESTAMP;`);
}
const details = records(read(sleevePath));
const sizes = new Set<string>();
let requirements = 0, skipped = 0;
for (const d of details) {
  const row = int(d['Excel列號']), seq = int(d['明細序號']), qty = int(d['需求張數']);
  if (!row || !seq || !byRow.has(String(row)) || qty === null) { skipped++; continue; }
  const rawSize = d['牌套尺寸_mm'].replace(/,/g,'.').replace(/[×X＊*]/g,'x');
  const m = rawSize.match(/^\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*$/i);
  if (!m) { skipped++; continue; }
  const width = Math.round(Number(m[1]) * 10), height = Math.round(Number(m[2]) * 10);
  if (width <= 0 || height <= 0) { skipped++; continue; }
  const sizeKey = `${width}:${height}`;
  if (!sizes.has(sizeKey)) {
    sizes.add(sizeKey);
    push(`INSERT OR IGNORE INTO sleeve_sizes(width_tenth_mm,height_tenth_mm,label) VALUES(${width},${height},${q(d['牌套尺寸_mm'])});`);
  }
  const source = `excel:sheet1:row:${row}:detail:${seq}`;
  const itemKey = `excel:sheet1:row:${row}`;
  // Unassigned component_id is intentional; do not invent base/expansion allocation.
  push(`INSERT INTO sleeve_requirements(source_key,collection_item_id,component_id,size_id,quantity_sheets,source_fragment,assignment_status,notes) SELECT ${q(source)},i.id,NULL,s.id,${qty},${q(d['原始片段'])},'unassigned',${q(d['備註'] || null)} FROM collection_items i JOIN sleeve_sizes s ON s.width_tenth_mm=${width} AND s.height_tenth_mm=${height} WHERE i.source_key=${q(itemKey)} ON CONFLICT(source_key) DO UPDATE SET quantity_sheets=excluded.quantity_sheets,source_fragment=excluded.source_fragment,updated_at=CURRENT_TIMESTAMP;`);
  requirements++;
}
push('COMMIT;');
const outputPath = path.resolve(root,output);
fs.mkdirSync(path.dirname(outputPath), {recursive:true});
fs.writeFileSync(outputPath,sql.join('\n')+'\n','utf8');
console.log(JSON.stringify({games:Object.keys(games).length,collectionRecords:Object.values(collection.items).flat().length,collectionExcelRows:matches.length,exact,other:unmatched,relationsWithBothCached:relationCount,requirements,skippedRequirements:skipped,sizes:sizes.size,output:outputPath},null,2));
if (skipped) { console.error('Some requirement rows were skipped. Review CSV before importing.'); process.exitCode = 2; }
