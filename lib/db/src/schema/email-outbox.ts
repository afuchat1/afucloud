import { index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsersTable } from "./auth-users";

const afucloudSchema = pgSchema("afucloud");

export const emailOutboxTable = afucloudSchema.table("email_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventKey: text("event_key").notNull(),
  userId: uuid("user_id").references(() => authUsersTable.id, { onDelete: "set null" }),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  templateKey: text("template_key").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  eventKeyUnique: uniqueIndex("email_outbox_event_key_unique").on(table.eventKey),
  pendingDueIndex: index("email_outbox_pending_due_idx").on(table.status, table.availableAt, table.createdAt),
}));

export type EmailOutboxMessage = typeof emailOutboxTable.$inferSelect;
