-- Synthetic-only seed for a fresh 0001–0023 database.
INSERT INTO v2_collection_items(id, display_name, record_scope) VALUES
  (301, 'MAJOR03 synthetic replay', 'test'),
  (302, 'MAJOR03 synthetic stale', 'test'),
  (303, 'MAJOR03 synthetic rollback', 'test'),
  (304, 'MAJOR03 synthetic null', 'test');

INSERT INTO v2_component_definitions(id, collection_item_id, component_name, component_type,
  quantity_unit, physical_creation_token, physical_revision, expected_quantity)
SELECT id, id, 'Cards', 'card', 'card', printf('%064x', id), 1,
  CASE WHEN id = 304 THEN NULL ELSE 103 END
FROM v2_collection_items WHERE id BETWEEN 301 AND 304;

INSERT INTO v2_physical_component_sources(definition_id, collection_item_id, record_scope,
  creation_token, actor, request_digest, signature)
SELECT id, id, 'test', physical_creation_token, 'major03-synthetic', printf('%064x', 1), printf('%064x', 2)
FROM v2_component_definitions WHERE id BETWEEN 301 AND 304;

INSERT INTO v2_owned_copies(id, collection_item_id, edition, inventory_status) VALUES
  (301, 301, 'Synthetic A', 'in_collection'),
  (302, 302, 'Synthetic A', 'in_collection'),
  (303, 303, 'Synthetic A', 'in_collection'),
  (304, 304, 'Synthetic A', 'in_collection'),
  (305, 301, 'Synthetic loan', 'loaned'),
  (306, 301, 'Synthetic sold', 'sold');

INSERT INTO v2_copy_components(owned_copy_id, component_definition_id, actual_quantity,
  inspection_status, last_checked_at, count_revision)
VALUES (301, 301, 99, 'checked', '2026-01-01 01:02:03', 1);
