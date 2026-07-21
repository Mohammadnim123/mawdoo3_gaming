# Production Deployment — Google Cloud Platform

How the Mawdoo3 gaming platform is deployed to GCP, the decisions behind it, and
the exact commands to provision, deploy, and operate it. Everything here is
automated in [`deploy/`](../deploy) and [`.github/workflows/`](../.github/workflows).

Target: **project `qalam-plus-app`, region `europe-west1`** (override via env — see
[`deploy/config.sh`](../deploy/config.sh)).

---

## 1. Architecture

```
                         ┌──────────────────────────── Google Cloud (qalam-plus-app / europe-west1) ────────────┐
   Browser               │                                                                                       │
   (HTTPS)               │   Cloud Run: web-client            Cloud Run: generation-service                     │
     │   ┌───────────────┼──▶ Django + gunicorn  ──X-Service-Token──▶  FastAPI + Anthropic SDK pipeline          │
     │   │  page + islands│   (WhiteNoise static)                      (single always-on instance, bg jobs)      │
     ├───┘                │        │                                          │        │                          │
     │                    │        └── Cloud SQL (Postgres) ──┬─────── DB ────┘        │ writes bundles           │
     │                    │            instance: 2 databases  │                        ▼                          │
     │  <iframe sandbox>  │              web_client · generation_service     Cloud Storage bucket (game bundles)  │
     └────────────────────┼───────────────────────────────────────────────▶  ▲                                   │
        games (untrusted) │   Cloud CDN  ◀── external HTTPS LB ◀── backend bucket ┘  (public, unguessable keys)   │
        via https://<ip>.sslip.io                                                                                  │
                          └───────────────────────────────────────────────────────────────────────────────────┘

   Artifact Registry (images)      GitHub Actions (WIF, keyless) → Cloud Build → Cloud Run rollout
```

**Services**
- **web-client** (Cloud Run, public) — Django UI + the one prompt-validation LLM
  call. Serves its own static (Django admin + built React islands) via WhiteNoise.
  Owns the user/billing/social database. Renders games in a cross-origin sandboxed
  iframe pointed at the games origin.
- **generation-service** (Cloud Run, public + service-token) — the FastAPI
  generation engine. Writes game bundles to Cloud Storage; metadata to its own
  Postgres database.
- **games origin** — a **Cloud Storage bucket fronted by Cloud CDN** (external
  HTTPS load balancer + backend bucket). Not a Cloud Run service. This is the
  separate, untrusted origin generated games are served from.

---

## 2. Key decisions (and why)

