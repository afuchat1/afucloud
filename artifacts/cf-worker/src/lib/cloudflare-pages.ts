import {
  CloudflareRequestError,
  cloudflareApi,
  type CloudflareApiEnvelope,
} from "@workspace/cloudflare-integration";

const API_ROOT = "https://api.cloudflare.com/client/v4";

export interface CloudflareAccount {
  id: string;
  name: string;
  type?: string;
}

export interface PagesProject {
  id?: string;
  name: string;
  subdomain?: string;
  domains?: string[];
  source?: {
    type?: string;
    config?: Record<string, unknown>;
  };
}

export interface PagesDeployment {
  id?: string;
  deployment_uuid?: string;
  url?: string;
  environment?: "production" | "preview" | string;
  latest_stage?: { name?: string; status?: string; started_on?: string; ended_on?: string };
  deployment_trigger?: {
    type?: string;
    metadata?: {
      branch?: string;
      commit_hash?: string;
      commit_message?: string;
      commit_dirty?: boolean;
    };
  };
  created_on?: string;
  modified_on?: string;
  stages?: Array<{ name?: string; status?: string }>;
}

export interface PagesDomain {
  id?: string;
  name: string;
  status?: string;
  verification_data?: { status?: string; error_message?: string };
  ssl?: { status?: string };
}

export interface PagesLog {
  timestamp?: string;
  level?: string;
  message?: string;
  stage?: string;
}

export async function listCloudflareAccounts(accessToken: string): Promise<CloudflareAccount[]> {
  const accounts: CloudflareAccount[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await cloudflareApi<CloudflareAccount[]>(
      accessToken,
      `accounts?per_page=50&page=${page}`,
    );
    const batch = result.result ?? [];
    accounts.push(...batch);
    const totalPages = result.result_info?.total_pages;
    if (totalPages ? page >= totalPages : batch.length < 50) return accounts;
  }
  throw new CloudflareRequestError("Too many Cloudflare accounts to list safely", 502);
}

function assertAccountId(accountId: string): string {
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error("Invalid Cloudflare account identifier");
  return accountId;
}

function assertPagesProjectName(projectName: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(projectName)) {
    throw new Error("Invalid Cloudflare Pages project name");
  }
  return projectName;
}

function endpoint(accountId: string, projectName: string, suffix = ""): string {
  return `accounts/${assertAccountId(accountId)}/pages/projects/${encodeURIComponent(assertPagesProjectName(projectName))}${suffix}`;
}

async function pagesApi<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  headers.set("accept", "application/json");
  if (typeof init.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${API_ROOT}/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  const envelope = await response.json().catch(() => ({})) as CloudflareApiEnvelope<T>;
  if (!response.ok || envelope.success !== true) {
    throw new CloudflareRequestError(
      "Cloudflare Pages could not complete the request",
      response.status || 502,
      undefined,
      response.status,
    );
  }
  return envelope.result;
}

