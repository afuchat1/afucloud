import { boolean, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsersTable } from "./auth-users";

const afucloudSchema = pgSchema("afucloud");

export const billingSubscriptionsTable = afucloudSchema.table("billing_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => authUsersTable.id, { onDelete: "cascade" }),
  tierKey: text("tier_key").notNull(),
  status: text("status").notNull().default("pending_payment"),
  whopPlanId: text("whop_plan_id"),
  whopCheckoutConfigurationId: text("whop_checkout_configuration_id"),
  whopMembershipId: text("whop_membership_id"),
  whopPaymentId: text("whop_payment_id"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  manageUrl: text("manage_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userUnique: uniqueIndex("billing_subscriptions_user_unique").on(table.userId),
}));