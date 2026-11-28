import { Hono } from "hono";
import type { AuthVariables, DbClient, Env } from "../types";
import { createDbClient } from "../lib/db";
import { requireAccountAuth, requireAuth } from "../middleware/auth";
import { getCloudflareUserAccessToken } from "../lib/cloudflare-account-token";
import {
  addPagesDomain,
  createPagesDeployment,
  createPagesProject,
  deletePagesDomain,
  deletePagesProject,
  getPagesDeploymentLogs,
  listCloudflareAccounts,
  listPagesDomains,
  rollbackPagesDeployment,
  updatePagesProject,
  type CloudflareAccount,
  type PagesDeployment,
  type PagesDomain,
  type PagesLog,
} from "../lib/cloudflare-pages";
import {
  createGitHubInstallationToken,
  decryptHostingSecret,
  encryptHostingSecret,
  getGitHubInstallationDetails,
  getGitHubRepositoryBranch,
  getGitHubUser,
  hashText,
  isSafeRelativePath,
  listGitHubInstallationRepositories,
  listGitHubRepositoryBranches,
  randomUrlSafeToken,
  readGitHubRepositoryFile,
  redactSecretValues,
  userCanAccessGitHubInstallation,
  verifyGitHubWebhookSignature,
  type GitHubRepository,
} from "@workspace/hosting-core";
import { CloudflareRequestError } from "@workspace/cloudflare-integration";
import { processHostingDeploymentById } from "../lib/hosting-jobs";

type WorkerContext = { Bindings: Env; Variables: AuthVariables };
type Framework = "auto" | "static" | "vite" | "react" | "vue" | "angular" | "nextjs";
type Runtime = "static" | "worker" | "node" | "python";
type DeploymentEnvironment = "production" | "preview";

const hosting = new Hono<WorkerContext>();
const frameworkValues = new Set<Framework>(["auto", "static", "vite", "react", "vue", "angular", "nextjs"]);
const runtimeValues = new Set<Runtime>(["static", "worker", "node", "python"]);
const GITHUB_WEBHOOK_MAX_BYTES = 1_000_000;

function asRecord(value: unknown): Record<string, any> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function publicHostingProject(project: any) {
  if (!project) return null;
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    repositoryId: project.github_repository_id,
    repositoryFullName: project.repository_full_name,
    repositoryPrivate: project.repository_private,
    githubInstallationId: project.github_installation_id,
    productionBranch: project.production_branch,
    rootDirectory: project.root_directory,
    framework: project.framework,
    runtime: project.runtime,
    provider: project.provider,
    providerAccountId: project.provider_account_id,
    providerProjectName: project.provider_project_name,
    installCommand: project.install_command,
    buildCommand: project.build_command,
    outputDirectory: project.output_directory,
    runCommand: project.run_command,
    previewDeploymentsEnabled: project.preview_deployments_enabled,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

function publicDeployment(deployment: any) {
  return {
    id: deployment.id,
    projectId: deployment.project_id,
    sourceDeploymentId: deployment.source_deployment_id,
    environment: deployment.environment,
    trigger: deployment.trigger,
    branch: deployment.branch,
    commitSha: deployment.commit_sha,
    commitMessage: deployment.commit_message,
    pullRequestNumber: deployment.pull_request_number,
    status: deployment.status,
    provider: deployment.provider,
    deploymentUrl: deployment.deployment_url,
    previewUrl: deployment.preview_url,
    errorCode: deployment.error_code,
    errorMessage: deployment.error_message,
    attempts: deployment.attempts,
    startedAt: deployment.started_at,
    completedAt: deployment.completed_at,
    createdAt: deployment.created_at,
  };
}

function publicDomain(domain: any, pagesTarget: string) {
  return {
    id: domain.id,
    projectId: domain.project_id,
    hostname: domain.hostname,
    verificationStatus: domain.verification_status,
    sslStatus: domain.ssl_status,
    providerDomainId: domain.provider_domain_id,
    dnsRecord: { type: "CNAME", name: domain.hostname, value: pagesTarget },
    createdAt: domain.created_at,
    updatedAt: domain.updated_at,
  };
}

function githubConfigured(env: Env): boolean {
  return Boolean(
    env.GITHUB_APP_ID &&
    env.GITHUB_APP_SLUG &&
    env.GITHUB_APP_PRIVATE_KEY &&
    env.GITHUB_APP_CLIENT_ID &&
    env.GITHUB_APP_CLIENT_SECRET &&
    env.GITHUB_APP_AUTH_CALLBACK_URL &&
    env.HOSTING_ENCRYPTION_KEY,
  );
}

function requireGitHubConfiguration(env: Env): {
  appId: string;
  privateKey: string;
  appSlug: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
} {
  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_APP_PRIVATE_KEY ||
    !env.GITHUB_APP_SLUG ||
    !env.GITHUB_APP_CLIENT_ID ||
    !env.GITHUB_APP_CLIENT_SECRET ||
    !env.GITHUB_APP_AUTH_CALLBACK_URL ||
    !env.HOSTING_ENCRYPTION_KEY
  ) {
    throw new Error("GitHub App hosting is not configured on the AfuCloud API Worker.");
  }
  const callback = new URL(env.GITHUB_APP_AUTH_CALLBACK_URL);
  if (callback.protocol !== "https:") {
    throw new Error("GitHub App authorization callback must use HTTPS.");
  }
  return {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    appSlug: env.GITHUB_APP_SLUG,
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
    callbackUrl: callback.toString(),
  };
}

function requestError(error: unknown): { status: number; message: string } {
  if (error instanceof CloudflareRequestError) {
    if (error.status === 401 || error.status === 403) {
      return {
        status: 409,
        message: "Cloudflare access needs Pages permissions. Reconnect Cloudflare and approve the hosting permissions.",
      };
    }
    if (error.status === 404) {
      return {
        status: 409,
        message: "The Cloudflare Pages project or GitHub connection was not found. Confirm the Cloudflare GitHub App is authorized for this repository.",
      };
    }
    if (error.status === 429 || error.status >= 500) {
      return { status: 502, message: "Cloudflare Pages is temporarily unavailable. Try again shortly." };
    }
    return {
      status: 422,
      message: "Cloudflare Pages rejected the request. Check the selected account, repository authorization, and project settings.",
    };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("not configured")) return { status: 503, message };
  if (message.includes("Connect a Cloudflare account")) return { status: 409, message };
  return { status: 502, message: "A hosting provider could not complete the request. Try again shortly." };
}

