import { createInsertSchema } from "drizzle-zod";
import { pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { authUsersTable } from "./auth-users";

const afucloudSchema = pgSchema("afucloud");

export const cloudflareConnectionsTable = afucloudSchema.table("cloudflare_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => authUsersTable.id, { onDelete: "cascade" }),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
  scopes: text("scopes").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  userUnique: uniqueIndex("cloudflare_connections_user_unique").on(table.userId),
}));

export const insertCloudflareConnectionSchema = createInsertSchema(cloudflareConnectionsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCloudflareConnection = z.infer<typeof insertCloudflareConnectionSchema>;
export type CloudflareConnection = typeof cloudflareConnectionsTable.$inferSelect;