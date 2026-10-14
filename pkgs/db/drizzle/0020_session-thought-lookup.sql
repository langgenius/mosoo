CREATE INDEX `session_event_session_thought_idx` ON `session_event` (`session_id`,CASE WHEN "event_type" LIKE 'thought.%'
        THEN "canonical_event_json" ->> '$.payload.thoughtId' END);