async function rateLimit(
  db: DbClient,
  bucket: string,
  limit: number,
): Promise<boolean> {
  return db.consumeHostingRateLimit(bucket, limit);
}

async function ownedProject(db: DbClient, projectId: string, userId: string) {
  return db.getHostingProject(projectId, userId);
}

async function installationToken(
  db: DbClient,
  userId: string,
  installationRowId: string,
  env: Env,
): Promise<string> {
  const installation = await db.getGithubInstallation(installationRowId, userId);
  if (!installation) throw new Error("GitHub installation not found. Reconnect GitHub and retry.");
  const config = requireGitHubConfiguration(env);
  return createGitHubInstallationToken(
    config.appId,
    config.privateKey,
    installation.installation_id,
  ).then(result => result.token);
}

function normalizeFramework(value: unknown): Framework {
  return typeof value === "string" && frameworkValues.has(value as Framework)
    ? value as Framework
    : "auto";
}

function detectFramework(packageJsonText: string | null): Framework {
  if (!packageJsonText) return "static";
  try {
    const packageJson = JSON.parse(packageJsonText) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    if (dependencies["@angular/core"]) return "angular";
    if (dependencies.next) return "nextjs";
    if (dependencies.vue) return "vue";
    if (dependencies.vite && dependencies.react) return "vite";
    if (dependencies.vite) return "vite";
    if (dependencies.react) return "react";
  } catch {
    return "static";
  }
  return "static";
}

function validCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/i.test(value);
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function projectSlug(name: string, userId: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "site";
  const random = randomUrlSafeToken(8).toLowerCase().replace(/[_-]/g, "a").slice(0, 10);
  return `afu-${base}-${userId.replace(/-/g, "").slice(0, 6)}-${random}`.slice(0, 63);
}

function validateHostname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    hostname.length > 253 ||
    !hostname.includes(".") ||
    /^[0-9.]+$/.test(hostname) ||
    hostname.split(".").some(label =>
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  ) return null;
  return hostname;
}

function pagesBuildConfig(project: any): Record<string, unknown> {
  const commands = [project.install_command, project.build_command]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const config: Record<string, unknown> = { root_dir: project.root_directory || "." };
  if (commands.length) config.build_command = commands.join(" && ");
  if (project.output_directory) config.destination_dir = project.output_directory;
  return config;
}

function pagesSourceConfig(project: any): Record<string, unknown> {
  return {
    production_branch: project.production_branch,
    production_deployments_enabled: false,
    preview_deployment_setting: "none",
  };
}

async function cloudflareTokenForProject(db: DbClient, userId: string, env: Env): Promise<string> {
  const accessToken = await getCloudflareUserAccessToken(db, userId, env);
  const connection = await db.getCloudflareConnection(userId);
  const scopes = Array.isArray(connection?.scopes) ? connection.scopes as string[] : [];
  if (!scopes.includes("page.write")) {
    throw new CloudflareRequestError("Cloudflare authorization needs Pages Write", 403);
  }
  return accessToken;
}

async function createDeploymentRow(
  db: DbClient,
  project: any,
  input: {
    environment: DeploymentEnvironment;
    trigger: "manual" | "push" | "pull_request" | "redeploy";
    branch: string;
    commitSha: string;
    commitMessage?: string | null;
    pullRequestNumber?: number | null;
    sourceDeploymentId?: string | null;
    sourceDeliveryId?: string | null;
  },
) {
  if (input.sourceDeliveryId) {
    const existing = await db.getHostingDeploymentBySourceDelivery(project.id, input.sourceDeliveryId);
    if (existing) return existing;
  }
  return db.createHostingDeployment({
    user_id: project.user_id,
    project_id: project.id,
    source_deployment_id: input.sourceDeploymentId ?? null,
    source_delivery_id: input.sourceDeliveryId ?? null,
    environment: input.environment,
    trigger: input.trigger,
    branch: input.branch,
    commit_sha: input.commitSha,
    commit_message: input.commitMessage ?? null,
    pull_request_number: input.pullRequestNumber ?? null,
    status: "queued",
    provider: project.provider,
  });
}

function scheduleDeployment(c: any, env: Env, db: DbClient, deployment: any) {
  if (!deployment?.id) return;
  c.executionCtx.waitUntil(processHostingDeploymentById(env, db, deployment.id));
}

function mapPagesDomain(domain: PagesDomain) {
  const providerState = `${domain.status ?? ""} ${domain.verification_data?.status ?? ""}`.toLowerCase();
  const sslState = (domain.ssl?.status ?? "").toLowerCase();
  return {
    verificationStatus: ["active", "verified", "success"].some(value => providerState.includes(value))
      ? "verified"
      : providerState.includes("fail") || providerState.includes("error")
        ? "failed"
        : "pending",
    sslStatus: ["active", "issued", "success"].some(value => sslState.includes(value))
      ? "active"
      : sslState.includes("fail") || sslState.includes("error")
        ? "failed"
        : "pending",
  };
}

async function configurePagesEnvironment(
  db: DbClient,
  env: Env,
  project: any,
  token: string,
  changes?: { environment: DeploymentEnvironment; name: string; value?: string; remove?: boolean },
) {
  if (!env.HOSTING_ENCRYPTION_KEY) {
    throw new Error("Hosting secret encryption is not configured on the AfuCloud API Worker.");
  }
  const stored = await db.getHostingEnvironmentVariables(project.id, project.user_id);
  const values: Record<DeploymentEnvironment, Record<string, { type: "secret_text"; value: string }>> = {
    production: {},
    preview: {},
  };
  for (const variable of stored) {
    const environment = variable.environment as DeploymentEnvironment;
    if (environment !== "production" && environment !== "preview") continue;
    values[environment][variable.name] = {
      type: "secret_text",
      value: await decryptHostingSecret(variable.encrypted_value, env.HOSTING_ENCRYPTION_KEY),
    };
  }
  if (changes) {
    if (changes.remove) delete values[changes.environment][changes.name];
    else if (changes.value !== undefined) {
      values[changes.environment][changes.name] = { type: "secret_text", value: changes.value };
    }
  }
  await updatePagesProject(token, project.provider_account_id, project.provider_project_name, {
    deployment_configs: {
      production: { env_vars: values.production },
      preview: { env_vars: values.preview },
    },
  });
}

function packageFilePath(rootDirectory: string): string {
  return rootDirectory === "." ? "package.json" : `${rootDirectory}/package.json`;
}

function nextConfigPath(rootDirectory: string): string {
  return rootDirectory === "." ? "next.config.js" : `${rootDirectory}/next.config.js`;
}

