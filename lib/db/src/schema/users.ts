import { boolean, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { authUsersTable } from "./auth-users";

const publicSchema = pgSchema("public");

/**
 * Shared profile record for every Afu product.
 *
 * Authentication is owned by Supabase Auth. This table deliberately has no
 * password or credential columns; its primary key is the auth.users UUID.
 */
export const profilesTable = publicSchema.table("profiles", {
  id: uuid("id").primaryKey().references(() => authUsersTable.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProfileSchema = createInsertSchema(profilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profilesTable.$inferSelect;
