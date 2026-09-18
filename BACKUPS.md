# Automatic Crewroom backups

This implementation prepares a consistent database-and-photo backup once a day from the running Render service and stores it in a **private Cloudflare R2 Standard bucket**. Configuration, a deployed successful run, and a remote restore drill are required before calling backups operational. Preparing this code does not enable a cloud account or upload live data.

## Storage and access

Create a dedicated bucket named `crewroom-backups` in your Cloudflare account. Keep public access, custom domains, and `r2.dev` access disabled. Use Standard storage. There is no need to transfer `joincrewroom.com` or change its nameservers.

Set an object lifecycle rule for prefix `crewroom-beta/v1/` that deletes objects after **7 days**. The application also removes expired objects under its own backup prefix. The bucket rule continues to apply if the Render application stops. Do not enable object locks that prevent expiry. Confirm the rule after saving it.

Create an R2 credential with **Object Read & Write** access to this bucket only. Store its access key ID and secret key only in Render. Do not place them in source control, Expo, a public client variable, or chat. R2 encrypts stored data at rest and the uploader uses HTTPS; this is provider-managed encryption, not a separate user-held encryption key.

R2 includes 10 GB-month of Standard storage and request allowances free, with usage charges above those allowances. Seven daily full copies can consume roughly seven times the current database-and-photo size. Monitor storage and account billing as the beta grows. [Pricing](https://developers.cloudflare.com/r2/pricing/) · [Encryption](https://developers.cloudflare.com/r2/reference/data-security/).

## Render configuration

Add these server environment variables together, then deploy the updated code:

| Variable | Value |
|---|---|
| `BACKUP_ENABLED` | `true` |
| `BACKUP_S3_ENDPOINT` | The account-specific HTTPS S3 endpoint shown by R2 |
| `BACKUP_S3_BUCKET` | `crewroom-backups` |
| `BACKUP_S3_ACCESS_KEY_ID` | Bucket-scoped credential ID |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Bucket-scoped credential secret |
| `BACKUP_PREFIX` | `crewroom-beta/v1` |
| `BACKUP_RETENTION_DAYS` | `7` |
| `BACKUP_MAX_BYTES` | `1073741824` (1 GiB initial safety limit per snapshot) |

Keep the existing `DATA_DIR=/var/data` and run one instance. The scheduler runs on the container with the mounted disk; a separate Render cron job cannot access it. It checks once per minute, takes a backup when no successful backup exists or the previous success is at least 24 hours old, and retries failures after 15 minutes. A restart resumes from the status file rather than resetting the daily schedule. A missing or corrupt status file causes a new backup.

The job runs in a child process so snapshot work does not block the API's event loop. It uses a fresh temporary staging directory outside the persistent data disk, applies a snapshot size/free-space guard, verifies object content, and writes the completion manifest last. Temporary local copies are removed after the worker exits, including failure and timeout. No HTTP endpoint exposes backups or triggers a backup.

## Verify the first backup

After deploying, wait for `Crewroom offsite backup completed.` in Render's application logs. From Render's Shell, inspect only the operational status summary:

```sh
cat /var/data/backup-status.json
```

`state` must be `healthy`, with a recent `lastSuccessAt`, a `runId`, and the expected photo count. In R2, the matching backup directory must contain a `manifest.json`. An incomplete directory without that completion manifest is not a usable backup.

Then run the isolated restore drill from `/app` in Render's Shell:

```sh
node scripts/backup-worker.mjs --verify-latest
```

This downloads a completed remote backup, checks integrity and all referenced photos, restores into a new temporary directory, and removes the temporary copies. It **does not replace the live database** or stop the live app. Save the result and date in the launch record. A successful upload alone is not a tested restore.

An on-demand backup is available with `node scripts/backup-worker.mjs`. Manual invocation does not change the scheduler's daily success state; normally let the scheduler perform the first run.

## Monitoring and retention

Failed jobs emit `CREWROOM_BACKUP_FAILED` and record `state: failed` without raw provider errors or secrets. A saved success timestamp is retained across later failures so operators can judge how old the last good backup is. Inspect status after each deployment and at least daily during the beta; investigate a failed job or a success older than 26 hours. This code does not create an external paging/alert account or a monitoring subscription.

The initial 1 GiB snapshot guard prevents uncontrolled backup staging growth. Increase it deliberately as storage and available space grow. A configured limit that is too small fails visibly; it does not silently omit photos.

Application retention and the independent R2 lifecycle rule both matter. Verify expired objects disappear, including incomplete failed runs. R2 documents that lifecycle deletion usually occurs within 24 hours after expiry but can take longer; seven days leaves margin beneath the published 30-day beta policy. [R2 lifecycle behavior](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

Render also retains encrypted automatic disk snapshots. Its documentation says they remain available **at least seven days**, not a maximum of seven. Confirm the applicable maximum with Render before asserting that every provider-controlled snapshot meets the beta policy's 30-day maximum. Do not use a raw disk snapshot as the database restore procedure. [Render persistent disks](https://render.com/docs/disks).

## A real recovery

Use a completed application backup, stop production writes, restore into a new empty data directory using the existing `scripts/restore.mjs` procedure in `DEPLOY.md`, verify the result, reconcile account deletions since the backup, and only then reopen access. Never overwrite the active database with an old snapshot. Retain a restricted deletion-reconciliation record under the published policy so a disaster restore does not reactivate deleted accounts.

The remote drill validates recoverability without switching production. It is not permission to roll back user data. No provider bucket, credential, lifecycle rule, successful live backup, or restore drill should be marked complete until its actual result has been observed.
