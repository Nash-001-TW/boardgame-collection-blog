-- Candidate-only objects in the disposable local D1. Not a product migration.
CREATE TABLE p3_s1_dates(copy_id INTEGER NOT NULL, definition_id INTEGER NOT NULL, checked_date TEXT NOT NULL, PRIMARY KEY(copy_id,definition_id));
CREATE TABLE p3_s1_applicability(copy_id INTEGER NOT NULL, definition_id INTEGER NOT NULL, applies INTEGER NOT NULL CHECK(applies IN(0,1)), PRIMARY KEY(copy_id,definition_id));
CREATE TABLE p3_s1_current(copy_id INTEGER PRIMARY KEY, status TEXT NOT NULL, n INTEGER NOT NULL, m INTEGER NOT NULL, u INTEGER NOT NULL, completed_date TEXT, confirmed_at TEXT);
CREATE TABLE p3_s1_events(id TEXT PRIMARY KEY, copy_id INTEGER NOT NULL, definition_id INTEGER, kind TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE p3_s1_results(request_id TEXT PRIMARY KEY, event_id TEXT, transition_id TEXT, gate INTEGER NOT NULL CHECK(gate=1));
CREATE TABLE p3_s1_guard(request_id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE p3_s1_probe(id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE p3_s1_values(case_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
