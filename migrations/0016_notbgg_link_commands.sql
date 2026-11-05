-- D6: compare-and-swap on immutable mapping events. Applied only to isolated local D1 during development.
-- Legacy events remain untouched. D6 commands carry private preconditions in state_json.
CREATE TRIGGER notbgg_link_command_gate BEFORE INSERT ON notbgg_link_events
WHEN json_type(NEW.state_json,'$._expectedEventId') IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,'LINK_REVISION_CONFLICT') WHERE
 json_extract(NEW.state_json,'$._expectedEventId') <> COALESCE((
  SELECT MAX(e.id) FROM notbgg_link_events e JOIN notbgg_bgg_links l ON l.id=e.link_id
  WHERE l.seq=(SELECT seq FROM notbgg_bgg_links WHERE id=NEW.link_id)),0);
 SELECT RAISE(ABORT,'LINK_SOURCE_CONFLICT') WHERE NOT EXISTS (
  SELECT 1 FROM notbgg_bgg_links l JOIN notbgg_games n ON n.seq=l.seq WHERE l.id=NEW.link_id
  AND n.revision=json_extract(NEW.state_json,'$._profileRevision')
  AND (NEW.action='revoked' OR n.archived_at IS NULL)
  AND l.status=json_extract(NEW.state_json,'$.status')
  AND l.primary_source=json_extract(NEW.state_json,'$.primarySource'));
END;
CREATE TRIGGER notbgg_linked_type_guard BEFORE UPDATE OF type ON notbgg_games
WHEN NEW.type<>OLD.type AND EXISTS(SELECT 1 FROM notbgg_bgg_links l WHERE l.seq=OLD.seq AND l.status='linked')
BEGIN SELECT RAISE(ABORT,'NOTBGG_REVOKE_LINK_BEFORE_TYPE_CHANGE'); END;
