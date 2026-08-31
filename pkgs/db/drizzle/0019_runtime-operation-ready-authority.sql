ALTER TABLE `session_event`
ADD `runtime_operation_event_json` text
CONSTRAINT `session_event_runtime_operation_event_json_check`
CHECK (
  `runtime_operation_event_json` IS NULL
  OR (
    json_valid(`runtime_operation_event_json`) = 1
    AND json_extract(`runtime_operation_event_json`, '$.kind') IS 'agent.task.updated'
    AND json_type(`runtime_operation_event_json`, '$.payload') IS 'object'
    AND json_extract(`runtime_operation_event_json`, '$.payload.status') IN ('updating', 'ready')
    AND `semantic_hash` IS NOT NULL
    AND `event_type` = 'agent.task.updated'
  )
);