export async function createPagesProject(
  accessToken: string,
  input: {
    accountId: string;
    projectName: string;
    owner: string;
    ownerId: string;
    repositoryName: string;
    repositoryId: string;
    productionBranch: string;
    rootDirectory: string;
    installCommand?: string | null;
    buildCommand?: string | null;
    outputDirectory?: string | null;
    previewsEnabled: boolean;
  },
): Promise<PagesProject> {
  const buildConfig: Record<string, unknown> = { root_dir: input.rootDirectory };
  const buildSteps = [input.installCommand, input.buildCommand].filter(
    (command): command is string => Boolean(command?.trim()),
  );
  if (buildSteps.length) buildConfig.build_command = buildSteps.join(" && ");
  if (input.outputDirectory) buildConfig.destination_dir = input.outputDirectory;
  const body = {
    name: input.projectName,
    production_branch: input.productionBranch,
    build_config: buildConfig,
    source: {
      type: "github",
      config: {
        owner: input.owner,
        owner_id: input.ownerId,
        repo_name: input.repositoryName,
        repo_id: input.repositoryId,
        production_branch: input.productionBranch,
        // AfuCloud's signed webhook drives the persistent queue. This prevents
        // duplicate provider builds and keeps every triggered deployment tracked.
        production_deployments_enabled: false,
        preview_deployment_setting: "none",
        pr_comments_enabled: false,
      },
    },
  };
  return pagesApi<PagesProject>(
    accessToken,
    `accounts/${assertAccountId(input.accountId)}/pages/projects`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function updatePagesProject(
  accessToken: string,
  accountId: string,
  projectName: string,
  patch: Record<string, unknown>,
): Promise<PagesProject> {
  return pagesApi<PagesProject>(
    accessToken,
    endpoint(accountId, projectName),
    { method: "PATCH", body: JSON.stringify(patch) },
  );
}

export async function deletePagesProject(
  accessToken: string,
  accountId: string,
  projectName: string,
): Promise<void> {
  await pagesApi<unknown>(accessToken, endpoint(accountId, projectName), { method: "DELETE" });
}

export async function createPagesDeployment(
  accessToken: string,
  accountId: string,
  projectName: string,
  input: {
    branch: string;
    commitSha?: string;
    commitMessage?: string | null;
  },
): Promise<PagesDeployment> {
  const form = new FormData();
  form.set("branch", input.branch);
  if (input.commitSha) form.set("commit_hash", input.commitSha);
  if (input.commitMessage) form.set("commit_message", input.commitMessage.slice(0, 4000));

  return pagesApi<PagesDeployment>(
    accessToken,
    endpoint(accountId, projectName, "/deployments"),
    { method: "POST", body: form },
  );
}

export async function listPagesDeployments(
  accessToken: string,
  accountId: string,
  projectName: string,
  environment?: "production" | "preview",
): Promise<PagesDeployment[]> {
  const params = new URLSearchParams({ page: "1", per_page: "100" });
  if (environment) params.set("env", environment);
  return pagesApi<PagesDeployment[]>(
    accessToken,
    `${endpoint(accountId, projectName, "/deployments")}?${params.toString()}`,
  );
}

export async function getPagesDeployment(
  accessToken: string,
  accountId: string,
  projectName: string,
  deploymentId: string,
): Promise<PagesDeployment> {
  return pagesApi<PagesDeployment>(
    accessToken,
    endpoint(accountId, projectName, `/deployments/${encodeURIComponent(deploymentId)}`),
  );
}

export async function rollbackPagesDeployment(
  accessToken: string,
  accountId: string,
  projectName: string,
  deploymentId: string,
): Promise<PagesDeployment> {
  return pagesApi<PagesDeployment>(
    accessToken,
    endpoint(accountId, projectName, `/deployments/${encodeURIComponent(deploymentId)}/rollback`),
    { method: "POST" },
  );
}

export async function listPagesDomains(
  accessToken: string,
  accountId: string,
  projectName: string,
): Promise<PagesDomain[]> {
  return pagesApi<PagesDomain[]>(
    accessToken,
    endpoint(accountId, projectName, "/domains"),
  );
}

export async function addPagesDomain(
  accessToken: string,
  accountId: string,
  projectName: string,
  hostname: string,
): Promise<PagesDomain> {
  return pagesApi<PagesDomain>(
    accessToken,
    endpoint(accountId, projectName, "/domains"),
    { method: "POST", body: JSON.stringify({ name: hostname }) },
  );
}

export async function deletePagesDomain(
  accessToken: string,
  accountId: string,
  projectName: string,
  hostname: string,
): Promise<void> {
  await pagesApi<unknown>(
    accessToken,
    endpoint(accountId, projectName, `/domains/${encodeURIComponent(hostname)}`),
    { method: "DELETE" },
  );
}

export async function getPagesDeploymentLogs(
  accessToken: string,
  accountId: string,
  projectName: string,
  deploymentId: string,
): Promise<PagesLog[]> {
  const result = await pagesApi<PagesLog[]>(
    accessToken,
    endpoint(accountId, projectName, `/deployments/${encodeURIComponent(deploymentId)}/history/logs`),
  );
  return Array.isArray(result) ? result : [];
}

export function normalizedPagesStatus(deployment: PagesDeployment): "ready" | "failed" | "deploying" {
  const value = (deployment.latest_stage?.status ?? "").toLowerCase();
  if (["success", "successfully_deployed", "complete", "completed"].includes(value)) return "ready";
  if (["failure", "failed", "canceled", "cancelled"].includes(value)) return "failed";
  return "deploying";
}
