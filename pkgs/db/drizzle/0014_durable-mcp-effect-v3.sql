CREATE TABLE `__durable_mcp_v3_loss_guard` (
	`candidate_count` integer NOT NULL,
	CONSTRAINT "durable_mcp_v3_loss_guard_check" CHECK(`candidate_count` = 0)
);
--> statement-breakpoint
WITH `effect_source` AS (
	SELECT
		`effect`.`id` AS `effect_id`,
		`effect`.`status` AS `effect_status`,
		`effect`.`provider_receipt_json` AS `effect_provider_receipt_json`,
		`effect`.`result_json` AS `effect_result_json`,
		`command`.`error_json` AS `command_error_json`,
		`command`.`payload_json` AS `command_payload_json`,
		`command`.`result_json` AS `command_result_json`,
		`command`.`status` AS `command_status`,
		max(
			COALESCE(length(CAST(`effect`.`result_json` AS BLOB)), 0),
			COALESCE((
				SELECT max(length(CAST(`attempt`.`result_json` AS BLOB)))
				FROM `external_tool_effect_attempt` AS `attempt`
				WHERE `attempt`.`effect_id` = `effect`.`id`
					AND `attempt`.`status` = 'succeeded'
			), 0),
			COALESCE(length(CAST(`command`.`result_json` AS BLOB)), 0)
		) AS `original_result_bytes`
	FROM `external_tool_effect` AS `effect`
	INNER JOIN `driver_command` AS `command` ON `command`.`id` = `effect`.`command_id`
),
`effect_result_classified` AS (
	SELECT
		`effect_source`.*,
		`effect_status` = 'succeeded' AND (
			`original_result_bytes` > 1044480
			OR length(CAST('{"kind":"succeeded","result":' || `effect_result_json` || '}' AS BLOB)) > 1044480
		) AS `result_omitted`
	FROM `effect_source`
),
`effect_result_target` AS (
	SELECT
		`effect_result_classified`.*,
		CASE
			WHEN `result_omitted` THEN
				'{"isError":true,"outputText":' || json_quote('Stored MCP result omitted because it contained ' || `original_result_bytes` || ' UTF-8 bytes.') ||
				',"requestId":' || json_quote(json_extract(`command_payload_json`, '$.requestId')) ||
				',"serverId":' || json_quote(json_extract(`command_payload_json`, '$.serverId')) ||
				',"toolName":' || json_quote(json_extract(`command_payload_json`, '$.toolName')) || '}'
			WHEN `effect_status` = 'succeeded' THEN `effect_result_json`
			ELSE NULL
		END AS `normalized_result_json`
	FROM `effect_result_classified`
),
`effect_target` AS (
	SELECT
		`effect_result_target`.*,
		CASE
			WHEN `effect_status` <> 'succeeded' THEN NULL
			WHEN `effect_provider_receipt_json` IS NULL THEN NULL
			WHEN length(CAST(
				'{"kind":"succeeded","providerReceiptJson":' || json_quote(`effect_provider_receipt_json`) ||
				',"result":' || `normalized_result_json` || '}'
			AS BLOB)) > 1044480 THEN NULL
			ELSE `effect_provider_receipt_json`
		END AS `normalized_provider_receipt_json`
	FROM `effect_result_target`
),
`loss_candidates` (`category`, `id`) AS (
	SELECT `category`.`value`, `command`.`id`
	FROM `driver_command` AS `command`
	CROSS JOIN json_each(json_array(
		'command_payload_conflict',
		'mcp_argument_omission',
		'input_text_omission',
		'input_start_result_omission',
		'control_reason_omission',
		'permission_payload_rewrite',
		'command_error_omission'
	)) AS `category`
	WHERE CASE `category`.`value`
		WHEN 'command_payload_conflict' THEN
			EXISTS (
				SELECT `key`
				FROM json_each(`command`.`payload_json`)
				GROUP BY `key`
				HAVING COUNT(*) > 1
			)
			OR (
				`command`.`kind` = 'input.start'
				AND EXISTS (
					SELECT `key`
					FROM json_each(`command`.`payload_json`, '$.input')
					GROUP BY `key`
					HAVING COUNT(*) > 1
				)
			)
		WHEN 'mcp_argument_omission' THEN
			`command`.`kind` = 'mcp.execute'
			AND length(CAST(json_set(
				`command`.`payload_json`,
				'$.commandId', `command`.`id`,
				'$.runId', (
					SELECT `effect`.`session_run_id`
					FROM `external_tool_effect` AS `effect`
					WHERE `effect`.`command_id` = `command`.`id`
					LIMIT 1
				)
			) AS BLOB)) > 824448
		WHEN 'input_text_omission' THEN
			`command`.`kind` = 'input.start'
			AND length(CAST(`command`.`payload_json` AS BLOB)) > 824448
		WHEN 'input_start_result_omission' THEN
			`command`.`kind` = 'input.start'
			AND `command`.`result_json` IS NOT NULL
			AND json_type(`command`.`result_json`) <> 'null'
			AND (
				length(CAST(`command`.`payload_json` AS BLOB)) > 824448
				OR length(CAST(`command`.`result_json` AS BLOB)) > 1044480
			)
		WHEN 'control_reason_omission' THEN
			`command`.`kind` IN ('turn.cancel', 'session.stop')
			AND length(CAST(`command`.`payload_json` AS BLOB)) > 824448
		WHEN 'permission_payload_rewrite' THEN
			`command`.`kind` = 'permission.resolve'
			AND length(CAST(`command`.`payload_json` AS BLOB)) > 824448
		WHEN 'command_error_omission' THEN
			`command`.`error_json` IS NOT NULL
			AND length(CAST(`command`.`error_json` AS BLOB)) > 1044480
			AND NOT EXISTS (
				SELECT 1
				FROM `external_tool_effect` AS `effect`
				WHERE `effect`.`command_id` = `command`.`id` AND `effect`.`status` = 'succeeded'
			)
		ELSE 0
	END
	UNION ALL
	SELECT `category`.`value`, `target`.`effect_id`
	FROM `effect_target` AS `target`
	CROSS JOIN json_each(json_array(
		'mcp_result_omission',
		'mcp_result_conflict',
		'provider_receipt_loss',
		'mcp_command_terminal_conflict'
	)) AS `category`
	WHERE CASE `category`.`value`
		WHEN 'mcp_result_omission' THEN `target`.`result_omitted`
		WHEN 'mcp_result_conflict' THEN
			(
				NOT `target`.`result_omitted`
				AND (
					(`target`.`effect_status` <> 'succeeded' AND `target`.`effect_result_json` IS NOT NULL)
					OR (
						`target`.`effect_status` = 'succeeded'
						AND `target`.`command_result_json` IS NOT NULL
						AND json_type(`target`.`command_result_json`) <> 'null'
						AND `target`.`command_result_json` IS NOT `target`.`effect_result_json`
					)
					OR EXISTS (
						SELECT 1
						FROM `external_tool_effect_attempt` AS `attempt`
						WHERE `attempt`.`effect_id` = `target`.`effect_id`
							AND `attempt`.`result_json` IS NOT NULL
							AND (
								`attempt`.`status` <> 'succeeded'
								OR `target`.`normalized_result_json` IS NULL
								OR `attempt`.`result_json` IS NOT `target`.`effect_result_json`
							)
					)
				)
			)
			OR (
				`target`.`effect_result_json` IS NOT NULL
				AND EXISTS (
					SELECT `key`
					FROM json_each(`target`.`effect_result_json`)
					GROUP BY `key`
					HAVING COUNT(*) > 1
				)
			)
			OR (
				`target`.`command_result_json` IS NOT NULL
				AND EXISTS (
					SELECT `key`
					FROM json_each(`target`.`command_result_json`)
					GROUP BY `key`
					HAVING COUNT(*) > 1
				)
			)
			OR EXISTS (
				SELECT 1
				FROM `external_tool_effect_attempt` AS `attempt`
				WHERE `attempt`.`effect_id` = `target`.`effect_id`
					AND `attempt`.`result_json` IS NOT NULL
					AND EXISTS (
						SELECT `key`
						FROM json_each(`attempt`.`result_json`)
						GROUP BY `key`
						HAVING COUNT(*) > 1
					)
			)
		WHEN 'provider_receipt_loss' THEN
			`target`.`effect_provider_receipt_json` IS NOT `target`.`normalized_provider_receipt_json`
			OR EXISTS (
				SELECT 1
				FROM `external_tool_effect_attempt` AS `attempt`
				WHERE `attempt`.`effect_id` = `target`.`effect_id`
					AND `attempt`.`provider_receipt_json` IS NOT NULL
					AND `attempt`.`provider_receipt_json` IS NOT CASE
						WHEN `attempt`.`status` = 'succeeded' THEN `target`.`normalized_provider_receipt_json`
						ELSE NULL
					END
			)
		WHEN 'mcp_command_terminal_conflict' THEN
			`target`.`effect_status` = 'succeeded'
			AND (
				`target`.`command_status` <> 'completed' OR `target`.`command_error_json` IS NOT NULL
			)
		ELSE 0
	END
	UNION ALL
	SELECT 'orphan_effect', `effect`.`id`
	FROM `external_tool_effect` AS `effect`
	WHERE NOT EXISTS (
		SELECT 1 FROM `driver_command` AS `command` WHERE `command`.`id` = `effect`.`command_id`
	)
	UNION ALL
	SELECT DISTINCT 'attempt_completion_time_fabrication', `attempt`.`effect_id`
	FROM `external_tool_effect_attempt` AS `attempt`
	WHERE `attempt`.`status` IN ('succeeded', 'unknown')
		AND `attempt`.`completed_at` IS NULL
	UNION ALL
	SELECT 'session_run_error_omission', `run`.`id`
	FROM `session_run` AS `run`
	WHERE `run`.`error_code` IS NOT NULL
		AND `run`.`error_message` IS NOT NULL
		AND length(CAST(
			'{"code":' || json_quote(`run`.`error_code`) ||
			',"details":' || COALESCE(NULLIF(`run`.`error_details_json`, ''), '{}') ||
			',"message":' || json_quote(`run`.`error_message`) ||
			',"retryable":false}'
		AS BLOB)) > 1044480
)
INSERT INTO `__durable_mcp_v3_loss_guard` (`candidate_count`)
SELECT COUNT(*) FROM `loss_candidates`;
--> statement-breakpoint
DROP TABLE `__durable_mcp_v3_loss_guard`;
--> statement-breakpoint
CREATE TABLE `__durable_mcp_v3_nonterminal_guard` (
	`nonterminal_count` integer NOT NULL,
	CONSTRAINT "durable_mcp_v3_nonterminal_guard_check" CHECK(`nonterminal_count` = 0)
);
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_nonterminal_guard` (`nonterminal_count`) SELECT COUNT(*) FROM `driver_command` WHERE `status` IN ('queued', 'delivered', 'accepted');
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_nonterminal_guard` (`nonterminal_count`)
SELECT COUNT(*)
FROM `driver_command` AS `command`
WHERE `command`.`kind` = 'mcp.execute'
	AND NOT EXISTS (SELECT 1 FROM `external_tool_effect` AS `effect` WHERE `effect`.`command_id` = `command`.`id`);
