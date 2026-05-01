# Releu Supabase Cloud Backup

This folder contains the secure public cloud-backup backend for Releu.

The design is:

- Releu desktop app ships only the Supabase project URL and publishable key.
- The private storage bucket stays private.
- The Supabase `service_role` key stays inside the Supabase Edge Function environment only.
- Public app users never see the elevated key and cannot query backup tables directly.

## Files

- `migrations/20260430_releu_cloud_backup.sql`
  - creates the private bucket metadata
  - creates restore-key and backup tables
  - enables RLS and denies direct public access

- `functions/releu-cloud-backup/index.ts`
  - secure server-side entrypoint for:
    - issuing restore keys
    - rotating keys
    - listing backups
    - creating signed upload sessions
    - marking uploads ready
    - creating signed download URLs

## Deploy steps

Run the SQL migration in Supabase SQL Editor.

Then create an Edge Function named:

- `releu-cloud-backup`

Paste `functions/releu-cloud-backup/index.ts` into that function.

## Required function secrets

Supabase provides these automatically in hosted Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional custom secrets:

- `RELEU_BACKUP_BUCKET`
  - default: `releu-backups`

- `RELEU_MAX_UPLOAD_BYTES`
  - default: `52428800`

## App-side notes

The Releu app now exposes only public cloud-backup config through `/api/cloud-backup/config`.
No service key is shipped in the app config.
