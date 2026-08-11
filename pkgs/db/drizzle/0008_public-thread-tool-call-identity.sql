ALTER TABLE `session_event` ADD `tool_call_id` text;--> statement-breakpoint
ALTER TABLE `session_event` ADD `tool_input_json` text;--> statement-breakpoint
ALTER TABLE `session_event` ADD `tool_name` text;--> statement-breakpoint
CREATE TRIGGER `session_event_tool_identity_consistency`
BEFORE INSERT ON `session_event`
WHEN NEW.`tool_call_id` IS NOT NULL AND EXISTS (
  SELECT 1
  FROM `session_event` AS existing
  WHERE existing.`session_id` = NEW.`session_id`
    AND existing.`tool_call_id` = NEW.`tool_call_id`
    AND (
      (
        NEW.`tool_name` IS NOT NULL
        AND existing.`tool_name` IS NOT NULL
        AND NEW.`tool_name` <> existing.`tool_name`
      )
      OR (
        NEW.`tool_input_json` IS NOT NULL
        AND existing.`tool_input_json` IS NOT NULL
        AND NEW.`tool_input_json` <> existing.`tool_input_json`
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'session_event tool identity conflict');
END;
