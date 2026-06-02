import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const emailLogsTable = sqliteTable(
  "email_log",
  {
    createdAt: integer("created_at").notNull(),
    errorMessage: text("error_message"),
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    recipientDomain: text("recipient_domain"),
    recipientMasked: text("recipient_masked").notNull(),
    status: text("status").$type<"sent" | "failed">().notNull(),
    subject: text("subject").notNull(),
    type: text("type").notNull(),
  },
  (table) => [
    index("email_log_created_at_idx").on(table.createdAt),
    index("email_log_type_status_idx").on(table.type, table.status),
  ],
);

export type EmailLogRow = typeof emailLogsTable.$inferSelect;