| Decision | Rationale |
|---|---|
| **New GCS storage adapter** ([`storage/gcs.py`](../services/generation-service/src/generation_service/infrastructure/storage/gcs.py)), `STORAGE_BACKEND=gcs` | Cloud Run is stateless with per-instance ephemeral disk. The original code only had a `local` disk backend and hard-failed on anything else. Bundles must live in shared object storage to persist and to be reachable by the CDN. The `StoragePort` seam made this a clean, additive adapter. |
| **Games served by Cloud CDN + backend bucket** (not a Cloud Run service) | Matches "static assets on Cloud Storage, served through Cloud CDN." Keeps the untrusted-code isolation (a distinct origin) while offloading serving to the CDN. Hardened response headers (CSP, `nosniff`, CORS) are set on the backend bucket to mirror the old `games-cdn` server. |
| **HTTPS via `sslip.io` managed cert on the LB IP** | The web app is HTTPS, so the iframe origin must be HTTPS too (browsers block mixed content). Google-managed certs need a domain; `sslip.io` encodes the IP as a hostname (`34-1-2-3.sslip.io`) with zero domain purchase or DNS management — the requested "IP-based, no domain" intent, but embeddable. |
| **generation-service = single always-on instance** (`min=max=1`, `--no-cpu-throttling`) | Generation jobs run **in-process** as background asyncio tasks (up to 30 min) with an in-process SSE bus. Multiple instances/workers would each spawn a runner; scale-to-zero would kill in-flight jobs. One always-on instance with un-throttled CPU keeps background work alive. A Redis/Cloud Tasks broker (the code's `REDIS_URL` seam) is the path to horizontal scaling — see §7. |
| **Single uvicorn worker** in the image | Same reason — the job runner + event bus assume one process. |
| **Node.js baked into the generation-service image** | The quality gate runs `node --check` and a headless smoke-boot; without Node it silently skips and broken games could ship. |
| **WhiteNoise `CompressedStaticFilesStorage`** (not manifest) | The Vite islands import their own chunks by literal filename; a manifest storage would hash-rename them and break those JS imports. Compressed (no-rename) storage is safe. |
| **`SECURE_PROXY_SSL_HEADER` + `USE_X_FORWARDED_HOST`** | Cloud Run terminates TLS and forwards `X-Forwarded-Proto`; without this Django mis-detects HTTP and secure cookies / CSRF origin checks break. |
| **Cloud SQL via unix socket** (`/cloudsql/…`, `--add-cloudsql-instances`) | Google's recommended Cloud Run ↔ Cloud SQL path; no VPC connector needed. asyncpg uses `?host=/cloudsql/…`; Django uses `HOST=/cloudsql/…`. |
| **Service-token auth** between web-client and generation-service | Already built into the engine (`X-Service-Token`); keeps the tiers decoupled without adding an identity-token code path for the stage. |
| **CI deploys are image-only** | Env/secrets/scaling are set once by `deploy.sh` and preserved by `gcloud run deploy --image …`. CI never handles secrets — it just rolls out new images. |
| **Secrets as Cloud Run env vars** | Per the stage requirement. Generated secrets (DB passwords, service token, Django key) live in `deploy/.secrets/` (gitignored); app keys are reused from the dev `.env`. Migrate to Secret Manager for real prod (§7). |

---

## 3. Prerequisites (once, on the operator machine)

```bash
gcloud auth login                       # interactive — required
gcloud auth application-default login   # interactive — required
# tools: gcloud, openssl, git, psql (for the one-time SQL grants)
```

---

## 4. First deployment (once)

```bash
./deploy/provision.sh     # APIs, Artifact Registry, SAs+IAM, Cloud SQL (2 DBs),
                          #   GCS bucket, Cloud CDN LB + sslip.io managed cert
./deploy/build.sh         # build + push both images via Cloud Build
./deploy/deploy.sh        # deploy both Cloud Run services + run DB migrations
```

`deploy.sh` prints the three URLs (web client, generation service, games origin).
The managed TLS cert for the games origin provisions asynchronously (10–60 min):

```bash
gcloud compute ssl-certificates describe mawdoo3-games-cert --global \
  --format='value(managed.status)'   # want: ACTIVE
```

### CI/CD (once)

```bash
./deploy/setup_wif.sh     # keyless GitHub Actions auth (Workload Identity Federation)
```

Then add the printed values as **GitHub Actions repository variables**
(Settings → Secrets and variables → Actions → Variables):
`GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`.

After that, every push to `main` runs [CI](../.github/workflows/ci.yml) (lint +
both test suites) and [Deploy](../.github/workflows/deploy.yml) (build → migrate →
image-only rollout). No manual steps.

---

## 5. Operations

- **Logs**: Cloud Logging (`LOG_FORMAT=json` on the engine). `gcloud run services logs read <svc> --region europe-west1`.
- **Health**: engine `GET /health`; web `GET /health` (dependency-free; **not** `/healthz` — Google Front End reserves that path on `*.run.app`); web `GET /status` (deep — checks the engine).
- **Autoscaling**: web-client `min=1 max=4`; generation-service pinned to `1` (see §2).
- **Backups**: Cloud SQL automated daily backups at 03:00 UTC (`--backup`). Enable PITR/HA for prod.
- **Scaling knobs / sizing**: all in [`deploy/config.sh`](../deploy/config.sh) — override via env and re-run `deploy.sh`.
- **Monitoring (recommended add-on)**: uptime checks on the web `/healthz` and engine `/health` + an alert policy; Cloud Run request/latency/error dashboards exist by default.

### Stripe (after first deploy)
Create a webhook in the Stripe dashboard pointing at
`<WEB_URL>/api/v1/billing/stripe/webhook`, copy its signing secret, then:
```bash
gcloud run services update web-client --region europe-west1 \
  --update-env-vars "STRIPE_WEBHOOK_SECRET=whsec_..."
```

---

## 6. Redeploy / rollback / teardown

```bash
# Redeploy a specific service manually (image-only, env preserved):
gcloud run deploy web-client --image <AR>/web-client:<tag> --region europe-west1

# Roll back to a previous revision (instant, no rebuild):
gcloud run services update-traffic web-client --to-revisions <REVISION>=100 --region europe-west1

# Change env/scaling: edit deploy/config.sh (or the dev .env) then: ./deploy/deploy.sh
```

Teardown is the inverse of `provision.sh` (delete Cloud Run services + job, the LB
chain — forwarding-rule → https-proxy → cert → url-map → backend-bucket → address,
the SQL instance, the bucket, and the Artifact Registry repo).

---

## 7. Known limitations / follow-ups (not blocking the stage)

1. **generation-service does not scale horizontally** — in-process jobs pin it to
   one instance. For real load, move jobs to a broker (Redis/Cloud Tasks — the
   `REDIS_URL` seam exists) and drop the pinning.
2. **Public games bucket** — Cloud CDN backend buckets require publicly readable
   objects (games are already "public behind unguessable URLs"). If org policy
   enforces `publicAccessPrevention`, `provision.sh` warns; the fallback is a
   private bucket + a Cloud Run games-cdn proxy (SA-authenticated reads) behind a
   serverless NEG. 
3. **User-uploaded media (avatars)** use Django's local filesystem — ephemeral on
   Cloud Run. Wire `django-storages` → GCS for persistence.
4. **Secrets are Cloud Run env vars** (per the stage brief). Move to Secret Manager
   (`--set-secrets`) for production.
5. **`sslip.io` for the games origin** is a stage convenience. For production, map a
   real domain to the LB IP and issue a managed cert for it (then set `CDN_BASE_URL`
   / `GAMES_CDN_BASE_URL` to it and redeploy).
6. **HSTS / Django SSL-redirect** are left to the Cloud Run edge (which is HTTPS-only
   and auto-redirects). Enable `SECURE_HSTS_SECONDS` once on a stable domain.
