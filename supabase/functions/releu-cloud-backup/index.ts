import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const defaultBucket = Deno.env.get("RELEU_BACKUP_BUCKET") ?? "releu-backups";
const defaultMaxUploadBytes = Number(Deno.env.get("RELEU_MAX_UPLOAD_BYTES") ?? 50 * 1024 * 1024) || 50 * 1024 * 1024;

const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function sanitizeSegment(value: string, fallback: string) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function encodeBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function generateRestoreKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `releu_${encodeBase64Url(bytes)}`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((entry) => entry.toString(16).padStart(2, "0")).join("");
}

async function findAccountByRestoreKey(restoreKey: string) {
  const keyHash = await sha256(restoreKey);
  const { data, error } = await serviceClient
    .from("releu_cloud_accounts")
    .select("*")
    .eq("restore_key_hash", keyHash)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

async function issueKey(deviceLabel?: string) {
  const restoreKey = generateRestoreKey();
  const restoreKeyHash = await sha256(restoreKey);
  const { data, error } = await serviceClient
    .from("releu_cloud_accounts")
    .insert({
      restore_key_hash: restoreKeyHash,
      device_label: deviceLabel ?? null,
      last_seen_at: new Date().toISOString(),
    })
    .select("id, created_at, device_label")
    .single();
  if (error) {
    throw error;
  }
  return { restoreKey, account: data };
}

async function rotateKey(currentRestoreKey: string) {
  const account = await findAccountByRestoreKey(currentRestoreKey);
  if (!account) {
    return null;
  }
  const restoreKey = generateRestoreKey();
  const restoreKeyHash = await sha256(restoreKey);
  const { error } = await serviceClient
    .from("releu_cloud_accounts")
    .update({
      restore_key_hash: restoreKeyHash,
      rotated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", account.id);
  if (error) {
    throw error;
  }
  return { restoreKey, accountId: account.id };
}

async function listBackups(restoreKey: string) {
  const account = await findAccountByRestoreKey(restoreKey);
  if (!account) {
    return null;
  }
  await serviceClient
    .from("releu_cloud_accounts")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", account.id);
  const { data, error } = await serviceClient
    .from("releu_cloud_backups")
    .select("id, server_id, server_name, backup_name, size_bytes, status, created_at, updated_at")
    .eq("account_id", account.id)
    .neq("status", "deleted")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    throw error;
  }
  return {
    account: {
      id: account.id,
      deviceLabel: account.device_label,
      createdAt: account.created_at,
      rotatedAt: account.rotated_at,
    },
    backups: data ?? [],
  };
}

async function createUploadSession(payload: {
  restoreKey: string;
  serverId: string;
  serverName: string;
  backupName: string;
  sizeBytes: number;
  bucket?: string;
}) {
  const account = await findAccountByRestoreKey(payload.restoreKey);
  if (!account) {
    return null;
  }
  const sizeBytes = Math.max(0, Number(payload.sizeBytes ?? 0) || 0);
  if (sizeBytes <= 0) {
    throw new Error("Backup size must be greater than zero.");
  }
  if (sizeBytes > defaultMaxUploadBytes) {
    throw new Error(`Backup exceeds the current upload limit of ${defaultMaxUploadBytes} bytes.`);
  }
  const bucket = sanitizeSegment(payload.bucket ?? defaultBucket, defaultBucket);
  const serverSegment = sanitizeSegment(payload.serverId, "server");
  const fileSegment = sanitizeSegment(payload.backupName, "backup") + ".zip";
  const objectPath = `${account.id}/${serverSegment}/${Date.now()}-${fileSegment}`;
  const { data: createdBackup, error: createError } = await serviceClient
    .from("releu_cloud_backups")
    .insert({
      account_id: account.id,
      server_id: payload.serverId,
      server_name: payload.serverName,
      backup_name: payload.backupName,
      object_path: objectPath,
      size_bytes: sizeBytes,
      status: "pending",
    })
    .select("id, object_path, created_at")
    .single();
  if (createError) {
    throw createError;
  }
  const { data: signed, error: signedError } = await serviceClient
    .storage
    .from(bucket)
    .createSignedUploadUrl(objectPath);
  if (signedError) {
    throw signedError;
  }
  return {
    backupId: createdBackup.id,
    objectPath,
    bucket,
    token: signed.token,
    signedUrl: signed.signedUrl ?? null,
    uploadLimitBytes: defaultMaxUploadBytes,
  };
}

async function markUploadReady(restoreKey: string, backupId: string) {
  const account = await findAccountByRestoreKey(restoreKey);
  if (!account) {
    return null;
  }
  const { data, error } = await serviceClient
    .from("releu_cloud_backups")
    .update({
      status: "ready",
      updated_at: new Date().toISOString(),
    })
    .eq("id", backupId)
    .eq("account_id", account.id)
    .select("id, server_id, server_name, backup_name, size_bytes, created_at, updated_at")
    .single();
  if (error) {
    throw error;
  }
  return data;
}

async function createDownloadUrl(restoreKey: string, backupId: string) {
  const account = await findAccountByRestoreKey(restoreKey);
  if (!account) {
    return null;
  }
  const { data: backup, error } = await serviceClient
    .from("releu_cloud_backups")
    .select("id, object_path, server_name, backup_name, size_bytes, status")
    .eq("id", backupId)
    .eq("account_id", account.id)
    .eq("status", "ready")
    .single();
  if (error) {
    throw error;
  }
  const { data: signed, error: signedError } = await serviceClient
    .storage
    .from(defaultBucket)
    .createSignedUrl(backup.object_path, 60 * 10);
  if (signedError) {
    throw signedError;
  }
  return {
    backup,
    signedUrl: signed.signedUrl,
    expiresInSeconds: 600,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed." });
  }

  try {
    const payload = await request.json().catch(() => ({}));
    const action = String(payload?.action ?? "").trim().toLowerCase();

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return json(500, { ok: false, error: "Supabase function secrets are not configured." });
    }

    if (action === "health") {
      return json(200, {
        ok: true,
        provider: "supabase",
        bucket: defaultBucket,
        uploadLimitBytes: defaultMaxUploadBytes,
      });
    }

    if (action === "issue_key") {
      const result = await issueKey(payload?.deviceLabel);
      return json(200, { ok: true, ...result });
    }

    if (action === "rotate_key") {
      const result = await rotateKey(String(payload?.restoreKey ?? ""));
      if (!result) {
        return json(404, { ok: false, error: "Restore key not found." });
      }
      return json(200, { ok: true, ...result });
    }

    if (action === "list_backups") {
      const result = await listBackups(String(payload?.restoreKey ?? ""));
      if (!result) {
        return json(404, { ok: false, error: "Restore key not found." });
      }
      return json(200, { ok: true, ...result, uploadLimitBytes: defaultMaxUploadBytes });
    }

    if (action === "create_upload_session") {
      const result = await createUploadSession({
        restoreKey: String(payload?.restoreKey ?? ""),
        serverId: String(payload?.serverId ?? ""),
        serverName: String(payload?.serverName ?? ""),
        backupName: String(payload?.backupName ?? ""),
        sizeBytes: Number(payload?.sizeBytes ?? 0),
        bucket: payload?.bucket ? String(payload.bucket) : undefined,
      });
      if (!result) {
        return json(404, { ok: false, error: "Restore key not found." });
      }
      return json(200, { ok: true, ...result });
    }

    if (action === "mark_upload_ready") {
      const result = await markUploadReady(String(payload?.restoreKey ?? ""), String(payload?.backupId ?? ""));
      if (!result) {
        return json(404, { ok: false, error: "Restore key not found." });
      }
      return json(200, { ok: true, backup: result });
    }

    if (action === "create_download_url") {
      const result = await createDownloadUrl(String(payload?.restoreKey ?? ""), String(payload?.backupId ?? ""));
      if (!result) {
        return json(404, { ok: false, error: "Restore key not found." });
      }
      return json(200, { ok: true, ...result });
    }

    return json(400, { ok: false, error: "Unknown action." });
  } catch (error) {
    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
});