function asGitHubRepository(value: GitHubRepository) {
  return {
    id: String(value.id),
    fullName: value.full_name,
    name: value.name,
    private: value.private,
    defaultBranch: value.default_branch,
    owner: { login: value.owner.login, id: value.owner.id == null ? null : String(value.owner.id) },
  };
}

// GitHub App installation flow uses a one-time, database-backed callback state.
hosting.post("/github/install", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  if (!await rateLimit(db, `hosting:github-install:${c.get("userId")}`, 10)) {
    return c.json({ error: "Too many GitHub connection attempts. Try again in a minute." }, 429);
  }
  try {
    const config = requireGitHubConfiguration(c.env);
    const state = randomUrlSafeToken(32);
    await db.createHostingOAuthState({
      state_hash: await hashText(state),
      user_id: c.get("userId"),
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    const installUrl = new URL("https://github.com/login/oauth/authorize");
    installUrl.searchParams.set("client_id", config.clientId);
    installUrl.searchParams.set("redirect_uri", config.callbackUrl);
    installUrl.searchParams.set("scope", "read:user");
    installUrl.searchParams.set("state", state);
    return c.json({ authorizationUrl: installUrl.toString() });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "GitHub App could not be configured." }, 503);
  }
});

hosting.get("/github/oauth/callback", async c => {
  const state = c.req.query("state") ?? "";
  const code = c.req.query("code") ?? "";
  const oauthError = c.req.query("error");
  const destination = new URL("/hosting", c.env.PUBLIC_SITE_URL ?? "https://cloud.afuchat.com");
  if (!state || oauthError || !code) {
    destination.searchParams.set("github", oauthError ? "denied" : "failed");
    return c.redirect(destination.toString(), 302);
  }

  const db = createDbClient(c.env);
  const stateHash = await hashText(state);
  try {
    const stateRow = await db.consumeHostingOAuthState(stateHash);
    if (!stateRow) {
      destination.searchParams.set("github", "expired");
      return c.redirect(destination.toString(), 302);
    }
    const config = requireGitHubConfiguration(c.env);
    const exchangeBody = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
    });
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: exchangeBody,
      signal: AbortSignal.timeout(12_000),
    });
    const tokenResult = await response.json().catch(() => ({})) as {
      access_token?: string;
      error?: string;
    };
    if (!response.ok || !tokenResult.access_token) {
      throw new Error("GitHub user authorization failed.");
    }
    const githubUser = await getGitHubUser(tokenResult.access_token);
    const installState = randomUrlSafeToken(32);
    await db.createHostingOAuthState({
      state_hash: await hashText(installState),
      user_id: stateRow.user_id,
      github_user_id: String(githubUser.id),
      github_login: githubUser.login,
      github_access_token_encrypted: await encryptHostingSecret(
        tokenResult.access_token,
        c.env.HOSTING_ENCRYPTION_KEY!,
      ),
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    const installationUrl = new URL(`https://github.com/apps/${encodeURIComponent(config.appSlug)}/installations/new`);
    installationUrl.searchParams.set("state", installState);
    return c.redirect(installationUrl.toString(), 302);
  } catch {
    destination.searchParams.set("github", "failed");
    return c.redirect(destination.toString(), 302);
  }
});

hosting.get("/github/callback", async c => {
  const state = c.req.query("state") ?? "";
  const installationId = c.req.query("installation_id") ?? "";
  const destination = new URL("/hosting", c.env.PUBLIC_SITE_URL ?? "https://cloud.afuchat.com");
  if (!state || !/^\d+$/.test(installationId)) {
    destination.searchParams.set("github", "failed");
    return c.redirect(destination.toString(), 302);
  }

  try {
    const db = createDbClient(c.env);
    const stateRow = await db.consumeHostingOAuthState(await hashText(state));
    if (!stateRow) {
      destination.searchParams.set("github", "expired");
      return c.redirect(destination.toString(), 302);
    }
    if (
      !stateRow.github_user_id ||
      !stateRow.github_access_token_encrypted ||
      !stateRow.github_login ||
      !c.env.HOSTING_ENCRYPTION_KEY
    ) {
      destination.searchParams.set("github", "failed");
      return c.redirect(destination.toString(), 302);
    }
    const githubUserToken = await decryptHostingSecret(
      stateRow.github_access_token_encrypted,
      c.env.HOSTING_ENCRYPTION_KEY,
    );
    await db.clearHostingOAuthStateToken(await hashText(state));
    if (!await userCanAccessGitHubInstallation(githubUserToken, installationId)) {
      destination.searchParams.set("github", "unauthorized-installation");
      return c.redirect(destination.toString(), 302);
    }
    const config = requireGitHubConfiguration(c.env);
    const installation = await getGitHubInstallationDetails(config.appId, config.privateKey, installationId);
    if (String(installation.id) !== installationId) {
      destination.searchParams.set("github", "failed");
      return c.redirect(destination.toString(), 302);
    }

    const existing = await db.getGithubInstallationByInstallationId(installationId);
    if (existing && existing.user_id !== stateRow.user_id) {
      destination.searchParams.set("github", "already-linked");
      return c.redirect(destination.toString(), 302);
    }
    if (existing) {
      await db.updateGithubInstallation(existing.id, {
        account_login: installation.account.login,
        account_type: installation.account.type,
        active: true,
        updated_at: new Date().toISOString(),
      });
    } else {
      await db.createGithubInstallation({
        user_id: stateRow.user_id,
        installation_id: installationId,
        account_login: installation.account.login,
        account_type: installation.account.type,
        active: true,
      });
    }
    await db.logActivity({
      user_id: stateRow.user_id,
      action: "connect",
      resource: "hosting_github",
      resource_id: installationId,
      metadata: { accountLogin: installation.account.login },
    });
    destination.searchParams.set("github", "connected");
  } catch {
    destination.searchParams.set("github", "failed");
  }
  return c.redirect(destination.toString(), 302);
});

hosting.get("/github/installations", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const installations = await db.getGithubInstallations(c.get("userId"));
    return c.json({
      configured: githubConfigured(c.env),
      installations: installations.map(item => ({
        id: item.id,
        installationId: item.installation_id,
        accountLogin: item.account_login,
        accountType: item.account_type,
        createdAt: item.created_at,
      })),
    });
  } catch {
    return c.json({ error: "GitHub installations could not be loaded." }, 502);
  }
});

