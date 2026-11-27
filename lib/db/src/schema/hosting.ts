import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { authUsersTable } from "./auth-users";

const afucloudSchema = pgSchema("afucloud");

export const githubInstallationsTable = afucloudSchema.table("github_installations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => authUsersTable.id, { onDelete: "cascade" }),
  installationId: text("installation_id").notNull(),
  accountLogin: text("account_login").notNull(),
  accountType: text("account_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  installationUnique: uniqueIndex("github_installations_installation_id_unique").on(table.installationId),
  ownerIndex: index("github_installations_user_id_idx").on(table.userId),
}));

export const hostingOAuthStatesTable = afucloudSchema.table("hosting_oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => authUsersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hostingProjectsTable = afucloudSchema.table("hosting_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => authUsersTable.id, { onDelete: "cascade" }),
  githubInstallationId: uuid("github_installation_id").notNull()
    .references(() => githubInstallationsTable.id, { onDelete: "cascade" }),
  githubRepositoryId: text("github_repository_id").notNull(),
  repositoryFullName: text("repository_full_name").notNull(),
  repositoryPrivate: boolean("repository_private").notNull().default(false),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  productionBranch: text("production_branch").notNull(),
  rootDirectory: text("root_directory").notNull().default("."),
  framework: text("framework").notNull().default("auto"),
  runtime: text("runtime").notNull().default("static"),
  provider: text("provider").notNull().default("cloudflare_pages"),
  installCommand: text("install_command"),
  buildCommand: text("build_command"),
  outputDirectory: text("output_directory"),
  runCommand: text("run_command"),
  previewDeploymentsEnabled: boolean("preview_deployments_enabled").notNull().default(true),
  providerProjectName: text("provider_project_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  ownerSlugUnique: uniqueIndex("hosting_projects_user_slug_unique").on(table.userId, table.slug),
  repositoryIndex: index("hosting_projects_repository_idx").on(table.githubRepositoryId),
  ownerIndex: index("hosting_projects_user_id_idx").on(table.userId),
}));

export const hostingDeploymentsTable = afucloudSchema.table("hosting_deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => authUsersTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => hostingProjectsTable.id, { onDelete: "cascade" }),
  sourceDeploymentId: uuid("source_deployment_id"),
  environment: text("environment").notNull(),
  trigger: text("trigger").notNull(),
  branch: text("branch").notNull(),
  commitSha: text("commit_sha").notNull(),
  commitMessage: text("commit_message"),
  pullRequestNumber: integer("pull_request_number"),
  status: text("status").notNull().default("queued"),
  provider: text("provider").notNull(),
  providerDeploymentId: text("provider_deployment_id"),
  deploymentUrl: text("deployment_url"),
  previewUrl: text("preview_url"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  leaseTokenHash: text("lease_token_hash"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  projectCreatedIndex: index("hosting_deployments_project_created_idx").on(table.projectId, table.createdAt),
  queueIndex: index("hosting_deployments_queue_idx").on(table.status, table.availableAt, table.createdAt),
  leaseIndex: index("hosting_deployments_lease_idx").on(table.lockedAt),
}));

export const hostingDeploymentLogsTable = afucloudSchema.table("hosting_deployment_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  deploymentId: uuid("deployment_id").notNull().references(() => hostingDeploymentsTable.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  level: text("level").notNull().default("info"),
  stage: text("stage").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sequenceUnique: uniqueIndex("hosting_deployment_logs_sequence_unique").on(table.deploymentId, table.sequence),
  deploymentIndex: index("hosting_deployment_logs_deployment_idx").on(table.deploymentId, table.createdAt),
}));

export const hostingEnvironmentVariablesTable = afucloudSchema.table("hosting_environment_variables", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => authUsersTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => hostingProjectsTable.id, { onDelete: "cascade" }),
  environment: text("environment").notNull(),
  name: text("name").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  nameUnique: uniqueIndex("hosting_environment_variables_name_unique").on(table.projectId, table.environment, table.name),
  projectIndex: index("hosting_environment_variables_project_idx").on(table.projectId),
}));

export const hostingDomainsTable = afucloudSchema.table("hosting_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => authUsersTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => hostingProjectsTable.id, { onDelete: "cascade" }),
  hostname: text("hostname").notNull(),
  verificationToken: text("verification_token").notNull(),
  verificationStatus: text("verification_status").notNull().default("pending"),
  sslStatus: text("ssl_status").notNull().default("pending"),
  providerDomainId: text("provider_domain_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  hostnameUnique: uniqueIndex("hosting_domains_hostname_unique").on(table.hostname),
  projectIndex: index("hosting_domains_project_idx").on(table.projectId),
}));

export const hostingWebhookDeliveriesTable = afucloudSchema.table("hosting_webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  installationId: text("installation_id"),
  status: text("status").notNull().default("received"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const hostingRateLimitsTable = afucloudSchema.table("hosting_rate_limits", {
  bucketKey: text("bucket_key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  requestCount: integer("request_count").notNull().default(0),
});

export const insertHostingProjectSchema = createInsertSchema(hostingProjectsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export const insertHostingDeploymentSchema = createInsertSchema(hostingDeploymentsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });

export type InsertHostingProject = z.infer<typeof insertHostingProjectSchema>;
export type HostingProject = typeof hostingProjectsTable.$inferSelect;
export type HostingDeployment = typeof hostingDeploymentsTable.$inferSelect;
export type HostingDeploymentLog = typeof hostingDeploymentLogsTable.$inferSelect;
export type HostingDomain = typeof hostingDomainsTable.$inferSelect;
export type GithubInstallation = typeof githubInstallationsTable.$inferSelect;
