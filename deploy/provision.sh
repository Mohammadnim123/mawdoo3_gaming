#!/usr/bin/env bash
# ============================================================================
# provision.sh — create/refresh all GCP infrastructure (idempotent).
#
#   APIs · Artifact Registry · service accounts + IAM · Cloud SQL (Postgres,
#   two DBs + users) · Cloud Storage games bucket · external HTTPS load
#   balancer + Cloud CDN (backend bucket) + IP + sslip.io managed cert.
#
# Safe to re-run: every step is guarded and generated secrets are stable
# (persisted under deploy/.secrets/). Run once before the first deploy:
#     ./deploy/provision.sh
# ============================================================================
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/config.sh"
source "${HERE}/lib.sh"

CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'"

enable_apis() {
  log "enabling required APIs (first run takes a minute)"
  gcloud services enable \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    sqladmin.googleapis.com \
    compute.googleapis.com \
    storage.googleapis.com \
    iamcredentials.googleapis.com \
    --project "$PROJECT_ID"
  ok "APIs enabled"
}

artifact_registry() {
  ensure "Artifact Registry repo ${AR_REPO}" \
    "gcloud artifacts repositories describe '$AR_REPO' --location='$REGION'" \
    "gcloud artifacts repositories create '$AR_REPO' --repository-format=docker --location='$REGION' --description='Mawdoo3 gaming images'"
}

service_accounts() {
  ensure "service account ${GEN_SA}" \
    "gcloud iam service-accounts describe '$GEN_SA_EMAIL'" \
    "gcloud iam service-accounts create '$GEN_SA' --display-name='generation-service runtime'"
  ensure "service account ${WEB_SA}" \
    "gcloud iam service-accounts describe '$WEB_SA_EMAIL'" \
    "gcloud iam service-accounts create '$WEB_SA' --display-name='web-client runtime'"

  log "binding IAM roles (Cloud SQL client for both runtimes)"
  for sa in "$GEN_SA_EMAIL" "$WEB_SA_EMAIL"; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:${sa}" --role="roles/cloudsql.client" \
      --condition=None >/dev/null
  done
  ok "IAM roles bound"
}

cloud_sql() {
  local root_pw gen_pw web_pw
  root_pw="$(state_get_or_create PG_ROOT_PASSWORD gen_secret)"
  gen_pw="$(state_get_or_create GEN_DB_PASSWORD gen_secret)"
  web_pw="$(state_get_or_create WEB_DB_PASSWORD gen_secret)"

  ensure "Cloud SQL instance ${SQL_INSTANCE} (this takes several minutes)" \
    "gcloud sql instances describe '$SQL_INSTANCE'" \
    "gcloud sql instances create '$SQL_INSTANCE' \
        --database-version='$SQL_VERSION' --tier='$SQL_TIER' --region='$REGION' \
        --storage-auto-increase --backup --backup-start-time=03:00 \
        --maintenance-window-day=SUN --maintenance-window-hour=4 \
        --database-flags=max_connections=100 --root-password='$root_pw'"

  # Ensure the root password matches our state even on a pre-existing instance.
  gcloud sql users set-password postgres --instance="$SQL_INSTANCE" --password="$root_pw" >/dev/null 2>&1 || true

  ensure "database ${GEN_DB}" \
    "gcloud sql databases describe '$GEN_DB' --instance='$SQL_INSTANCE'" \
    "gcloud sql databases create '$GEN_DB' --instance='$SQL_INSTANCE'"
  ensure "database ${WEB_DB}" \
    "gcloud sql databases describe '$WEB_DB' --instance='$SQL_INSTANCE'" \
    "gcloud sql databases create '$WEB_DB' --instance='$SQL_INSTANCE'"

  ensure "db user ${GEN_DB_USER}" \
    "gcloud sql users list --instance='$SQL_INSTANCE' --format='value(name)' | grep -qx '$GEN_DB_USER'" \
    "gcloud sql users create '$GEN_DB_USER' --instance='$SQL_INSTANCE' --password='$gen_pw'"
  gcloud sql users set-password "$GEN_DB_USER" --instance="$SQL_INSTANCE" --password="$gen_pw" >/dev/null 2>&1 || true
  ensure "db user ${WEB_DB_USER}" \
    "gcloud sql users list --instance='$SQL_INSTANCE' --format='value(name)' | grep -qx '$WEB_DB_USER'" \
    "gcloud sql users create '$WEB_DB_USER' --instance='$SQL_INSTANCE' --password='$web_pw'"
  gcloud sql users set-password "$WEB_DB_USER" --instance="$SQL_INSTANCE" --password="$web_pw" >/dev/null 2>&1 || true

  # Grant each app user ownership of its database so it can create its schema
  # (the generation service self-migrates on startup; Django runs migrate).
  # Uses `gcloud sql connect`, which briefly allowlists this machine's IP.
  log "granting schema ownership (allowlists your IP on the instance for ~5 min)"
  PGPASSWORD="$root_pw" gcloud sql connect "$SQL_INSTANCE" --user=postgres --database="$GEN_DB" --quiet <<SQL || warn "grant on ${GEN_DB} failed — run deploy/sql_grants.sql manually (see runbook)"
ALTER DATABASE ${GEN_DB} OWNER TO ${GEN_DB_USER};
GRANT ALL ON SCHEMA public TO ${GEN_DB_USER};
SQL
  PGPASSWORD="$root_pw" gcloud sql connect "$SQL_INSTANCE" --user=postgres --database="$WEB_DB" --quiet <<SQL || warn "grant on ${WEB_DB} failed — run deploy/sql_grants.sql manually (see runbook)"
ALTER DATABASE ${WEB_DB} OWNER TO ${WEB_DB_USER};
GRANT ALL ON SCHEMA public TO ${WEB_DB_USER};
SQL
  ok "Cloud SQL ready (instance=${SQL_CONNECTION_NAME})"
}

