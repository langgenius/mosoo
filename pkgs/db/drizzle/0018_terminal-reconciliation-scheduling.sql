ALTER TABLE `session_run`
ADD `terminal_reconciliation_attempted_at` integer
CHECK (
  `terminal_reconciliation_attempted_at` IS NULL
  OR `terminal_reconciliation_attempted_at` >= 0
);
--> statement-breakpoint
CREATE INDEX `session_run_terminal_reconciliation_attempt_idx`
ON `session_run` (
  COALESCE(`terminal_reconciliation_attempted_at`, `updated_at`),
  `id`
);
