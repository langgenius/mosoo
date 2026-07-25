-- Collapse the retired `error` subject status into `cold`.
-- A failed activation now returns the runtime subject to `cold` (no live
-- container) with the failure kept in last_error, so the next run cold-starts a
-- fresh container and self-heals. Converge any rows still in the old `error`
-- state. Data-only and idempotent: a no-op when no such rows exist.
UPDATE `sandbox` SET `status` = 'cold', `status_event` = 'runtime_subject.cold' WHERE `status` = 'error';
