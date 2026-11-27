import type {DatabaseSync} from 'node:sqlite';
import {parseBggGameXml} from '../../src/lib/bgg-parser.ts';
import {bggXml} from './bgg-sync-fixture.ts';

export const baseName = 'Tiny Epic Cthulhu';
export const expansionName = 'Tiny Epic Cthulhu: Cult of Chaos';
export const compilationName = 'Tiny Epic Cthulhu: Deluxe Edition';

export function seedXrelB(sqlite: DatabaseSync, crossLayer = false) {
 sqlite.exec(`
  INSERT INTO v2_games(id,bgg_id,primary_name,game_type) VALUES
   (228,408254,'${expansionName}','expansion'),(231,404893,'${baseName}','base');
  INSERT INTO v2_collection_items(${crossLayer ? 'id,' : ''}game_id,display_name,item_type,acquisition_status) VALUES
   (${crossLayer ? '263,' : ''}228,'小小史詩克蘇魯：混亂教團擴充','expansion','owned'),
   (${crossLayer ? '262,' : ''}231,'小小史詩克蘇魯','base','owned');
 `);
 const cache = sqlite.prepare(`INSERT INTO bgg_games(bgg_id,name,cache_json,last_success_at,sync_status)
  VALUES(?,?,?,CURRENT_TIMESTAMP,'success')`);
 const game = (id: number, name: string, type: string, links: string) =>
  parseBggGameXml(bggXml(id,type,links).replace('Fixture '+id,name));
 const base = game(404893,baseName,'boardgame',
  `<link type="boardgameexpansion" id="408254" value="${expansionName}" inbound="true"/>`+
  `<link type="boardgamecompilation" id="408253" value="${compilationName}"/>`);
 // The existing resolver requires an explicit inbound claim from the expansion.
 const expansion = game(408254,expansionName,'boardgameexpansion',
  `<link type="boardgameexpansion" id="404893" value="${baseName}" inbound="true"/>`);
 for(const row of [base,expansion])cache.run(row.bggId,row.name,JSON.stringify(row));
 sqlite.exec(`INSERT INTO v2_game_relations(id,source_game_id,target_game_id,relation_type,relation_source,admin_confirmed,admin_revision)
  VALUES(1,228,231,'expansion_of','manual',1,1)`);
 if (!crossLayer) return;
 sqlite.exec(`
  INSERT INTO v2_games(id,bgg_id,primary_name,game_type) VALUES
   (229,466375,'Game mat','accessory'),(230,466374,'Player mat','accessory');
  INSERT INTO v2_collection_items(id,game_id,display_name,item_type,acquisition_status) VALUES
   (264,229,'小小史詩克蘇魯：遊戲墊','accessory','owned'),(265,230,'小小史詩克蘇魯：玩家墊','accessory','owned');
  INSERT INTO v2_collection_relations(id,source_item_id,target_item_id,relation_type) VALUES
   (1,263,262,'expansion_of'),(2,264,262,'accessory_for'),(3,265,262,'accessory_for');
 `);
 for (const [id,name] of [[466375,'Game mat'],[466374,'Player mat']] as const) {
  cache.run(id,name,JSON.stringify(game(id,name,'boardgameaccessory','')));
 }
}
