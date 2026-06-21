DELETE FROM `file_upload`
WHERE `scope_kind` = 'library'
	AND (
		`scope_id` IS NULL
		OR `file_id` IN (
			SELECT `id`
			FROM `file_record`
			WHERE `scope_kind` = 'library'
				AND (`scope_id` IS NULL OR `owner_kind` <> 'app' OR `owner_id` <> `scope_id`)
		)
	);
--> statement-breakpoint
DELETE FROM `file_version`
WHERE `scope_kind` = 'library'
	AND (
		`scope_id` IS NULL
		OR `file_id` IN (
			SELECT `id`
			FROM `file_record`
			WHERE `scope_kind` = 'library'
				AND (`scope_id` IS NULL OR `owner_kind` <> 'app' OR `owner_id` <> `scope_id`)
		)
	);
--> statement-breakpoint
DELETE FROM `file_record`
WHERE `scope_kind` = 'library'
	AND (`scope_id` IS NULL OR `owner_kind` <> 'app' OR `owner_id` <> `scope_id`);
