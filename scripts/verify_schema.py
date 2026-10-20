"""Verify the Cloudflare D1 migration with Python's built-in SQLite (no external packages)."""
import pathlib
import sqlite3

root = pathlib.Path(__file__).resolve().parents[1]
sql = (root / 'migrations' / '0001_sleeve_management.sql').read_text(encoding='utf-8')
con = sqlite3.connect(':memory:')
con.execute('PRAGMA foreign_keys=ON')
con.executescript(sql)
con.executescript(sql)  # safe to rerun in a test database
names = [row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
assert len(names) == 8, names
con.execute("INSERT INTO bgg_games (bgg_id,name) VALUES (91872,'Legend of Drizzt')")
con.execute("INSERT INTO collection_items (source_key,display_name,bgg_id,match_status) VALUES ('excel:sheet1:row:8','龍與地下城：崔斯特傳奇',91872,'exact')")
con.execute("INSERT INTO sleeve_sizes (width_tenth_mm,height_tenth_mm) VALUES (635,880)")
con.execute("INSERT INTO sleeve_requirements (source_key,collection_item_id,size_id,quantity_sheets) VALUES ('excel:sheet1:row:8:detail:1',1,1,200)")
con.execute("INSERT INTO sleeve_products (size_id,brand,product_name,sheets_per_pack) VALUES (1,'測試品牌','測試牌套',100)")
con.execute("INSERT INTO sleeve_inventory_transactions (product_id,transaction_type,transaction_date,pack_count,sheets_per_pack_snapshot,quantity_sheets) VALUES (1,'PURCHASE','2026-10-13',2,100,200)")
con.execute("INSERT INTO sleeve_inventory_transactions (product_id,transaction_type,transaction_date,quantity_sheets,collection_item_id) VALUES (1,'USE','2026-10-13',-70,1)")
assert con.execute('SELECT balance_sheets FROM v_sleeve_inventory_balance').fetchone()[0] == 130
assert con.execute('SELECT total_sheets FROM v_sleeve_requirements_by_size').fetchone()[0] == 200
try:
    con.execute("INSERT INTO sleeve_inventory_transactions (product_id,transaction_type,transaction_date,pack_count,sheets_per_pack_snapshot,quantity_sheets) VALUES (1,'PURCHASE','2026-10-13',2,100,100)")
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError('Invalid pack count should fail')
print('PASS: migration repeatable; 8 tables; 2 views; FK and purchase quantity checks; stock balance 130; demand 200')
