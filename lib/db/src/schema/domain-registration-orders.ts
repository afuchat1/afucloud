import { index, numeric, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsersTable } from "./auth-users";

const afucloudSchema = pgSchema("afucloud");

export const domainRegistrationOrdersTable = afucloudSchema.table("domain_registration_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => authUsersTable.id, { onDelete: "cascade" }),
  hostname: text("hostname").notNull(),
  status: text("status").notNull().default("creating_checkout"),
  currency: text("currency").notNull().default("USD"),
  registrarCost: numeric("registrar_cost", { precision: 12, scale: 2 }).notNull(),
  renewalRegistrarCost: numeric("renewal_registrar_cost", { precision: 12, scale: 2 }).notNull(),
  retailPrice: numeric("retail_price", { precision: 12, scale: 2 }).notNull(),
  renewalRetailPrice: numeric("renewal_retail_price", { precision: 12, scale: 2 }).notNull(),
  whopCheckoutConfigurationId: text("whop_checkout_configuration_id"),
  whopPlanId: text("whop_plan_id"),
  whopPaymentId: text("whop_payment_id"),
  cloudflareRegistrationId: text("cloudflare_registration_id"),
  cloudflareRegistrationStatus: text("cloudflare_registration_status"),
  registrationExpiresAt: timestamp("registration_expires_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userCreatedIndex: index("domain_registration_orders_user_created_idx").on(table.userId, table.createdAt),
  userStatusIndex: index("domain_registration_orders_user_status_idx").on(table.userId, table.status),
  checkoutUnique: uniqueIndex("domain_registration_orders_checkout_unique").on(table.whopCheckoutConfigurationId),
  paymentUnique: uniqueIndex("domain_registration_orders_payment_unique").on(table.whopPaymentId),
}));