--> statement-breakpoint
DROP TABLE `__durable_mcp_v3_nonterminal_guard`;
--> statement-breakpoint
ALTER TABLE `driver_command` ADD `driver_generation` integer
	CONSTRAINT "driver_command_generation_check" CHECK(`driver_generation` IS NULL OR (typeof(`driver_generation`) = 'integer' AND `driver_generation` BETWEEN 0 AND 9007199254740991))
	CONSTRAINT "driver_command_nonterminal_generation_check" CHECK(`status` IN ('completed', 'failed', 'expired', 'cancelled') OR `driver_generation` IS NOT NULL);
--> statement-breakpoint
CREATE TABLE `__durable_mcp_v3_source_guard` (
	`violation_count` integer NOT NULL,
	CONSTRAINT "durable_mcp_v3_source_guard_check" CHECK(`violation_count` = 0)
);
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_source_guard` (`violation_count`)
SELECT COUNT(*)
FROM `driver_command`
WHERE NOT json_valid(`payload_json`)
	OR (`result_json` IS NOT NULL AND NOT json_valid(`result_json`))
	OR (`error_json` IS NOT NULL AND NOT json_valid(`error_json`));
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_source_guard` (`violation_count`)
SELECT COUNT(*)
FROM `driver_command` AS `command`
WHERE json_type(`command`.`payload_json`) IS NOT 'object'
	OR json_type(`command`.`payload_json`, '$.commandId') IS NOT 'text'
	OR length(json_extract(`command`.`payload_json`, '$.commandId')) = 0
	OR json_extract(`command`.`payload_json`, '$.commandId') IS NOT `command`.`id`
	OR json_type(`command`.`payload_json`, '$.kind') IS NOT 'text'
	OR json_extract(`command`.`payload_json`, '$.kind') IS NOT `command`.`kind`
	OR `command`.`kind` NOT IN ('turn.cancel', 'input.start', 'mcp.execute', 'session.stop', 'permission.resolve')
	OR (`command`.`kind` = 'turn.cancel' AND EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`) WHERE `key` NOT IN ('commandId', 'kind', 'reason')))
	OR (`command`.`kind` = 'turn.cancel' AND json_type(`command`.`payload_json`, '$.reason') IS NOT NULL AND json_type(`command`.`payload_json`, '$.reason') IS NOT 'text')
	OR (`command`.`kind` = 'input.start' AND (
		json_type(`command`.`payload_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.requestId')) = 0
		OR json_type(`command`.`payload_json`, '$.runId') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.runId')) = 0
		OR json_type(`command`.`payload_json`, '$.input') IS NOT 'object'
		OR json_type(`command`.`payload_json`, '$.input.text') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.input.text')) = 0
		OR (json_type(`command`.`payload_json`, '$.input.attachmentIds') IS NOT NULL AND json_type(`command`.`payload_json`, '$.input.attachmentIds') IS NOT 'array')
		OR EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`, '$.input.attachmentIds') WHERE `type` <> 'text' OR length(`value`) = 0)
		OR EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`) WHERE `key` NOT IN ('commandId', 'input', 'kind', 'requestId', 'runId'))
		OR EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`, '$.input') WHERE `key` NOT IN ('attachmentIds', 'text'))
	))
	OR (`command`.`kind` = 'mcp.execute' AND (
		json_type(`command`.`payload_json`, '$.argumentsJson') IS NOT 'text'
		OR json_type(`command`.`payload_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.requestId')) = 0
		OR json_type(`command`.`payload_json`, '$.serverId') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.serverId')) = 0
		OR json_type(`command`.`payload_json`, '$.toolCallId') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.toolCallId')) = 0
		OR json_type(`command`.`payload_json`, '$.toolName') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.toolName')) = 0
		OR EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`) WHERE `key` NOT IN ('argumentsJson', 'commandId', 'kind', 'requestId', 'serverId', 'toolCallId', 'toolName'))
	))
	OR (`command`.`kind` = 'session.stop' AND (
		json_type(`command`.`payload_json`, '$.reason') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.reason')) = 0
		OR EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`) WHERE `key` NOT IN ('commandId', 'kind', 'reason'))
	))
	OR (`command`.`kind` = 'permission.resolve' AND (
		json_type(`command`.`payload_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.requestId')) = 0
		OR json_type(`command`.`payload_json`, '$.decision') IS NOT 'text'
		OR json_extract(`command`.`payload_json`, '$.decision') NOT IN ('allow_once', 'reject_once')
		OR EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`) WHERE `key` NOT IN ('commandId', 'decision', 'kind', 'requestId'))
	));
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_source_guard` (`violation_count`)
SELECT COUNT(*)
FROM `driver_command` AS `command`
WHERE (`command`.`result_json` IS NOT NULL AND json_type(`command`.`result_json`) NOT IN ('null', 'object'))
	OR (`command`.`error_json` IS NOT NULL AND json_type(`command`.`error_json`) IS NOT 'object')
	OR (`command`.`kind` IN ('turn.cancel', 'session.stop', 'permission.resolve') AND `command`.`result_json` IS NOT NULL AND json_type(`command`.`result_json`) IS NOT 'null')
	OR (`command`.`kind` = 'input.start' AND `command`.`result_json` IS NOT NULL AND json_type(`command`.`result_json`) IS NOT 'null' AND (
		json_type(`command`.`result_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`command`.`result_json`, '$.requestId')) = 0
		OR EXISTS (SELECT 1 FROM json_each(`command`.`result_json`) WHERE `key` <> 'requestId')
	))
	OR (`command`.`kind` = 'mcp.execute' AND `command`.`result_json` IS NOT NULL AND json_type(`command`.`result_json`) IS NOT 'null' AND (
		json_type(`command`.`result_json`, '$.outputText') IS NOT 'text'
		OR json_type(`command`.`result_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`command`.`result_json`, '$.requestId')) = 0
		OR json_type(`command`.`result_json`, '$.serverId') IS NOT 'text'
		OR length(json_extract(`command`.`result_json`, '$.serverId')) = 0
		OR json_type(`command`.`result_json`, '$.toolName') IS NOT 'text'
		OR length(json_extract(`command`.`result_json`, '$.toolName')) = 0
		OR (json_type(`command`.`result_json`, '$.isError') IS NOT NULL AND json_type(`command`.`result_json`, '$.isError') NOT IN ('true', 'false'))
		OR EXISTS (SELECT 1 FROM json_each(`command`.`result_json`) WHERE `key` NOT IN ('isError', 'outputText', 'requestId', 'serverId', 'toolName'))
	))
	OR (`command`.`error_json` IS NOT NULL AND (
		json_type(`command`.`error_json`, '$.code') IS NOT 'text'
		OR length(json_extract(`command`.`error_json`, '$.code')) = 0
		OR json_type(`command`.`error_json`, '$.message') IS NOT 'text'
		OR length(json_extract(`command`.`error_json`, '$.message')) = 0
		OR (json_type(`command`.`error_json`, '$.retryable') IS NOT 'true' AND json_type(`command`.`error_json`, '$.retryable') IS NOT 'false')
		OR json_type(`command`.`error_json`, '$.details') IS NOT 'object'
		OR EXISTS (SELECT 1 FROM json_each(`command`.`error_json`, '$.details') WHERE `type` NOT IN ('null', 'integer', 'real', 'text', 'true', 'false'))
		OR EXISTS (SELECT 1 FROM json_each(`command`.`error_json`) WHERE `key` NOT IN ('code', 'details', 'message', 'retryable'))
	));
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_source_guard` (`violation_count`)
SELECT
	(SELECT COUNT(*) FROM `external_tool_effect` WHERE `result_json` IS NOT NULL AND NOT json_valid(`result_json`)) +
	(SELECT COUNT(*) FROM `external_tool_effect_attempt` WHERE `result_json` IS NOT NULL AND NOT json_valid(`result_json`));
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_source_guard` (`violation_count`)
SELECT
	(SELECT COUNT(*) FROM `external_tool_effect` WHERE (`status` = 'succeeded' AND `result_json` IS NULL) OR (`result_json` IS NOT NULL AND (
		json_type(`result_json`) IS NOT 'object'
		OR json_type(`result_json`, '$.outputText') IS NOT 'text'
		OR json_type(`result_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`result_json`, '$.requestId')) = 0
		OR json_type(`result_json`, '$.serverId') IS NOT 'text'
		OR length(json_extract(`result_json`, '$.serverId')) = 0
		OR json_type(`result_json`, '$.toolName') IS NOT 'text'
		OR length(json_extract(`result_json`, '$.toolName')) = 0
		OR (json_type(`result_json`, '$.isError') IS NOT NULL AND json_type(`result_json`, '$.isError') NOT IN ('true', 'false'))
		OR EXISTS (SELECT 1 FROM json_each(`result_json`) WHERE `key` NOT IN ('isError', 'outputText', 'requestId', 'serverId', 'toolName'))
	))) +
	(SELECT COUNT(*) FROM `external_tool_effect_attempt` WHERE (`status` = 'succeeded' AND `result_json` IS NULL) OR (`result_json` IS NOT NULL AND (
		json_type(`result_json`) IS NOT 'object'
		OR json_type(`result_json`, '$.outputText') IS NOT 'text'
		OR json_type(`result_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`result_json`, '$.requestId')) = 0
		OR json_type(`result_json`, '$.serverId') IS NOT 'text'
		OR length(json_extract(`result_json`, '$.serverId')) = 0
		OR json_type(`result_json`, '$.toolName') IS NOT 'text'
		OR length(json_extract(`result_json`, '$.toolName')) = 0
		OR (json_type(`result_json`, '$.isError') IS NOT NULL AND json_type(`result_json`, '$.isError') NOT IN ('true', 'false'))
		OR EXISTS (SELECT 1 FROM json_each(`result_json`) WHERE `key` NOT IN ('isError', 'outputText', 'requestId', 'serverId', 'toolName'))
	)));
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_source_guard` (`violation_count`)
SELECT COUNT(*)
FROM `external_tool_effect` AS `effect`
INNER JOIN `driver_command` AS `command` ON `command`.`id` = `effect`.`command_id`
WHERE `command`.`kind` <> 'mcp.execute'
	OR `effect`.`driver_instance_id` IS NOT `command`.`driver_instance_id`
	OR `effect`.`server_id` IS NOT json_extract(`command`.`payload_json`, '$.serverId')
	OR `effect`.`tool_name` IS NOT json_extract(`command`.`payload_json`, '$.toolName')
	OR (`command`.`result_json` IS NOT NULL AND json_type(`command`.`result_json`) <> 'null' AND (
		json_extract(`command`.`result_json`, '$.requestId') IS NOT json_extract(`command`.`payload_json`, '$.requestId')
		OR json_extract(`command`.`result_json`, '$.serverId') IS NOT `effect`.`server_id`
		OR json_extract(`command`.`result_json`, '$.toolName') IS NOT `effect`.`tool_name`
	))
	OR (`effect`.`result_json` IS NOT NULL AND (
		json_extract(`effect`.`result_json`, '$.requestId') IS NOT json_extract(`command`.`payload_json`, '$.requestId')
		OR json_extract(`effect`.`result_json`, '$.serverId') IS NOT `effect`.`server_id`
		OR json_extract(`effect`.`result_json`, '$.toolName') IS NOT `effect`.`tool_name`
	))
	OR EXISTS (
		SELECT 1
		FROM `external_tool_effect_attempt` AS `attempt`
		WHERE `attempt`.`effect_id` = `effect`.`id`
			AND `attempt`.`result_json` IS NOT NULL
			AND (
				json_extract(`attempt`.`result_json`, '$.requestId') IS NOT json_extract(`command`.`payload_json`, '$.requestId')
				OR json_extract(`attempt`.`result_json`, '$.serverId') IS NOT `effect`.`server_id`
				OR json_extract(`attempt`.`result_json`, '$.toolName') IS NOT `effect`.`tool_name`
			)
	);
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_source_guard` (`violation_count`)
SELECT COUNT(*)
FROM `session_run`
WHERE (`error_code` IS NULL AND (`error_message` IS NOT NULL OR `error_details_json` IS NOT NULL))
	OR (`error_message` IS NULL AND (`error_code` IS NOT NULL OR `error_details_json` IS NOT NULL))
	OR (`error_code` IS NOT NULL AND length(`error_code`) = 0)
	OR (`error_message` IS NOT NULL AND length(`error_message`) = 0)
	OR (`error_details_json` IS NOT NULL AND NOT json_valid(`error_details_json`));
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_source_guard` (`violation_count`)
SELECT COUNT(*)
FROM `session_run`
WHERE `error_details_json` IS NOT NULL
	AND (
		json_type(`error_details_json`) IS NOT 'object'
		OR EXISTS (SELECT 1 FROM json_each(`error_details_json`) WHERE `type` NOT IN ('null', 'integer', 'real', 'text', 'true', 'false'))
	);
--> statement-breakpoint
DROP TABLE `__durable_mcp_v3_source_guard`;
--> statement-breakpoint
UPDATE `driver_command` SET `result_json` = NULL WHERE `result_json` IS NOT NULL AND json_type(`result_json`) = 'null';
--> statement-breakpoint
CREATE TABLE `__durable_mcp_v3_oversized_terminal_command` (
	`id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_oversized_terminal_command` (`id`)
SELECT `command`.`id`
FROM `driver_command` AS `command`
WHERE CASE
	WHEN `command`.`kind` = 'mcp.execute' THEN length(CAST(json_set(
		`command`.`payload_json`,
		'$.commandId', `command`.`id`,
		'$.runId', (SELECT `effect`.`session_run_id` FROM `external_tool_effect` AS `effect` WHERE `effect`.`command_id` = `command`.`id` LIMIT 1)
	) AS BLOB)) > 824448
	ELSE length(CAST(`command`.`payload_json` AS BLOB)) > 824448
END;
--> statement-breakpoint
UPDATE `driver_command`
SET `payload_json` = json_set(
	`payload_json`,
	'$.commandId', `id`,
	'$.runId', (SELECT `effect`.`session_run_id` FROM `external_tool_effect` AS `effect` WHERE `effect`.`command_id` = `driver_command`.`id` LIMIT 1),
	'$.serverId', (SELECT `effect`.`server_id` FROM `external_tool_effect` AS `effect` WHERE `effect`.`command_id` = `driver_command`.`id` LIMIT 1)
)
WHERE `kind` = 'mcp.execute' AND `id` NOT IN (SELECT `id` FROM `__durable_mcp_v3_oversized_terminal_command`);
--> statement-breakpoint
UPDATE `driver_command`
SET `payload_json` = json_object(
	'argumentsJson', '{"omitted":"Stored MCP arguments were omitted during the durable MCP v3 migration."}',
	'commandId', `id`,
	'kind', 'mcp.execute',
	'requestId', json_extract(`payload_json`, '$.requestId'),
	'runId', (SELECT `effect`.`session_run_id` FROM `external_tool_effect` AS `effect` WHERE `effect`.`command_id` = `driver_command`.`id` LIMIT 1),
	'serverId', json_extract(`payload_json`, '$.serverId'),
	'toolCallId', json_extract(`payload_json`, '$.toolCallId'),
	'toolName', json_extract(`payload_json`, '$.toolName')
)
WHERE `kind` = 'mcp.execute' AND `id` IN (SELECT `id` FROM `__durable_mcp_v3_oversized_terminal_command`);
--> statement-breakpoint
UPDATE `driver_command`
SET `payload_json` = CASE `kind`
	WHEN 'input.start' THEN json_object(
		'commandId', `id`,
		'input', CASE WHEN json_type(`payload_json`, '$.input.attachmentIds') = 'array'
			THEN json_object(
				'attachmentIds', json(json_extract(`payload_json`, '$.input.attachmentIds')),
				'text', 'Stored input text was omitted during the durable MCP v3 migration.'
			)
			ELSE json_object('text', 'Stored input text was omitted during the durable MCP v3 migration.')
		END,
		'kind', 'input.start',
		'requestId', json_extract(`payload_json`, '$.requestId'),
		'runId', json_extract(`payload_json`, '$.runId')
	)
	WHEN 'turn.cancel' THEN json_object('commandId', `id`, 'kind', 'turn.cancel', 'reason', 'Stored control reason was omitted during the durable MCP v3 migration.')
	WHEN 'session.stop' THEN json_object('commandId', `id`, 'kind', 'session.stop', 'reason', 'Stored control reason was omitted during the durable MCP v3 migration.')
	WHEN 'permission.resolve' THEN json_object(
		'commandId', `id`,
		'decision', json_extract(`payload_json`, '$.decision'),
		'kind', 'permission.resolve',
		'requestId', json_extract(`payload_json`, '$.requestId')
	)
	ELSE `payload_json`
END
WHERE `id` IN (SELECT `id` FROM `__durable_mcp_v3_oversized_terminal_command`) AND `kind` <> 'mcp.execute';
--> statement-breakpoint
CREATE TABLE `__durable_mcp_v3_legacy_claim_token` (
	`attempt` integer NOT NULL,
	`claim_token` text NOT NULL,
	`effect_id` text NOT NULL,
	PRIMARY KEY(`effect_id`, `attempt`)
);
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_legacy_claim_token` (`attempt`, `claim_token`, `effect_id`)
SELECT
	`attempt`,
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-8' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	`effect_id`
FROM `external_tool_effect_attempt`;
--> statement-breakpoint
CREATE TABLE `__new_external_tool_effect` (
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`claim_token` text,
	`command_id` text CHECK ("command_id" = upper("command_id") AND length("command_id") = 26 AND substr("command_id", 1, 1) GLOB '[0-7]' AND "command_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`driver_instance_id` text CHECK ("driver_instance_id" = upper("driver_instance_id") AND length("driver_instance_id") = 26 AND substr("driver_instance_id", 1, 1) GLOB '[0-7]' AND "driver_instance_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`provider_receipt_json` text,
	`result_json` text,
	`server_id` text CHECK ("server_id" = upper("server_id") AND length("server_id") = 26 AND substr("server_id", 1, 1) GLOB '[0-7]' AND "server_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`session_run_id` text CHECK ("session_run_id" = upper("session_run_id") AND length("session_run_id") = 26 AND substr("session_run_id", 1, 1) GLOB '[0-7]' AND "session_run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`status` text NOT NULL,
	`tool_name` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`command_id`) REFERENCES `driver_command`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`driver_instance_id`) REFERENCES `driver_instance`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_run_id`) REFERENCES `session_run`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "external_tool_effect_status_check" CHECK("__new_external_tool_effect"."status" IN ('intent', 'claimed', 'succeeded', 'unknown')),
	CONSTRAINT "external_tool_effect_claim_token_uuid_check" CHECK("__new_external_tool_effect"."claim_token" IS NULL OR (length("__new_external_tool_effect"."claim_token") = 36 AND length(replace("__new_external_tool_effect"."claim_token", '-', '')) = 32 AND "__new_external_tool_effect"."claim_token" = lower("__new_external_tool_effect"."claim_token") AND substr("__new_external_tool_effect"."claim_token", 9, 1) = '-' AND substr("__new_external_tool_effect"."claim_token", 14, 1) = '-' AND substr("__new_external_tool_effect"."claim_token", 15, 1) = '4' AND substr("__new_external_tool_effect"."claim_token", 19, 1) = '-' AND substr("__new_external_tool_effect"."claim_token", 20, 1) GLOB '[89ab]' AND substr("__new_external_tool_effect"."claim_token", 24, 1) = '-' AND replace("__new_external_tool_effect"."claim_token", '-', '') NOT GLOB '*[^0-9a-f]*'))
);
--> statement-breakpoint
WITH `effect_source` AS (
	SELECT
		`effect`.*,
		`command`.`payload_json` AS `command_payload_json`,
		max(
			COALESCE(length(CAST(`effect`.`result_json` AS BLOB)), 0),
			COALESCE((SELECT max(length(CAST(`attempt`.`result_json` AS BLOB))) FROM `external_tool_effect_attempt` AS `attempt` WHERE `attempt`.`effect_id` = `effect`.`id` AND `attempt`.`status` = 'succeeded'), 0),
			COALESCE(length(CAST(`command`.`result_json` AS BLOB)), 0)
		) AS `original_result_bytes`
	FROM `external_tool_effect` AS `effect`
	INNER JOIN `driver_command` AS `command` ON `command`.`id` = `effect`.`command_id`
),
`effect_result_normalized` AS (
	SELECT
		`effect_source`.*,
		CASE
			WHEN `status` = 'succeeded' AND (
				`original_result_bytes` > 1044480
				OR length(CAST('{"kind":"succeeded","result":' || `result_json` || '}' AS BLOB)) > 1044480
			) THEN
				'{"isError":true,"outputText":' || json_quote('Stored MCP result omitted because it contained ' || `original_result_bytes` || ' UTF-8 bytes.') ||
				',"requestId":' || json_quote(json_extract(`command_payload_json`, '$.requestId')) ||
				',"serverId":' || json_quote(json_extract(`command_payload_json`, '$.serverId')) ||
				',"toolName":' || json_quote(json_extract(`command_payload_json`, '$.toolName')) || '}'
			WHEN `status` = 'succeeded' THEN `result_json`
			ELSE NULL
		END AS `normalized_result_json`
	FROM `effect_source`
),
`effect_normalized` AS (
	SELECT
		`effect_result_normalized`.*,
		CASE
			WHEN `status` <> 'succeeded' THEN NULL
			WHEN `provider_receipt_json` IS NULL THEN NULL
			WHEN length(CAST(
				'{"kind":"succeeded","providerReceiptJson":' || json_quote(`provider_receipt_json`) ||
				',"result":' || `normalized_result_json` || '}'
			AS BLOB)) > 1044480 THEN NULL
			ELSE `provider_receipt_json`
		END AS `normalized_provider_receipt_json`
	FROM `effect_result_normalized`
)
INSERT INTO `__new_external_tool_effect`("attempt_count", "claim_token", "command_id", "created_at", "driver_instance_id", "id", "idempotency_key", "provider_receipt_json", "result_json", "server_id", "session_run_id", "status", "tool_name", "updated_at")
SELECT
	`attempt_count`,
	(SELECT `token`.`claim_token` FROM `__durable_mcp_v3_legacy_claim_token` AS `token` WHERE `token`.`effect_id` = `effect_normalized`.`id` AND `token`.`attempt` = `effect_normalized`.`attempt_count` LIMIT 1),
	`command_id`,
	`created_at`,
	`driver_instance_id`,
	`id`,
	`idempotency_key`,
	`normalized_provider_receipt_json`,
	`normalized_result_json`,
	`server_id`,
	`session_run_id`,
	CASE WHEN `status` = 'executing' THEN 'unknown' ELSE `status` END,
	json_extract(`command_payload_json`, '$.toolName'),
	CASE WHEN `status` = 'executing' THEN max(`created_at`, `updated_at`, unixepoch('now') * 1000) ELSE `updated_at` END
FROM `effect_normalized`;--> statement-breakpoint
CREATE TABLE `__new_external_tool_effect_attempt` (
	`attempt` integer NOT NULL,
	`claim_token` text NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`effect_id` text CHECK ("effect_id" = upper("effect_id") AND length("effect_id") = 26 AND substr("effect_id", 1, 1) GLOB '[0-7]' AND "effect_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`provider_receipt_json` text,
	`result_json` text,
	`status` text NOT NULL,
	PRIMARY KEY(`effect_id`, `attempt`),
	FOREIGN KEY (`effect_id`) REFERENCES `__new_external_tool_effect`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "external_tool_effect_attempt_status_check" CHECK("__new_external_tool_effect_attempt"."status" IN ('claimed', 'succeeded', 'unknown')),
	CONSTRAINT "external_tool_effect_attempt_claim_token_uuid_check" CHECK(length("__new_external_tool_effect_attempt"."claim_token") = 36 AND length(replace("__new_external_tool_effect_attempt"."claim_token", '-', '')) = 32 AND "__new_external_tool_effect_attempt"."claim_token" = lower("__new_external_tool_effect_attempt"."claim_token") AND substr("__new_external_tool_effect_attempt"."claim_token", 9, 1) = '-' AND substr("__new_external_tool_effect_attempt"."claim_token", 14, 1) = '-' AND substr("__new_external_tool_effect_attempt"."claim_token", 15, 1) = '4' AND substr("__new_external_tool_effect_attempt"."claim_token", 19, 1) = '-' AND substr("__new_external_tool_effect_attempt"."claim_token", 20, 1) GLOB '[89ab]' AND substr("__new_external_tool_effect_attempt"."claim_token", 24, 1) = '-' AND replace("__new_external_tool_effect_attempt"."claim_token", '-', '') NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
INSERT INTO `__new_external_tool_effect_attempt`("attempt", "claim_token", "completed_at", "created_at", "effect_id", "provider_receipt_json", "result_json", "status")
SELECT
	`attempt`,
	(SELECT `token`.`claim_token` FROM `__durable_mcp_v3_legacy_claim_token` AS `token` WHERE `token`.`effect_id` = `external_tool_effect_attempt`.`effect_id` AND `token`.`attempt` = `external_tool_effect_attempt`.`attempt`),
	CASE WHEN `status` = 'executing' THEN max(
		COALESCE(`completed_at`, 0),
		`created_at`,
		(SELECT `effect`.`updated_at` FROM `__new_external_tool_effect` AS `effect` WHERE `effect`.`id` = `external_tool_effect_attempt`.`effect_id`)
	) ELSE `completed_at` END,
	`created_at`,
	`effect_id`,
	CASE WHEN `status` = 'succeeded' THEN (SELECT `effect`.`provider_receipt_json` FROM `__new_external_tool_effect` AS `effect` WHERE `effect`.`id` = `external_tool_effect_attempt`.`effect_id`) ELSE NULL END,
	CASE WHEN `status` = 'succeeded' THEN (SELECT `effect`.`result_json` FROM `__new_external_tool_effect` AS `effect` WHERE `effect`.`id` = `external_tool_effect_attempt`.`effect_id`) ELSE NULL END,
	CASE WHEN `status` = 'executing' THEN 'unknown' ELSE `status` END
FROM `external_tool_effect_attempt`;--> statement-breakpoint
DROP TABLE `external_tool_effect_attempt`;--> statement-breakpoint
DROP TABLE `external_tool_effect`;--> statement-breakpoint
ALTER TABLE `__new_external_tool_effect` RENAME TO `external_tool_effect`;--> statement-breakpoint
ALTER TABLE `__new_external_tool_effect_attempt` RENAME TO `external_tool_effect_attempt`;--> statement-breakpoint
UPDATE `driver_command`
SET
	`completed_at` = COALESCE(`completed_at`, (SELECT `effect`.`updated_at` FROM `external_tool_effect` AS `effect` WHERE `effect`.`command_id` = `driver_command`.`id` AND `effect`.`status` = 'succeeded' LIMIT 1)),
	`error_json` = NULL,
	`result_json` = (SELECT `effect`.`result_json` FROM `external_tool_effect` AS `effect` WHERE `effect`.`command_id` = `driver_command`.`id` AND `effect`.`status` = 'succeeded' LIMIT 1),
	`status` = 'completed'
WHERE EXISTS (SELECT 1 FROM `external_tool_effect` AS `effect` WHERE `effect`.`command_id` = `driver_command`.`id` AND `effect`.`status` = 'succeeded');
--> statement-breakpoint
UPDATE `driver_command`
SET `result_json` = json_object('requestId', json_extract(`payload_json`, '$.requestId'))
WHERE `kind` = 'input.start'
	AND `result_json` IS NOT NULL
	AND (`id` IN (SELECT `id` FROM `__durable_mcp_v3_oversized_terminal_command`) OR length(CAST(`result_json` AS BLOB)) > 1044480);
--> statement-breakpoint
UPDATE `driver_command`
SET `error_json` = json_object(
	'code', 'storage.payload_omitted',
	'details', json_object('originalBytes', length(CAST(`error_json` AS BLOB))),
	'message', 'Stored runtime command error exceeded the durable payload limit and was omitted.',
	'retryable', json('false')
)
WHERE `error_json` IS NOT NULL AND length(CAST(`error_json` AS BLOB)) > 1044480;
--> statement-breakpoint
WITH `oversized_session_run_error` AS (
	SELECT
		`id`,
		length(CAST(
			'{"code":' || json_quote(`error_code`) ||
			',"details":' || COALESCE(NULLIF(`error_details_json`, ''), '{}') ||
			',"message":' || json_quote(`error_message`) ||
			',"retryable":false}'
		AS BLOB)) AS `original_bytes`
	FROM `session_run`
	WHERE `error_code` IS NOT NULL AND `error_message` IS NOT NULL
)
UPDATE `session_run`
SET
	`error_code` = 'storage.payload_omitted',
	`error_details_json` = json_object('originalBytes', (SELECT `original_bytes` FROM `oversized_session_run_error` WHERE `oversized_session_run_error`.`id` = `session_run`.`id`)),
	`error_message` = 'Stored Session Run error exceeded the durable payload limit and was omitted.'
WHERE `id` IN (SELECT `id` FROM `oversized_session_run_error` WHERE `original_bytes` > 1044480);
--> statement-breakpoint
DROP TABLE `__durable_mcp_v3_oversized_terminal_command`;
--> statement-breakpoint
DROP TABLE `__durable_mcp_v3_legacy_claim_token`;
--> statement-breakpoint
CREATE UNIQUE INDEX `external_tool_effect_command_idx` ON `external_tool_effect` (`command_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_tool_effect_idempotency_key_idx` ON `external_tool_effect` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `external_tool_effect_run_status_idx` ON `external_tool_effect` (`session_run_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `external_tool_effect_driver_status_idx` ON `external_tool_effect` (`driver_instance_id`,`status`);--> statement-breakpoint
CREATE INDEX `external_tool_effect_attempt_status_idx` ON `external_tool_effect_attempt` (`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `__durable_mcp_v3_final_guard` (
	`violation_count` integer NOT NULL,
	CONSTRAINT "durable_mcp_v3_final_guard_check" CHECK(`violation_count` = 0)
);
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_final_guard` (`violation_count`)
SELECT COUNT(*) FROM `driver_command` WHERE `status` IN ('queued', 'delivered', 'accepted');
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_final_guard` (`violation_count`)
SELECT COUNT(*)
FROM `driver_command`
WHERE `status` NOT IN ('completed', 'failed', 'expired', 'cancelled')
	OR (`driver_generation` IS NOT NULL AND (typeof(`driver_generation`) <> 'integer' OR `driver_generation` NOT BETWEEN 0 AND 9007199254740991))
	OR NOT json_valid(`payload_json`)
	OR length(CAST(`payload_json` AS BLOB)) > 824448;
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_final_guard` (`violation_count`)
SELECT COUNT(*)
FROM `driver_command` AS `command`
WHERE json_type(`command`.`payload_json`) IS NOT 'object'
	OR json_type(`command`.`payload_json`, '$.commandId') IS NOT 'text'
	OR length(json_extract(`command`.`payload_json`, '$.commandId')) = 0
	OR json_extract(`command`.`payload_json`, '$.commandId') IS NOT `command`.`id`
	OR json_type(`command`.`payload_json`, '$.kind') IS NOT 'text'
	OR json_extract(`command`.`payload_json`, '$.kind') IS NOT `command`.`kind`
	OR `command`.`kind` NOT IN ('turn.cancel', 'input.start', 'mcp.execute', 'session.stop', 'permission.resolve')
	OR (`command`.`kind` = 'turn.cancel' AND EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`) WHERE `key` NOT IN ('commandId', 'kind', 'reason')))
	OR (`command`.`kind` = 'turn.cancel' AND json_type(`command`.`payload_json`, '$.reason') IS NOT NULL AND json_type(`command`.`payload_json`, '$.reason') IS NOT 'text')
	OR (`command`.`kind` = 'input.start' AND (
		json_type(`command`.`payload_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.requestId')) = 0
		OR json_type(`command`.`payload_json`, '$.runId') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.runId')) = 0
		OR json_type(`command`.`payload_json`, '$.input') IS NOT 'object'
		OR json_type(`command`.`payload_json`, '$.input.text') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.input.text')) = 0
		OR (json_type(`command`.`payload_json`, '$.input.attachmentIds') IS NOT NULL AND json_type(`command`.`payload_json`, '$.input.attachmentIds') IS NOT 'array')
		OR EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`, '$.input.attachmentIds') WHERE `type` <> 'text' OR length(`value`) = 0)
		OR EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`) WHERE `key` NOT IN ('commandId', 'input', 'kind', 'requestId', 'runId'))
		OR EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`, '$.input') WHERE `key` NOT IN ('attachmentIds', 'text'))
	))
	OR (`command`.`kind` = 'mcp.execute' AND (
		json_type(`command`.`payload_json`, '$.argumentsJson') IS NOT 'text'
		OR json_type(`command`.`payload_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.requestId')) = 0
		OR json_type(`command`.`payload_json`, '$.runId') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.runId')) = 0
		OR json_type(`command`.`payload_json`, '$.serverId') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.serverId')) = 0
		OR json_type(`command`.`payload_json`, '$.toolCallId') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.toolCallId')) = 0
		OR json_type(`command`.`payload_json`, '$.toolName') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.toolName')) = 0
		OR EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`) WHERE `key` NOT IN ('argumentsJson', 'commandId', 'kind', 'requestId', 'runId', 'serverId', 'toolCallId', 'toolName'))
	))
	OR (`command`.`kind` = 'session.stop' AND (
		json_type(`command`.`payload_json`, '$.reason') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.reason')) = 0
		OR EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`) WHERE `key` NOT IN ('commandId', 'kind', 'reason'))
	))
	OR (`command`.`kind` = 'permission.resolve' AND (
		json_type(`command`.`payload_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`command`.`payload_json`, '$.requestId')) = 0
		OR json_type(`command`.`payload_json`, '$.decision') IS NOT 'text'
		OR json_extract(`command`.`payload_json`, '$.decision') NOT IN ('allow_once', 'reject_once')
		OR EXISTS (SELECT 1 FROM json_each(`command`.`payload_json`) WHERE `key` NOT IN ('commandId', 'decision', 'kind', 'requestId'))
	));
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_final_guard` (`violation_count`)
SELECT COUNT(*)
FROM `driver_command`
WHERE (`result_json` IS NOT NULL AND (NOT json_valid(`result_json`) OR json_type(`result_json`) IS NOT 'object' OR length(CAST(`result_json` AS BLOB)) > 1044480))
	OR (`error_json` IS NOT NULL AND (NOT json_valid(`error_json`) OR json_type(`error_json`) IS NOT 'object' OR length(CAST(`error_json` AS BLOB)) > 1044480))
	OR (`result_json` IS NOT NULL AND `error_json` IS NOT NULL)
	OR (`status` = 'completed' AND `error_json` IS NOT NULL)
	OR (`status` IN ('failed', 'expired', 'cancelled') AND `result_json` IS NOT NULL);
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_final_guard` (`violation_count`)
SELECT COUNT(*)
FROM `driver_command` AS `command`
WHERE (`command`.`kind` IN ('turn.cancel', 'session.stop', 'permission.resolve') AND `command`.`result_json` IS NOT NULL)
	OR (`command`.`kind` = 'input.start' AND `command`.`result_json` IS NOT NULL AND (
		json_type(`command`.`result_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`command`.`result_json`, '$.requestId')) = 0
		OR EXISTS (SELECT 1 FROM json_each(`command`.`result_json`) WHERE `key` <> 'requestId')
	))
	OR (`command`.`kind` = 'mcp.execute' AND `command`.`result_json` IS NOT NULL AND (
		json_type(`command`.`result_json`, '$.outputText') IS NOT 'text'
		OR json_type(`command`.`result_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`command`.`result_json`, '$.requestId')) = 0
		OR json_type(`command`.`result_json`, '$.serverId') IS NOT 'text'
		OR length(json_extract(`command`.`result_json`, '$.serverId')) = 0
		OR json_type(`command`.`result_json`, '$.toolName') IS NOT 'text'
		OR length(json_extract(`command`.`result_json`, '$.toolName')) = 0
		OR (json_type(`command`.`result_json`, '$.isError') IS NOT NULL AND json_type(`command`.`result_json`, '$.isError') NOT IN ('true', 'false'))
		OR EXISTS (SELECT 1 FROM json_each(`command`.`result_json`) WHERE `key` NOT IN ('isError', 'outputText', 'requestId', 'serverId', 'toolName'))
	));
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_final_guard` (`violation_count`)
SELECT COUNT(*)
FROM `driver_command`
WHERE `error_json` IS NOT NULL
	AND (
		json_type(`error_json`, '$.code') IS NOT 'text'
		OR length(json_extract(`error_json`, '$.code')) = 0
		OR json_type(`error_json`, '$.message') IS NOT 'text'
		OR length(json_extract(`error_json`, '$.message')) = 0
		OR (json_type(`error_json`, '$.retryable') IS NOT 'true' AND json_type(`error_json`, '$.retryable') IS NOT 'false')
		OR json_type(`error_json`, '$.details') IS NOT 'object'
		OR EXISTS (SELECT 1 FROM json_each(`error_json`, '$.details') WHERE `type` NOT IN ('null', 'integer', 'real', 'text', 'true', 'false'))
		OR EXISTS (SELECT 1 FROM json_each(`error_json`) WHERE `key` NOT IN ('code', 'details', 'message', 'retryable'))
	);
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_final_guard` (`violation_count`)
SELECT
	(SELECT COUNT(*) FROM `external_tool_effect` WHERE `result_json` IS NOT NULL AND (NOT json_valid(`result_json`) OR json_type(`result_json`) IS NOT 'object' OR length(CAST(`result_json` AS BLOB)) > 1044480)) +
	(SELECT COUNT(*) FROM `external_tool_effect_attempt` WHERE `result_json` IS NOT NULL AND (NOT json_valid(`result_json`) OR json_type(`result_json`) IS NOT 'object' OR length(CAST(`result_json` AS BLOB)) > 1044480));
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_final_guard` (`violation_count`)
SELECT
	(SELECT COUNT(*) FROM `external_tool_effect` WHERE `result_json` IS NOT NULL AND (
		json_type(`result_json`, '$.outputText') IS NOT 'text'
		OR json_type(`result_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`result_json`, '$.requestId')) = 0
		OR json_type(`result_json`, '$.serverId') IS NOT 'text'
		OR length(json_extract(`result_json`, '$.serverId')) = 0
		OR json_type(`result_json`, '$.toolName') IS NOT 'text'
		OR length(json_extract(`result_json`, '$.toolName')) = 0
		OR (json_type(`result_json`, '$.isError') IS NOT NULL AND json_type(`result_json`, '$.isError') NOT IN ('true', 'false'))
		OR EXISTS (SELECT 1 FROM json_each(`result_json`) WHERE `key` NOT IN ('isError', 'outputText', 'requestId', 'serverId', 'toolName'))
	)) +
	(SELECT COUNT(*) FROM `external_tool_effect_attempt` WHERE `result_json` IS NOT NULL AND (
		json_type(`result_json`, '$.outputText') IS NOT 'text'
		OR json_type(`result_json`, '$.requestId') IS NOT 'text'
		OR length(json_extract(`result_json`, '$.requestId')) = 0
		OR json_type(`result_json`, '$.serverId') IS NOT 'text'
		OR length(json_extract(`result_json`, '$.serverId')) = 0
		OR json_type(`result_json`, '$.toolName') IS NOT 'text'
		OR length(json_extract(`result_json`, '$.toolName')) = 0
		OR (json_type(`result_json`, '$.isError') IS NOT NULL AND json_type(`result_json`, '$.isError') NOT IN ('true', 'false'))
		OR EXISTS (SELECT 1 FROM json_each(`result_json`) WHERE `key` NOT IN ('isError', 'outputText', 'requestId', 'serverId', 'toolName'))
	));
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_final_guard` (`violation_count`)
SELECT COUNT(*)
FROM `driver_command` AS `command`
LEFT JOIN `external_tool_effect` AS `effect` ON `effect`.`command_id` = `command`.`id`
WHERE `command`.`kind` = 'mcp.execute'
	AND (
		`effect`.`id` IS NULL
		OR `effect`.`driver_instance_id` IS NOT `command`.`driver_instance_id`
		OR json_extract(`command`.`payload_json`, '$.runId') IS NOT `effect`.`session_run_id`
		OR json_extract(`command`.`payload_json`, '$.serverId') IS NOT `effect`.`server_id`
		OR json_extract(`command`.`payload_json`, '$.toolName') IS NOT `effect`.`tool_name`
	);
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_final_guard` (`violation_count`)
SELECT COUNT(*)
FROM `external_tool_effect` AS `effect`
INNER JOIN `driver_command` AS `command` ON `command`.`id` = `effect`.`command_id`
WHERE `command`.`kind` <> 'mcp.execute'
	OR length(`effect`.`idempotency_key`) = 0
	OR length(`effect`.`tool_name`) = 0
	OR `effect`.`attempt_count` IS NOT COALESCE((SELECT max(`attempt`) FROM `external_tool_effect_attempt` AS `attempt` WHERE `attempt`.`effect_id` = `effect`.`id`), 0)
	OR EXISTS (SELECT 1 FROM `external_tool_effect_attempt` AS `attempt` WHERE `attempt`.`effect_id` = `effect`.`id` AND `attempt`.`attempt` < 1)
	OR (`effect`.`status` = 'intent' AND (
		`effect`.`attempt_count` <> 0
		OR `effect`.`claim_token` IS NOT NULL
		OR `effect`.`provider_receipt_json` IS NOT NULL
		OR `effect`.`result_json` IS NOT NULL
		OR EXISTS (SELECT 1 FROM `external_tool_effect_attempt` AS `attempt` WHERE `attempt`.`effect_id` = `effect`.`id`)
	))
	OR (`effect`.`status` <> 'intent' AND (
		`effect`.`attempt_count` < 1
		OR `effect`.`claim_token` IS NULL
		OR NOT EXISTS (
			SELECT 1
			FROM `external_tool_effect_attempt` AS `attempt`
			WHERE `attempt`.`effect_id` = `effect`.`id`
				AND `attempt`.`attempt` = `effect`.`attempt_count`
				AND `attempt`.`claim_token` = `effect`.`claim_token`
		)
	))
	OR EXISTS (
		SELECT 1
		FROM `external_tool_effect_attempt` AS `attempt`
		WHERE `attempt`.`effect_id` = `effect`.`id`
			AND `attempt`.`attempt` < `effect`.`attempt_count`
			AND (`attempt`.`status` <> 'unknown' OR `attempt`.`completed_at` IS NULL OR `attempt`.`provider_receipt_json` IS NOT NULL OR `attempt`.`result_json` IS NOT NULL)
	)
	OR (`effect`.`status` = 'claimed' AND (
		`effect`.`provider_receipt_json` IS NOT NULL
		OR `effect`.`result_json` IS NOT NULL
		OR NOT EXISTS (
			SELECT 1 FROM `external_tool_effect_attempt` AS `attempt`
			WHERE `attempt`.`effect_id` = `effect`.`id`
				AND `attempt`.`attempt` = `effect`.`attempt_count`
				AND `attempt`.`status` = 'claimed'
				AND `attempt`.`completed_at` IS NULL
				AND `attempt`.`provider_receipt_json` IS NULL
				AND `attempt`.`result_json` IS NULL
		)
	))
	OR (`effect`.`status` = 'unknown' AND (
		`effect`.`provider_receipt_json` IS NOT NULL
		OR `effect`.`result_json` IS NOT NULL
		OR `command`.`status` = 'completed'
		OR `command`.`result_json` IS NOT NULL
		OR NOT EXISTS (
			SELECT 1 FROM `external_tool_effect_attempt` AS `attempt`
			WHERE `attempt`.`effect_id` = `effect`.`id`
				AND `attempt`.`attempt` = `effect`.`attempt_count`
				AND `attempt`.`status` = 'unknown'
				AND `attempt`.`completed_at` IS NOT NULL
				AND `attempt`.`provider_receipt_json` IS NULL
				AND `attempt`.`result_json` IS NULL
		)
	))
	OR (`effect`.`status` = 'succeeded' AND (
		`effect`.`result_json` IS NULL
		OR `command`.`status` <> 'completed'
		OR `command`.`error_json` IS NOT NULL
		OR `command`.`result_json` IS NOT `effect`.`result_json`
		OR (SELECT COUNT(*) FROM `external_tool_effect_attempt` AS `attempt` WHERE `attempt`.`effect_id` = `effect`.`id` AND `attempt`.`status` = 'succeeded') <> 1
		OR NOT EXISTS (
			SELECT 1 FROM `external_tool_effect_attempt` AS `attempt`
			WHERE `attempt`.`effect_id` = `effect`.`id`
				AND `attempt`.`attempt` = `effect`.`attempt_count`
				AND `attempt`.`status` = 'succeeded'
				AND `attempt`.`completed_at` IS NOT NULL
				AND `attempt`.`provider_receipt_json` IS `effect`.`provider_receipt_json`
				AND `attempt`.`result_json` IS `effect`.`result_json`
		)
		OR json_extract(`effect`.`result_json`, '$.requestId') IS NOT json_extract(`command`.`payload_json`, '$.requestId')
		OR json_extract(`effect`.`result_json`, '$.serverId') IS NOT json_extract(`command`.`payload_json`, '$.serverId')
		OR json_extract(`effect`.`result_json`, '$.toolName') IS NOT json_extract(`command`.`payload_json`, '$.toolName')
		OR length(CAST(
			CASE WHEN `effect`.`provider_receipt_json` IS NULL
				THEN '{"kind":"succeeded","result":' || `effect`.`result_json` || '}'
				ELSE '{"kind":"succeeded","providerReceiptJson":' || json_quote(`effect`.`provider_receipt_json`) || ',"result":' || `effect`.`result_json` || '}'
			END
		AS BLOB)) > 1044480
	))
	OR (`effect`.`status` IN ('intent', 'claimed') AND (`command`.`status` = 'completed' OR `command`.`result_json` IS NOT NULL));
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_final_guard` (`violation_count`)
SELECT COUNT(*)
FROM `external_tool_effect_attempt`
WHERE (`status` <> 'succeeded' AND (`provider_receipt_json` IS NOT NULL OR `result_json` IS NOT NULL))
	OR (`status` = 'claimed' AND `completed_at` IS NOT NULL)
	OR (`status` IN ('succeeded', 'unknown') AND `completed_at` IS NULL)
	OR (`status` = 'succeeded' AND `result_json` IS NULL);
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_final_guard` (`violation_count`)
SELECT COUNT(*)
FROM `session_run`
WHERE (`error_code` IS NULL AND (`error_message` IS NOT NULL OR `error_details_json` IS NOT NULL))
	OR (`error_message` IS NULL AND (`error_code` IS NOT NULL OR `error_details_json` IS NOT NULL))
	OR (`error_code` IS NOT NULL AND length(`error_code`) = 0)
	OR (`error_message` IS NOT NULL AND length(`error_message`) = 0)
	OR (`error_details_json` IS NOT NULL AND (NOT json_valid(`error_details_json`) OR json_type(`error_details_json`) IS NOT 'object'))
	OR (`error_details_json` IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(`error_details_json`) WHERE `type` NOT IN ('null', 'integer', 'real', 'text', 'true', 'false')))
	OR (`error_code` IS NOT NULL AND length(CAST(
		'{"code":' || json_quote(`error_code`) ||
		',"details":' || COALESCE(`error_details_json`, '{}') ||
		',"message":' || json_quote(`error_message`) ||
		',"retryable":false}'
	AS BLOB)) > 1044480);
