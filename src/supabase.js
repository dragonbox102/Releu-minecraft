import { createClient } from "@supabase/supabase-js";

import { defaultConfig } from "./config.js";

function normalizeCloudBackupConfig(config = {}) {
  const merged = {
    ...defaultConfig.cloudBackup,
    ...(config ?? {}),
  };
  const rawProvider =
    String(merged.provider ?? defaultConfig.cloudBackup.provider).trim().toLowerCase() ||
    defaultConfig.cloudBackup.provider;
  const tailscaleHost = String(merged.tailscaleHost ?? "").trim();
  const tailscaleUser = String(merged.tailscaleUser ?? "").trim();
  const tailscaleRemoteDir = String(merged.tailscaleRemoteDir ?? "").trim();
  const hasTailscaleConfig = Boolean(tailscaleHost && tailscaleUser && tailscaleRemoteDir);
  return {
    enabled: Boolean(merged.enabled),
    provider:
      rawProvider === "tailscale-ssh" || (rawProvider === "supabase" && hasTailscaleConfig)
        ? "tailscale-ssh"
        : rawProvider,
    functionName: String(merged.functionName ?? "releu-cloud-backup").trim() || "releu-cloud-backup",
    bucket: String(merged.bucket ?? "releu-backups").trim() || "releu-backups",
    uploadLimitMb: Math.max(1, Number(merged.uploadLimitMb ?? 50) || 50),
    projectUrl: String(merged.projectUrl ?? "").trim(),
    publishableKey: String(merged.publishableKey ?? "").trim(),
    serviceKey: String(merged.serviceKey ?? "").trim(),
    restoreKey: String(merged.restoreKey ?? "").trim(),
    targetRestoreKey: String(merged.targetRestoreKey ?? "").trim(),
    deviceLabel: String(merged.deviceLabel ?? "").trim(),
    accountUsername: String(merged.accountUsername ?? "").trim().toLowerCase(),
    sessionToken: String(merged.sessionToken ?? "").trim(),
    tailscaleHost,
    tailscaleUser,
    tailscaleRemoteDir,
  };
}

let cachedPublicCacheKey = "";
let cachedPublicClient = null;
let cachedServiceCacheKey = "";
let cachedServiceClient = null;

export function getCloudBackupConfig(config = null) {
  return normalizeCloudBackupConfig(config?.cloudBackup ?? config ?? {});
}

export function getPublicCloudBackupConfig(config = null) {
  const cloud = getCloudBackupConfig(config);
  return {
    enabled: cloud.enabled,
    provider: cloud.provider,
    functionName: cloud.functionName,
    bucket: cloud.bucket,
    uploadLimitMb: cloud.uploadLimitMb,
    projectUrl: cloud.projectUrl,
    publishableKey: cloud.publishableKey,
    restoreKey: cloud.restoreKey,
    targetRestoreKey: cloud.targetRestoreKey,
    deviceLabel: cloud.deviceLabel,
    accountUsername: cloud.accountUsername,
    functionUrl: getSupabaseFunctionUrl(cloud),
  };
}

export function getSupabaseFunctionUrl(config = null) {
  const cloud = getCloudBackupConfig(config);
  if (!cloud.projectUrl || !cloud.functionName) {
    return "";
  }
  const root = cloud.projectUrl.replace(/\/+$/g, "");
  return `${root}/functions/v1/${encodeURIComponent(cloud.functionName)}`;
}

export function createSupabasePublicClient(config = null) {
  const cloud = getCloudBackupConfig(config);
  if (!cloud.projectUrl || !cloud.publishableKey) {
    throw new Error("Supabase public config is incomplete.");
  }
  const cacheKey = `${cloud.projectUrl}::${cloud.publishableKey}`;
  if (cachedPublicClient && cachedPublicCacheKey === cacheKey) {
    return cachedPublicClient;
  }
  cachedPublicCacheKey = cacheKey;
  cachedPublicClient = createClient(cloud.projectUrl, cloud.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedPublicClient;
}

export function createSupabaseServiceClient(config = null) {
  const cloud = getCloudBackupConfig(config);
  if (!cloud.projectUrl || !cloud.serviceKey) {
    throw new Error("Supabase service config is incomplete.");
  }
  const cacheKey = `${cloud.projectUrl}::${cloud.serviceKey}`;
  if (cachedServiceClient && cachedServiceCacheKey === cacheKey) {
    return cachedServiceClient;
  }
  cachedServiceCacheKey = cacheKey;
  cachedServiceClient = createClient(cloud.projectUrl, cloud.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedServiceClient;
}

function normalizeEdgeFunctionError(status, message) {
  const normalized = String(message ?? "").trim();
  if (status === 401) {
    if (
      /UNAUTHORIZED_NO_AUTH_HEADER/i.test(normalized) ||
      /missing authorization header/i.test(normalized)
    ) {
      return "Supabase rejected the cloud backup request because the Edge Function still requires JWT verification. Open Supabase > Edge Functions > releu-cloud-backup and disable Verify JWT for public Releu access.";
    }
    if (/UNAUTHORIZED_INVALID_JWT_FORMAT/i.test(normalized)) {
      return "Supabase rejected the cloud backup request because the function is expecting a signed user JWT, not the public project key. Disable Verify JWT on the releu-cloud-backup function.";
    }
  }
  return normalized || `Supabase function request failed (${status}).`;
}

export async function invokeSupabaseEdgeFunction(config = null, action, payload = {}) {
  const cloud = getCloudBackupConfig(config);
  if (!cloud.projectUrl || !cloud.publishableKey || !cloud.functionName) {
    throw new Error("Supabase cloud backup config is incomplete.");
  }

  const response = await fetch(getSupabaseFunctionUrl(cloud), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      apikey: cloud.publishableKey,
    },
    body: JSON.stringify({
      action,
      ...(payload ?? {}),
    }),
  });

  const rawText = await response.text();
  let body = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = null;
  }

  if (!response.ok || body?.ok === false) {
    const message =
      body?.error ??
      body?.message ??
      rawText ??
      `Supabase function request failed (${response.status}).`;
    throw new Error(normalizeEdgeFunctionError(response.status, message));
  }

  return body ?? { ok: true };
}
