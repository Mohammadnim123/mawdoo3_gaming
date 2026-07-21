#!/usr/bin/env bash
# ============================================================================
# Deployment configuration — non-secret, safe to commit.
# Every script in deploy/ sources this. Override any value via the environment,
# e.g.  REGION=us-central1 ./deploy/provision.sh
# ============================================================================

# --- Project / location ------------------------------------------------------
export PROJECT_ID="${PROJECT_ID:-qalam-plus-app}"
export REGION="${REGION:-europe-west1}"

# --- Artifact Registry -------------------------------------------------------
export AR_REPO="${AR_REPO:-mawdoo3-gaming}"
export AR_HOST="${AR_HOST:-${REGION}-docker.pkg.dev}"
export IMAGE_BASE="${AR_HOST}/${PROJECT_ID}/${AR_REPO}"
export GEN_IMAGE="${IMAGE_BASE}/generation-service"
export WEB_IMAGE="${IMAGE_BASE}/web-client"

# --- Cloud SQL (PostgreSQL) --------------------------------------------------
export SQL_INSTANCE="${SQL_INSTANCE:-mawdoo3-gaming-pg}"
export SQL_TIER="${SQL_TIER:-db-g1-small}"          # stage-sized; bump for prod
export SQL_VERSION="${SQL_VERSION:-POSTGRES_15}"
export SQL_CONNECTION_NAME="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
export GEN_DB="${GEN_DB:-generation_service}"
export GEN_DB_USER="${GEN_DB_USER:-gen_service}"
export WEB_DB="${WEB_DB:-web_client}"
export WEB_DB_USER="${WEB_DB_USER:-webclient}"

# --- Cloud Storage (game bundles) -------------------------------------------
export GAMES_BUCKET="${GAMES_BUCKET:-${PROJECT_ID}-mawdoo3-games}"

# --- Cloud CDN / external HTTPS load balancer (games origin) ----------------
export LB_IP_NAME="${LB_IP_NAME:-mawdoo3-games-ip}"
export LB_BACKEND_BUCKET="${LB_BACKEND_BUCKET:-mawdoo3-games-backend}"
export LB_URL_MAP="${LB_URL_MAP:-mawdoo3-games-urlmap}"
export LB_CERT="${LB_CERT:-mawdoo3-games-cert}"
export LB_HTTPS_PROXY="${LB_HTTPS_PROXY:-mawdoo3-games-https-proxy}"
export LB_FWD_RULE="${LB_FWD_RULE:-mawdoo3-games-fwd-https}"

# --- Cloud Run services ------------------------------------------------------
export GEN_SERVICE="${GEN_SERVICE:-generation-service}"
export WEB_SERVICE="${WEB_SERVICE:-web-client}"
export MIGRATE_JOB="${MIGRATE_JOB:-web-migrate}"
export GEN_SA="${GEN_SA:-gen-service-sa}"
export WEB_SA="${WEB_SA:-web-client-sa}"
export GEN_SA_EMAIL="${GEN_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
export WEB_SA_EMAIL="${WEB_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

# --- Cloud Run sizing --------------------------------------------------------
# generation-service runs jobs IN-PROCESS as background tasks, so it must stay
# a single always-on instance (see docs/DEPLOYMENT.md). CPU is never throttled
# so background work keeps running after the 202 response.
export GEN_MIN_INSTANCES="${GEN_MIN_INSTANCES:-1}"
export GEN_MAX_INSTANCES="${GEN_MAX_INSTANCES:-1}"
export GEN_CPU="${GEN_CPU:-2}"
export GEN_MEMORY="${GEN_MEMORY:-2Gi}"
export GEN_CONCURRENCY="${GEN_CONCURRENCY:-8}"
export GEN_TIMEOUT="${GEN_TIMEOUT:-3600}"

export WEB_MIN_INSTANCES="${WEB_MIN_INSTANCES:-1}"
export WEB_MAX_INSTANCES="${WEB_MAX_INSTANCES:-4}"
export WEB_CPU="${WEB_CPU:-1}"
export WEB_MEMORY="${WEB_MEMORY:-1Gi}"
export WEB_CONCURRENCY="${WEB_CONCURRENCY:-40}"
export WEB_TIMEOUT="${WEB_TIMEOUT:-120}"

# --- GitHub Actions / Workload Identity Federation --------------------------
export GITHUB_REPO="${GITHUB_REPO:-Mohammadnim123/mawdoo3_gaming}"
export WIF_POOL="${WIF_POOL:-github-pool}"
export WIF_PROVIDER="${WIF_PROVIDER:-github-provider}"
export DEPLOYER_SA="${DEPLOYER_SA:-github-deployer}"
export DEPLOYER_SA_EMAIL="${DEPLOYER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

# --- Local secret/state store (generated at provision time, NEVER committed) -
export STATE_DIR="${STATE_DIR:-deploy/.secrets}"
export STATE_FILE="${STATE_FILE:-${STATE_DIR}/state.env}"

# --- Repo paths --------------------------------------------------------------
export REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export GEN_ENV_SRC="${GEN_ENV_SRC:-${REPO_ROOT}/services/generation-service/.env}"
export WEB_ENV_SRC="${WEB_ENV_SRC:-${REPO_ROOT}/apps/web-client/.env}"
