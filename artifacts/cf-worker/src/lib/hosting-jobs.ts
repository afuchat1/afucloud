import type { DbClient, Env } from "../types";
import { hashText, randomUrlSafeToken } from "@workspace/hosting-core";
import { getCloudflareUserAccessToken } from "./cloudflare-account-token";
import {
  createPagesDeployment,
  getPagesDeployment,
  normalizedPagesStatus,
  type PagesDeployment,
} from "./cloudflare-pages";

function deploymentLog(deploymentId: string, sequence: number, stage: string, message: string) {
  return {
    deployment_id: deploymentId,
    sequence,
    level: "info",
    stage,
    message: message.slice(0, 8000),
  };
}

function providerFailure(error: unknown): { status: number; code: string; message: string; retryable: boolean } {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  if (status === 401 || status === 403) {
    return {
      status,
      code: "cloudflare_pages_permission",
      message: "Cloudflare authorization needs Pages access. Reconnect Cloudflare and approve the hosting permissions.",
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      status,
      code: "cloudflare_pages_project_missing",
      message: "The Cloudflare Pages project is missing or no longer accessible.",
      retryable: false,
    };
  }
  if (status === 429 || status >= 500) {
    return {
      status,
      code: "cloudflare_pages_temporary_error",
      message: "Cloudflare Pages is temporarily unavailable. AfuCloud will retry this deployment.",
      retryable: true,
    };
  }
  return {
    status,
    code: "cloudflare_pages_rejected",
    message: "Cloudflare Pages rejected this deployment. Check the repository and build settings, then retry.",
    retryable: false,
  };
}

function providerDeploymentId(deployment: PagesDeployment): string | null {
  return deployment.id ?? deployment.deployment_uuid ?? null;
}

export async function processHostingDeploymentById(
  env: Env,
  db: DbClient,
  deploymentId: string,
): Promise<void> {
  const leaseTokenHash = await hashText(randomUrlSafeToken());
  const deployment = await db.claimHostingDeploymentById(deploymentId, leaseTokenHash);
  if (!deployment) return;

  const finish = async (data: Record<string, unknown>) => {
    await db.updateHostingDeploymentByLease(deployment.id, leaseTokenHash, {
      ...data,
      locked_at: null,
      lease_token_hash: null,
      updated_at: new Date().toISOString(),
    });
  };

  const project = await db.getHostingProject(deployment.project_id, deployment.user_id);
  if (!project) {
    await finish({
      status: "failed",
      error_code: "hosting_project_missing",
      error_message: "The hosting project was removed before this deployment started.",
      completed_at: new Date().toISOString(),
    });
    return;
  }
  if (project.provider !== "cloudflare_pages" || project.runtime !== "static") {
    await finish({
      status: "failed",
      error_code: "runtime_not_available",
      error_message: "This runtime is not available yet. No customer build command was run.",
      completed_at: new Date().toISOString(),
    });
    return;
  }
  const installation = await db.getGithubInstallation(project.github_installation_id, project.user_id);
  if (!installation) {
    await finish({
      status: "failed",
      error_code: "github_installation_unavailable",
      error_message: "The GitHub App is no longer connected. Reconnect GitHub before deploying again.",
      completed_at: new Date().toISOString(),
    });
    return;
  }
  if (!project.provider_account_id || !project.provider_project_name) {
    await finish({
      status: "failed",
      error_code: "provider_not_configured",
      error_message: "Cloudflare Pages is not fully configured for this project.",
      completed_at: new Date().toISOString(),
    });
    return;
  }

  try {
    const accessToken = await getCloudflareUserAccessToken(db, deployment.user_id, env);
    const providerDeployment = await createPagesDeployment(
      accessToken,
      project.provider_account_id,
      project.provider_project_name,
      {
        branch: deployment.branch,
        commitSha: deployment.commit_sha,
        commitMessage: deployment.commit_message,
      },
    );
    const upstreamId = providerDeploymentId(providerDeployment);
    if (!upstreamId) throw new Error("Cloudflare Pages did not return a deployment identifier");

    const status = normalizedPagesStatus(providerDeployment);
    const finished = status === "ready" || status === "failed";
    await finish({
      status,
      provider_deployment_id: upstreamId,
      deployment_url: providerDeployment.url ?? null,
      preview_url: deployment.environment === "preview" ? providerDeployment.url ?? null : null,
      error_code: status === "failed" ? "provider_build_failed" : null,
      error_message: status === "failed"
        ? "Cloudflare Pages reported that the build failed. Open the provider build logs for details."
        : null,
      completed_at: finished ? new Date().toISOString() : null,
    });
    await db.insertHostingDeploymentLogs([
      deploymentLog(
        deployment.id,
        0,
        "provider",
        `Cloudflare Pages accepted the ${deployment.environment} deployment.`,
      ),
    ]).catch(() => {});
  } catch (error) {
    const failure = providerFailure(error);
    const willRetry = failure.retryable && deployment.attempts < deployment.max_attempts;
    const retryDelayMs = Math.min(5 * 60_000, 15_000 * 2 ** Math.max(0, deployment.attempts - 1));
    await finish({
      status: willRetry ? "queued" : "failed",
      available_at: willRetry ? new Date(Date.now() + retryDelayMs).toISOString() : deployment.available_at,
      error_code: failure.code,
      error_message: failure.message,
      completed_at: willRetry ? null : new Date().toISOString(),
    });
    if (!willRetry) {
      await db.insertHostingDeploymentLogs([
        {
          ...deploymentLog(deployment.id, 0, "provider", failure.message),
          level: "error",
        },
      ]).catch(() => {});
    }
  }
}

async function synchronizeProviderDeployment(env: Env, db: DbClient, deployment: any): Promise<void> {
  if (deployment.status !== "deploying" || !deployment.provider_deployment_id) return;
  const project = await db.getHostingProject(deployment.project_id, deployment.user_id);
  if (
    !project ||
    project.provider !== "cloudflare_pages" ||
    !project.provider_account_id ||
    !project.provider_project_name
  ) return;

  try {
    const accessToken = await getCloudflareUserAccessToken(db, deployment.user_id, env);
    const providerDeployment = await getPagesDeployment(
      accessToken,
      project.provider_account_id,
      project.provider_project_name,
      deployment.provider_deployment_id,
    );
    const status = normalizedPagesStatus(providerDeployment);
    if (status === "deploying") return;
    await db.updateHostingDeployment(deployment.id, deployment.user_id, {
      status,
      deployment_url: providerDeployment.url ?? deployment.deployment_url,
      preview_url: deployment.environment === "preview"
        ? providerDeployment.url ?? deployment.preview_url
        : deployment.preview_url,
      error_code: status === "failed" ? "provider_build_failed" : null,
      error_message: status === "failed"
        ? "Cloudflare Pages reported that the build failed. Open the provider build logs for details."
        : null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      locked_at: null,
      lease_token_hash: null,
    });
  } catch {
    // Provider polling is best-effort; the next scheduled pass will retry.
  }
}

export async function runScheduledHostingJobs(env: Env, db: DbClient): Promise<void> {
  await db.recoverStaleHostingDeployments().catch(() => 0);

  const active = await db.getActiveHostingDeployments(100).catch(() => []);
  const queued = active
    .filter(item => item.status === "queued" && Date.parse(item.available_at) <= Date.now())
    .slice(0, 3);
  const deploying = active.filter(item => item.status === "deploying").slice(0, 8);
  await Promise.all([
    ...queued.map(item => processHostingDeploymentById(env, db, item.id)),
    ...deploying.map(item => synchronizeProviderDeployment(env, db, item)),
  ]);
}