hosting.get("/github/installations/:installationId/repositories", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  try {
    if (!await rateLimit(db, `hosting:repositories:${c.get("userId")}`, 60)) {
      return c.json({ error: "Repository lookup is temporarily rate limited." }, 429);
    }
    const token = await installationToken(db, c.get("userId"), c.req.param("installationId"), c.env);
    const repositories = await listGitHubInstallationRepositories(token);
    return c.json(repositories.map(asGitHubRepository));
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.get("/github/installations/:installationId/repositories/:owner/:repository/branches", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  try {
    if (!await rateLimit(db, `hosting:branches:${c.get("userId")}`, 60)) {
      return c.json({ error: "Branch lookup is temporarily rate limited." }, 429);
    }
    const token = await installationToken(db, c.get("userId"), c.req.param("installationId"), c.env);
    const repositoryFullName = `${c.req.param("owner")}/${c.req.param("repository")}`;
    const branches = await listGitHubRepositoryBranches(token, repositoryFullName);
    return c.json(branches.map(name => ({ name })));
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.get("/cloudflare/accounts", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const token = await getCloudflareUserAccessToken(db, c.get("userId"), c.env);
    const accounts = await listCloudflareAccounts(token);
    return c.json(accounts.map((account: CloudflareAccount) => ({
      id: account.id,
      name: account.name,
      type: account.type ?? null,
    })));
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.get("/projects", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const projects = await db.getHostingProjects(c.get("userId"));
    const result = await Promise.all(projects.map(async project => {
      const deployments = await db.getHostingDeployments(project.id, c.get("userId"));
      return {
        ...publicHostingProject(project),
        latestDeployment: deployments[0] ? publicDeployment(deployments[0]) : null,
        trafficMetricsAvailable: false,
        bandwidthMetricsAvailable: false,
      };
    }));
    return c.json(result);
  } catch {
    return c.json({ error: "Hosting projects could not be loaded." }, 502);
  }
});

hosting.post("/projects", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  const userId = c.get("userId");
  if (!await rateLimit(db, `hosting:create:${userId}`, 10)) {
    return c.json({ error: "Too many hosting projects were created. Try again in a minute." }, 429);
  }
  const input = asRecord(await c.req.json().catch(() => ({})));
  const name = safeText(input?.name, 80);
  const installationId = safeText(input?.installationId, 80);
  const repositoryId = safeText(input?.repositoryId, 30);
  const repositoryFullName = safeText(input?.repositoryFullName, 250);
  const providerAccountId = safeText(input?.providerAccountId, 32);
  const productionBranch = safeText(input?.productionBranch, 255);
  const rootDirectory = typeof input?.rootDirectory === "string" && isSafeRelativePath(input.rootDirectory)
    ? input.rootDirectory
    : null;
  const requestedFramework = normalizeFramework(input?.framework);
  const runtime = typeof input?.runtime === "string" && runtimeValues.has(input.runtime as Runtime)
    ? input.runtime as Runtime
    : "static";
  const installCommand = safeText(input?.installCommand, 300);
  const buildCommand = safeText(input?.buildCommand, 300);
  const outputDirectory = typeof input?.outputDirectory === "string"
    ? input.outputDirectory.trim()
    : "";
  const previewDeploymentsEnabled = input?.previewDeploymentsEnabled !== false;

  if (!name || !installationId || !repositoryId || !/^\d+$/.test(repositoryId) ||
      !repositoryFullName || !/^[^/]+\/[^/]+$/.test(repositoryFullName) ||
      !providerAccountId || !productionBranch || !rootDirectory ||
      (input?.runtime != null && !runtimeValues.has(input.runtime))) {
    return c.json({ error: "Project name, authorized repository, Cloudflare account, branch, and a safe root directory are required." }, 400);
  }
  if ((input?.installCommand != null && !installCommand) || (input?.buildCommand != null && !buildCommand)) {
    return c.json({ error: "Build commands must be 300 characters or fewer." }, 400);
  }
  if (outputDirectory && !isSafeRelativePath(outputDirectory)) {
    return c.json({ error: "Output directory must be a safe relative path inside the repository." }, 400);
  }
  if (input?.framework != null && !frameworkValues.has(input.framework)) {
    return c.json({ error: "Choose a supported static framework." }, 400);
  }
  if (runtime !== "static") {
    return c.json({
      error: "Only static and static-export applications can be deployed through this provider today. Node.js servers, Python apps, and Docker need a separate isolated runtime.",
      runtimeUnavailable: true,
    }, 422);
  }

  let providerProjectName: string | null = null;
  let providerCreated = false;
  let savedProjectId: string | null = null;
  let accessToken: string | null = null;
  try {
    const installation = await db.getGithubInstallation(installationId, userId);
    if (!installation) return c.json({ error: "GitHub installation not found. Connect the account that owns this repository." }, 404);
    const token = await installationToken(db, userId, installationId, c.env);
    const repositories = await listGitHubInstallationRepositories(token);
    const repository = repositories.find(item =>
      String(item.id) === repositoryId && item.full_name.toLowerCase() === repositoryFullName.toLowerCase(),
    );
    if (!repository) return c.json({ error: "This repository is not available through the selected GitHub installation." }, 403);
    if (!repository.owner?.id) return c.json({ error: "GitHub did not provide the repository owner's identifier." }, 502);
    const branches = await listGitHubRepositoryBranches(token, repository.full_name);
    if (!branches.includes(productionBranch)) {
      return c.json({ error: "Select a branch that exists in the connected repository." }, 400);
    }

    const accounts = await listCloudflareAccounts(await getCloudflareUserAccessToken(db, userId, c.env));
    if (!accounts.some(account => account.id === providerAccountId)) {
      return c.json({ error: "Select a Cloudflare account available to your connected account." }, 403);
    }
    accessToken = await cloudflareTokenForProject(db, userId, c.env);

    let detectedFramework = requestedFramework;
    const packageJson = await readGitHubRepositoryFile(token, repository.full_name, packageFilePath(rootDirectory));
    if (detectedFramework === "auto") detectedFramework = detectFramework(packageJson);
    let resolvedOutputDirectory = outputDirectory || null;
    if (detectedFramework === "nextjs") {
      const nextConfig = await readGitHubRepositoryFile(token, repository.full_name, nextConfigPath(rootDirectory));
      if (!nextConfig || !/output\s*:\s*["']export["']/.test(nextConfig)) {
        return c.json({
          error: "Next.js requires static export configuration (output: 'export') for Cloudflare Pages. Server-rendered Next.js apps need the isolated Workers runtime.",
          runtimeUnavailable: true,
        }, 422);
      }
      resolvedOutputDirectory ??= "out";
    }

    providerProjectName = projectSlug(name, userId);
    const providerProject = await createPagesProject(accessToken, {
      accountId: providerAccountId,
      projectName: providerProjectName,
      owner: repository.owner.login,
      ownerId: String(repository.owner.id),
      repositoryName: repository.name,
      repositoryId: String(repository.id),
      productionBranch,
      rootDirectory,
      installCommand,
      buildCommand,
      outputDirectory: resolvedOutputDirectory,
      previewsEnabled: previewDeploymentsEnabled,
    });
    providerCreated = true;

    const project = await db.createHostingProject({
      user_id: userId,
      github_installation_id: installation.id,
      github_repository_id: repositoryId,
      repository_full_name: repository.full_name,
      repository_private: repository.private,
      name,
      slug: providerProjectName,
      production_branch: productionBranch,
      root_directory: rootDirectory,
      framework: detectedFramework,
      runtime: "static",
      provider: "cloudflare_pages",
      provider_account_id: providerAccountId,
      install_command: installCommand,
      build_command: buildCommand,
      output_directory: resolvedOutputDirectory,
      run_command: null,
      preview_deployments_enabled: previewDeploymentsEnabled,
      provider_project_name: providerProject.name || providerProjectName,
    });
    if (!project) throw new Error("Hosting project could not be saved.");
    savedProjectId = project.id;

    const branch = await getGitHubRepositoryBranch(token, repository.full_name, productionBranch);
    const deployment = await createDeploymentRow(db, project, {
      environment: "production",
      trigger: "manual",
      branch: branch.name,
      commitSha: branch.commitSha,
      commitMessage: "Initial deployment",
    });
    await db.logActivity({
      user_id: userId,
      action: "create",
      resource: "hosting_project",
      resource_id: project.id,
      metadata: { repository: repository.full_name, provider: "cloudflare_pages" },
    });
    scheduleDeployment(c, c.env, db, deployment);
    return c.json({
      project: publicHostingProject(project),
      deployment: deployment ? publicDeployment(deployment) : null,
      providerUrl: providerProject.subdomain ? `https://${providerProject.subdomain}` : null,
    }, 201);
  } catch (error) {
    if (providerCreated && providerProjectName && accessToken && providerAccountId) {
      await deletePagesProject(accessToken, providerAccountId, providerProjectName).catch(() => {});
    }
    if (savedProjectId) await db.deleteHostingProject(savedProjectId, userId).catch(() => {});
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.get("/projects/:projectId", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const project = await ownedProject(db, c.req.param("projectId"), c.get("userId"));
    if (!project) return c.json({ error: "Hosting project not found." }, 404);
    return c.json(publicHostingProject(project));
  } catch {
    return c.json({ error: "Hosting project could not be loaded." }, 502);
  }
});

hosting.patch("/projects/:projectId", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  const userId = c.get("userId");
  const project = await ownedProject(db, c.req.param("projectId"), userId);
  if (!project) return c.json({ error: "Hosting project not found." }, 404);
  const input = asRecord(await c.req.json().catch(() => ({})));
  if (!input) return c.json({ error: "Invalid project settings." }, 400);

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = safeText(input.name, 80);
    if (!name) return c.json({ error: "Project name must be 1–80 characters." }, 400);
    update.name = name;
  }
  if (input.productionBranch !== undefined) {
    const branch = safeText(input.productionBranch, 255);
    if (!branch) return c.json({ error: "Choose a valid production branch." }, 400);
    update.production_branch = branch;
  }
  if (input.rootDirectory !== undefined) {
    if (typeof input.rootDirectory !== "string" || !isSafeRelativePath(input.rootDirectory)) {
      return c.json({ error: "Root directory must be a safe relative path." }, 400);
    }
    update.root_directory = input.rootDirectory;
  }
  if (input.framework !== undefined) {
    const framework = normalizeFramework(input.framework);
    if (framework !== input.framework) return c.json({ error: "Choose a supported framework." }, 400);
    update.framework = framework;
  }
  for (const [inputName, column] of [
    ["installCommand", "install_command"],
    ["buildCommand", "build_command"],
  ] as const) {
    if (input[inputName] !== undefined) {
      const command = input[inputName] === null || input[inputName] === "" ? null : safeText(input[inputName], 300);
      if (input[inputName] !== null && input[inputName] !== "" && !command) {
        return c.json({ error: "Build commands must be 300 characters or fewer." }, 400);
      }
      update[column] = command;
    }
  }
  if (input.outputDirectory !== undefined) {
    if (input.outputDirectory !== null && input.outputDirectory !== "" &&
        (typeof input.outputDirectory !== "string" || !isSafeRelativePath(input.outputDirectory))) {
      return c.json({ error: "Output directory must be a safe relative path." }, 400);
    }
    update.output_directory = input.outputDirectory || null;
  }
  if (input.previewDeploymentsEnabled !== undefined) {
    if (typeof input.previewDeploymentsEnabled !== "boolean") return c.json({ error: "Preview setting must be true or false." }, 400);
    update.preview_deployments_enabled = input.previewDeploymentsEnabled;
  }
  if (!Object.keys(update).length) return c.json(publicHostingProject(project));
  const nextProject = { ...project, ...Object.fromEntries(Object.entries(update).map(([key, value]) => [key, value])) };
  if (nextProject.runtime !== "static") {
    return c.json({ error: "This provider currently supports static and static-export projects only." }, 422);
  }

  try {
    const token = await cloudflareTokenForProject(db, userId, c.env);
    await updatePagesProject(token, project.provider_account_id, project.provider_project_name, {
      build_config: pagesBuildConfig(nextProject),
      source: { config: pagesSourceConfig(nextProject) },
    });
    const updated = await db.updateHostingProject(project.id, userId, update);
    if (!updated) return c.json({ error: "Hosting project settings could not be saved." }, 502);
    await db.logActivity({
      user_id: userId,
      action: "update",
      resource: "hosting_project",
      resource_id: project.id,
      metadata: { changedFields: Object.keys(update) },
    });
    return c.json(publicHostingProject(updated));
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.delete("/projects/:projectId", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  const project = await ownedProject(db, c.req.param("projectId"), c.get("userId"));
  if (!project) return c.json({ error: "Hosting project not found." }, 404);
  try {
    const token = await cloudflareTokenForProject(db, c.get("userId"), c.env);
    await deletePagesProject(token, project.provider_account_id, project.provider_project_name);
    await db.deleteHostingProject(project.id, c.get("userId"));
    await db.logActivity({
      user_id: c.get("userId"),
      action: "delete",
      resource: "hosting_project",
      resource_id: project.id,
      metadata: { providerProject: project.provider_project_name },
    });
    return c.json({ message: "Hosting project, deployment history, domains, and secrets were removed." });
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.get("/projects/:projectId/deployments", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const project = await ownedProject(db, c.req.param("projectId"), c.get("userId"));
    if (!project) return c.json({ error: "Hosting project not found." }, 404);
    const deployments = await db.getHostingDeployments(project.id, c.get("userId"));
    return c.json(deployments.map(publicDeployment));
  } catch {
    return c.json({ error: "Deployment history could not be loaded." }, 502);
  }
});

hosting.post("/projects/:projectId/deployments", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  const userId = c.get("userId");
  if (!await rateLimit(db, `hosting:deploy:${userId}`, 30)) {
    return c.json({ error: "Too many deployment requests. Try again in a minute." }, 429);
  }
  const project = await ownedProject(db, c.req.param("projectId"), userId);
  if (!project) return c.json({ error: "Hosting project not found." }, 404);
  const input = asRecord(await c.req.json().catch(() => ({})));
  const branchName = safeText(input?.branch, 255) ?? project.production_branch;
  try {
    const token = await installationToken(db, userId, project.github_installation_id, c.env);
    const branch = await getGitHubRepositoryBranch(token, project.repository_full_name, branchName);
    if (branch.name !== project.production_branch && !project.preview_deployments_enabled) {
      return c.json({ error: "Preview deployments are disabled for this project." }, 409);
    }
    const deployment = await createDeploymentRow(db, project, {
      environment: branch.name === project.production_branch ? "production" : "preview",
      trigger: "manual",
      branch: branch.name,
      commitSha: branch.commitSha,
    });
    if (!deployment) throw new Error("Deployment could not be queued.");
    scheduleDeployment(c, c.env, db, deployment);
    return c.json(publicDeployment(deployment), 202);
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.post("/projects/:projectId/deployments/:deploymentId/redeploy", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  const userId = c.get("userId");
  const project = await ownedProject(db, c.req.param("projectId"), userId);
  if (!project) return c.json({ error: "Hosting project not found." }, 404);
  const source = await db.getHostingDeployment(c.req.param("deploymentId"), userId);
  if (!source || source.project_id !== project.id) return c.json({ error: "Deployment not found." }, 404);
  try {
    const token = await installationToken(db, userId, project.github_installation_id, c.env);
    const branch = await getGitHubRepositoryBranch(token, project.repository_full_name, source.branch);
    const deployment = await createDeploymentRow(db, project, {
      environment: source.environment as DeploymentEnvironment,
      trigger: "redeploy",
      branch: branch.name,
      commitSha: branch.commitSha,
      commitMessage: source.commit_message,
      pullRequestNumber: source.pull_request_number,
      sourceDeploymentId: source.id,
    });
    if (!deployment) throw new Error("Redeployment could not be queued.");
    scheduleDeployment(c, c.env, db, deployment);
    return c.json(publicDeployment(deployment), 202);
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.post("/projects/:projectId/deployments/:deploymentId/rollback", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  const userId = c.get("userId");
  const project = await ownedProject(db, c.req.param("projectId"), userId);
  if (!project) return c.json({ error: "Hosting project not found." }, 404);
  const source = await db.getHostingDeployment(c.req.param("deploymentId"), userId);
  if (!source || source.project_id !== project.id || source.environment !== "production" ||
      source.status !== "ready" || !source.provider_deployment_id) {
    return c.json({ error: "Choose a successful production deployment to roll back to." }, 409);
  }
  try {
    const token = await cloudflareTokenForProject(db, userId, c.env);
    const providerDeployment = await rollbackPagesDeployment(
      token,
      project.provider_account_id,
      project.provider_project_name,
      source.provider_deployment_id,
    );
    const upstreamId = providerDeployment.id ?? providerDeployment.deployment_uuid;
    if (!upstreamId) throw new Error("Cloudflare Pages did not return a rollback deployment identifier.");
    const deployment = await db.createHostingDeployment({
      user_id: userId,
      project_id: project.id,
      source_deployment_id: source.id,
      environment: "production",
      trigger: "rollback",
      branch: source.branch,
      commit_sha: source.commit_sha,
      commit_message: `Rollback to ${source.commit_sha.slice(0, 7)}`,
      status: "deploying",
      provider: project.provider,
      provider_deployment_id: upstreamId,
      deployment_url: providerDeployment.url ?? null,
      started_at: new Date().toISOString(),
    });
    await db.logActivity({
      user_id: userId,
      action: "rollback",
      resource: "hosting_deployment",
      resource_id: deployment?.id,
      metadata: { projectId: project.id, sourceDeploymentId: source.id },
    });
    return c.json(deployment ? publicDeployment(deployment) : null, 202);
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.get("/deployments/:deploymentId/logs", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  const deployment = await db.getHostingDeployment(c.req.param("deploymentId"), c.get("userId"));
  if (!deployment) return c.json({ error: "Deployment not found." }, 404);
  const project = await ownedProject(db, deployment.project_id, c.get("userId"));
  if (!project) return c.json({ error: "Hosting project not found." }, 404);
  if (!deployment.provider_deployment_id) {
    return c.json({ logs: await db.getHostingDeploymentLogs(deployment.id), source: "afucloud" });
  }
  try {
    const token = await cloudflareTokenForProject(db, c.get("userId"), c.env);
    const providerLogs: PagesLog[] = await getPagesDeploymentLogs(
      token,
      project.provider_account_id,
      project.provider_project_name,
      deployment.provider_deployment_id,
    );
    const storedSecrets = await db.getHostingEnvironmentVariables(project.id, c.get("userId"));
    if (storedSecrets.length && !c.env.HOSTING_ENCRYPTION_KEY) {
      return c.json({ error: "Build logs are hidden until secret redaction is available." }, 503);
    }
    const secretValues = c.env.HOSTING_ENCRYPTION_KEY
      ? await Promise.all(storedSecrets.map(item => decryptHostingSecret(item.encrypted_value, c.env.HOSTING_ENCRYPTION_KEY!)))
      : [];
    const logs = providerLogs.slice(-500).map((entry, index) => ({
      deployment_id: deployment.id,
      sequence: index,
      level: ["debug", "info", "warn", "error"].includes((entry.level ?? "").toLowerCase())
        ? (entry.level ?? "info").toLowerCase()
        : "info",
      stage: safeText(entry.stage, 100) ?? "build",
      message: redactSecretValues(typeof entry.message === "string" ? entry.message : "", secretValues),
      created_at: entry.timestamp ?? null,
    }));
    await db.insertHostingDeploymentLogs(logs).catch(() => {});
    return c.json({
      logs: logs.map(log => ({
        sequence: log.sequence,
        level: log.level,
        stage: log.stage,
        message: log.message,
        createdAt: log.created_at,
      })),
      source: "cloudflare_pages",
    });
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.get("/projects/:projectId/environment-variables", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const project = await ownedProject(db, c.req.param("projectId"), c.get("userId"));
    if (!project) return c.json({ error: "Hosting project not found." }, 404);
    const variables = await db.getHostingEnvironmentVariables(project.id, c.get("userId"));
    return c.json(variables.map(item => ({
      id: item.id,
      name: item.name,
      environment: item.environment,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })));
  } catch {
    return c.json({ error: "Environment variables could not be loaded." }, 502);
  }
});

hosting.put("/projects/:projectId/environment-variables", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  const userId = c.get("userId");
  const project = await ownedProject(db, c.req.param("projectId"), userId);
  if (!project) return c.json({ error: "Hosting project not found." }, 404);
  const input = asRecord(await c.req.json().catch(() => ({})));
  const name = safeText(input?.name, 128);
  const value = typeof input?.value === "string" ? input.value : null;
  const environment = input?.environment;
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) ||
      value === null || value.length > 8000 ||
      (environment !== "production" && environment !== "preview")) {
    return c.json({ error: "Provide a valid variable name, value, and environment." }, 400);
  }
  if (!c.env.HOSTING_ENCRYPTION_KEY) {
    return c.json({ error: "Hosting secret encryption is not configured on the AfuCloud API Worker." }, 503);
  }
  try {
    const existing = await db.getHostingEnvironmentVariables(project.id, userId, environment);
    const oldValue = existing.find(item => item.name === name) ?? null;
    const encryptedValue = await encryptHostingSecret(value, c.env.HOSTING_ENCRYPTION_KEY);
    await db.upsertHostingEnvironmentVariable({
      user_id: userId,
      project_id: project.id,
      environment,
      name,
      encrypted_value: encryptedValue,
      updated_at: new Date().toISOString(),
    });
    try {
      const token = await cloudflareTokenForProject(db, userId, c.env);
      await configurePagesEnvironment(db, c.env, project, token);
    } catch (error) {
      if (oldValue) {
        await db.upsertHostingEnvironmentVariable({ ...oldValue, encrypted_value: oldValue.encrypted_value });
      } else {
        const current = (await db.getHostingEnvironmentVariables(project.id, userId, environment))
          .find(item => item.name === name);
        if (current) await db.deleteHostingEnvironmentVariable(current.id, project.id, userId);
      }
      throw error;
    }
    await db.logActivity({
      user_id: userId,
      action: "set",
      resource: "hosting_environment_variable",
      resource_id: project.id,
      metadata: { name, environment },
    });
    const saved = (await db.getHostingEnvironmentVariables(project.id, userId, environment)).find(item => item.name === name);
    return c.json(saved ? {
      id: saved.id,
      name: saved.name,
      environment: saved.environment,
      createdAt: saved.created_at,
      updatedAt: saved.updated_at,
    } : null);
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.delete("/projects/:projectId/environment-variables/:variableId", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  const userId = c.get("userId");
  const project = await ownedProject(db, c.req.param("projectId"), userId);
  if (!project) return c.json({ error: "Hosting project not found." }, 404);
  try {
    const variables = await db.getHostingEnvironmentVariables(project.id, userId);
    const variable = variables.find(item => item.id === c.req.param("variableId"));
    if (!variable) return c.json({ error: "Environment variable not found." }, 404);
    await db.deleteHostingEnvironmentVariable(variable.id, project.id, userId);
    try {
      const token = await cloudflareTokenForProject(db, userId, c.env);
      await configurePagesEnvironment(db, c.env, project, token);
    } catch (error) {
      await db.upsertHostingEnvironmentVariable(variable);
      throw error;
    }
    await db.logActivity({
      user_id: userId,
      action: "delete",
      resource: "hosting_environment_variable",
      resource_id: project.id,
      metadata: { name: variable.name, environment: variable.environment },
    });
    return c.json({ message: "Environment variable removed." });
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.get("/projects/:projectId/domains", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const project = await ownedProject(db, c.req.param("projectId"), c.get("userId"));
    if (!project) return c.json({ error: "Hosting project not found." }, 404);
    const domains = await db.getHostingDomains(project.id, c.get("userId"));
    const target = `${project.provider_project_name}.pages.dev`;
    return c.json(domains.map(domain => publicDomain(domain, target)));
  } catch {
    return c.json({ error: "Hosting domains could not be loaded." }, 502);
  }
});

hosting.post("/projects/:projectId/domains", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  const userId = c.get("userId");
  const project = await ownedProject(db, c.req.param("projectId"), userId);
  if (!project) return c.json({ error: "Hosting project not found." }, 404);
  const input = asRecord(await c.req.json().catch(() => ({})));
  const hostname = validateHostname(input?.hostname);
  if (!hostname) return c.json({ error: "Enter a valid fully qualified domain name." }, 400);
  try {
    const token = await cloudflareTokenForProject(db, userId, c.env);
    const providerDomain = await addPagesDomain(
      token,
      project.provider_account_id,
      project.provider_project_name,
      hostname,
    );
    const state = mapPagesDomain(providerDomain);
    const domain = await db.createHostingDomain({
      user_id: userId,
      project_id: project.id,
      hostname,
      verification_token: null,
      verification_status: state.verificationStatus,
      ssl_status: state.sslStatus,
      provider_domain_id: providerDomain.id ?? hostname,
    });
    if (!domain) throw new Error("The custom domain could not be saved.");
    await db.logActivity({
      user_id: userId,
      action: "add",
      resource: "hosting_domain",
      resource_id: domain.id,
      metadata: { projectId: project.id, hostname },
    });
    return c.json({
      ...publicDomain(domain, `${project.provider_project_name}.pages.dev`),
      instructions: `Create a CNAME record for ${hostname} pointing to ${project.provider_project_name}.pages.dev, then check verification again.`,
    }, 201);
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.post("/projects/:projectId/domains/:domainId/verify", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  const userId = c.get("userId");
  const project = await ownedProject(db, c.req.param("projectId"), userId);
  if (!project) return c.json({ error: "Hosting project not found." }, 404);
  const domain = await db.getHostingDomain(c.req.param("domainId"), userId);
  if (!domain || domain.project_id !== project.id) return c.json({ error: "Hosting domain not found." }, 404);
  try {
    const token = await cloudflareTokenForProject(db, userId, c.env);
    const domains = await listPagesDomains(token, project.provider_account_id, project.provider_project_name);
    const providerDomain = domains.find(item => item.name.toLowerCase() === domain.hostname.toLowerCase());
    if (!providerDomain) return c.json({ error: "Cloudflare Pages no longer reports this domain. Remove it and add it again." }, 409);
    const state = mapPagesDomain(providerDomain);
    const updated = await db.updateHostingDomain(domain.id, userId, {
      verification_status: state.verificationStatus,
      ssl_status: state.sslStatus,
      provider_domain_id: providerDomain.id ?? domain.provider_domain_id,
      updated_at: new Date().toISOString(),
    });
    if (!updated) throw new Error("Hosting domain status could not be saved.");
    return c.json({
      ...publicDomain(updated, `${project.provider_project_name}.pages.dev`),
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.delete("/projects/:projectId/domains/:domainId", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  const userId = c.get("userId");
  const project = await ownedProject(db, c.req.param("projectId"), userId);
  if (!project) return c.json({ error: "Hosting project not found." }, 404);
  const domain = await db.getHostingDomain(c.req.param("domainId"), userId);
  if (!domain || domain.project_id !== project.id) return c.json({ error: "Hosting domain not found." }, 404);
  try {
    const token = await cloudflareTokenForProject(db, userId, c.env);
    await deletePagesDomain(token, project.provider_account_id, project.provider_project_name, domain.hostname);
    await db.deleteHostingDomain(domain.id, userId);
    return c.json({ message: "Custom domain removed from this Pages project." });
  } catch (error) {
    const result = requestError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

hosting.post("/webhooks/github", async c => {
  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "GitHub webhook delivery is not configured." }, 503);
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (contentLength > GITHUB_WEBHOOK_MAX_BYTES) return c.json({ error: "Webhook payload is too large." }, 413);
  const body = await c.req.text();
  if (body.length > GITHUB_WEBHOOK_MAX_BYTES) return c.json({ error: "Webhook payload is too large." }, 413);
  if (!await verifyGitHubWebhookSignature(body, c.req.header("x-hub-signature-256"), secret)) {
    return c.json({ error: "Webhook signature is invalid." }, 401);
  }

  const deliveryId = c.req.header("x-github-delivery") ?? "";
  const event = c.req.header("x-github-event") ?? "";
  if (!/^[A-Za-z0-9-]{1,100}$/.test(deliveryId)) return c.json({ error: "Webhook delivery ID is invalid." }, 400);
  const payload = asRecord(JSON.parse(body));
  if (!payload) return c.json({ error: "Webhook payload is invalid." }, 400);
  const installationId = payload.installation?.id != null ? String(payload.installation.id) : null;
  const db = createDbClient(c.env);
  try {
    if (installationId && !await rateLimit(db, `hosting:webhook:${installationId}`, 120)) {
      return c.json({ error: "GitHub webhook delivery is temporarily rate limited." }, 429);
    }
    const claimed = await db.claimHostingWebhookDelivery(deliveryId, event, installationId);
    if (!claimed) return c.json({ received: true, duplicate: true });

    let accepted = 0;
    if (event === "installation" && payload.action === "deleted" && installationId) {
      const existing = await db.getGithubInstallationByInstallationId(installationId);
      if (existing) {
        await db.updateGithubInstallation(existing.id, {
          active: false,
          updated_at: new Date().toISOString(),
        });
      }
    } else if (event === "push" && installationId) {
      const repository = asRecord(payload.repository);
      const ref = typeof payload.ref === "string" ? payload.ref.replace(/^refs\/heads\//, "") : "";
      const sha = payload.after;
      if (repository && /^\d+$/.test(String(repository.id ?? "")) && ref && validCommitSha(sha)) {
        const installation = await db.getGithubInstallationByInstallationId(installationId);
        if (installation?.active) {
          const projects = (await db.getHostingProjects(installation.user_id)).filter(project =>
            project.github_repository_id === String(repository.id) &&
            (project.production_branch === ref || project.preview_deployments_enabled),
          );
          for (const project of projects) {
            const production = project.production_branch === ref;
            const deployment = await createDeploymentRow(db, project, {
              environment: production ? "production" : "preview",
              trigger: "push",
              branch: ref,
              commitSha: sha,
              commitMessage: safeText(payload.head_commit?.message, 4000),
              sourceDeliveryId: deliveryId,
            });
            if (deployment) {
              accepted += 1;
              scheduleDeployment(c, c.env, db, deployment);
            }
          }
        }
      }
    } else if (event === "pull_request" && installationId) {
      const action = payload.action;
      const pullRequest = asRecord(payload.pull_request);
      const repository = asRecord(payload.repository);
      const head = asRecord(pullRequest?.head);
      const headRepository = asRecord(head?.repo);
      const base = asRecord(pullRequest?.base);
      const baseRepository = asRecord(base?.repo);
      const branch = typeof head?.ref === "string" ? head.ref : "";
      const sha = head?.sha;
      const sameRepository = String(headRepository?.id ?? "") === String(baseRepository?.id ?? "");
      if (
        ["opened", "reopened", "synchronize"].includes(String(action)) &&
        repository &&
        sameRepository &&
        validCommitSha(sha) &&
        branch &&
        /^\d+$/.test(String(repository.id ?? ""))
      ) {
        const installation = await db.getGithubInstallationByInstallationId(installationId);
        if (installation?.active) {
          const projects = (await db.getHostingProjects(installation.user_id)).filter(project =>
            project.github_repository_id === String(repository.id) &&
            project.preview_deployments_enabled,
          );
          for (const project of projects) {
            const deployment = await createDeploymentRow(db, project, {
              environment: "preview",
              trigger: "pull_request",
              branch,
              commitSha: sha,
              commitMessage: safeText(pullRequest?.title, 4000),
              pullRequestNumber: Number.isInteger(pullRequest?.number) ? pullRequest.number : null,
              sourceDeliveryId: deliveryId,
            });
            if (deployment) {
              accepted += 1;
              scheduleDeployment(c, c.env, db, deployment);
            }
          }
        }
      }
    }

    await db.updateHostingWebhookDelivery(deliveryId, accepted ? "processed" : "ignored");
    return c.json({ received: true, queuedDeployments: accepted });
  } catch {
    await db.updateHostingWebhookDelivery(deliveryId, "failed").catch(() => {});
    return c.json({ error: "GitHub webhook could not be processed. GitHub can safely retry this delivery." }, 503);
  }
});

export default hosting;