games_bucket() {
  ensure "games bucket gs://${GAMES_BUCKET}" \
    "gcloud storage buckets describe 'gs://$GAMES_BUCKET'" \
    "gcloud storage buckets create 'gs://$GAMES_BUCKET' --location='$REGION' --uniform-bucket-level-access"

  log "granting generation-service write access to the bucket"
  gcloud storage buckets add-iam-policy-binding "gs://$GAMES_BUCKET" \
    --member="serviceAccount:${GEN_SA_EMAIL}" --role="roles/storage.objectAdmin" >/dev/null

  log "making bundle objects publicly readable (served via Cloud CDN)"
  if ! gcloud storage buckets add-iam-policy-binding "gs://$GAMES_BUCKET" \
        --member="allUsers" --role="roles/storage.objectViewer" >/dev/null 2>&1; then
    warn "could not grant public read — org policy may enforce publicAccessPrevention."
    warn "  Cloud CDN backend buckets require public objects. See the runbook for the"
    warn "  private-bucket + Cloud Run games-cdn proxy fallback."
  fi

  log "setting bucket CORS (cross-origin source view of game files)"
  local cors; cors="$(mktemp)"
  cat > "$cors" <<'JSON'
[{"origin":["*"],"method":["GET","HEAD"],"responseHeader":["Content-Type","ETag"],"maxAgeSeconds":3600}]
JSON
  gcloud storage buckets update "gs://$GAMES_BUCKET" --cors-file="$cors" >/dev/null
  rm -f "$cors"
  ok "games bucket ready"
}

cdn_load_balancer() {
  ensure "global IP ${LB_IP_NAME}" \
    "gcloud compute addresses describe '$LB_IP_NAME' --global" \
    "gcloud compute addresses create '$LB_IP_NAME' --global"

  local ip domain
  ip="$(gcloud compute addresses describe "$LB_IP_NAME" --global --format='value(address)')"
  domain="${ip//./-}.sslip.io"          # e.g. 34-120-1-2.sslip.io — encodes the IP, no domain to buy
  state_set LB_IP "$ip"
  state_set SSLIP_DOMAIN "$domain"
  state_set CDN_BASE_URL "https://${domain}"
  ok "load balancer IP = ${ip}  →  games origin = https://${domain}"

  ensure "backend bucket ${LB_BACKEND_BUCKET} (Cloud CDN)" \
    "gcloud compute backend-buckets describe '$LB_BACKEND_BUCKET'" \
    "gcloud compute backend-buckets create '$LB_BACKEND_BUCKET' --gcs-bucket-name='$GAMES_BUCKET' --enable-cdn"

  log "configuring CDN cache mode + hardened response headers"
  gcloud compute backend-buckets update "$LB_BACKEND_BUCKET" \
    --cache-mode=USE_ORIGIN_HEADERS \
    --custom-response-header="X-Content-Type-Options: nosniff" \
    --custom-response-header="Content-Security-Policy: ${CSP}" \
    --custom-response-header="Access-Control-Allow-Origin: *" >/dev/null

  ensure "URL map ${LB_URL_MAP}" \
    "gcloud compute url-maps describe '$LB_URL_MAP'" \
    "gcloud compute url-maps create '$LB_URL_MAP' --default-backend-bucket='$LB_BACKEND_BUCKET'"

  ensure "managed TLS cert ${LB_CERT} for ${domain}" \
    "gcloud compute ssl-certificates describe '$LB_CERT' --global" \
    "gcloud compute ssl-certificates create '$LB_CERT' --domains='$domain' --global"

  ensure "target HTTPS proxy ${LB_HTTPS_PROXY}" \
    "gcloud compute target-https-proxies describe '$LB_HTTPS_PROXY'" \
    "gcloud compute target-https-proxies create '$LB_HTTPS_PROXY' --url-map='$LB_URL_MAP' --ssl-certificates='$LB_CERT' --global"

  ensure "forwarding rule ${LB_FWD_RULE} (:443)" \
    "gcloud compute forwarding-rules describe '$LB_FWD_RULE' --global" \
    "gcloud compute forwarding-rules create '$LB_FWD_RULE' --address='$LB_IP_NAME' --global --target-https-proxy='$LB_HTTPS_PROXY' --ports=443"

  warn "The Google-managed cert for ${domain} provisions asynchronously (10–60 min)."
  warn "  Check:  gcloud compute ssl-certificates describe ${LB_CERT} --global --format='value(managed.status)'"
}

seed_deploy_secrets() {
  # Shared secrets consumed at deploy time.
  state_get_or_create SERVICE_TOKEN gen_secret >/dev/null
  state_get_or_create DJANGO_SECRET_KEY gen_secret >/dev/null
  state_set SQL_CONNECTION_NAME "$SQL_CONNECTION_NAME"
  state_set GAMES_BUCKET "$GAMES_BUCKET"
}

main() {
  preflight
  require_cmd openssl
  enable_apis
  artifact_registry
  service_accounts
  cloud_sql
  games_bucket
  cdn_load_balancer
  seed_deploy_secrets
  ok "provisioning complete — secrets/state in ${STATE_FILE}"
  log "next:  ./deploy/build.sh   then   ./deploy/deploy.sh"
}

main "$@"