--> statement-breakpoint
INSERT INTO `__durable_mcp_v3_final_guard` (`violation_count`)
SELECT
	(SELECT COUNT(*) FROM `external_tool_effect` WHERE `claim_token` IS NOT NULL AND NOT (
		length(`claim_token`) = 36
		AND length(replace(`claim_token`, '-', '')) = 32
		AND `claim_token` = lower(`claim_token`)
		AND substr(`claim_token`, 9, 1) = '-'
		AND substr(`claim_token`, 14, 1) = '-'
		AND substr(`claim_token`, 15, 1) = '4'
		AND substr(`claim_token`, 19, 1) = '-'
		AND substr(`claim_token`, 20, 1) GLOB '[89ab]'
		AND substr(`claim_token`, 24, 1) = '-'
		AND replace(`claim_token`, '-', '') NOT GLOB '*[^0-9a-f]*'
	)) +
	(SELECT COUNT(*) FROM `external_tool_effect_attempt` WHERE NOT (
		length(`claim_token`) = 36
		AND length(replace(`claim_token`, '-', '')) = 32
		AND `claim_token` = lower(`claim_token`)
		AND substr(`claim_token`, 9, 1) = '-'
		AND substr(`claim_token`, 14, 1) = '-'
		AND substr(`claim_token`, 15, 1) = '4'
		AND substr(`claim_token`, 19, 1) = '-'
		AND substr(`claim_token`, 20, 1) GLOB '[89ab]'
		AND substr(`claim_token`, 24, 1) = '-'
		AND replace(`claim_token`, '-', '') NOT GLOB '*[^0-9a-f]*'
	));
--> statement-breakpoint
DROP TABLE `__durable_mcp_v3_final_guard`;
