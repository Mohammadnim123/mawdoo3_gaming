#!/usr/bin/env bash
# ============================================================================
# deploy.sh — deploy both Cloud Run services + run Django migrations.
#
# Two-phase by necessity: a service's own public URL is only known after it is
# first deployed, and it feeds ALLOWED_HOSTS / CSRF / SITE_ORIGIN / the Stripe
# return URL. Secrets come from deploy/.secrets/state.env (provision.sh) and the
# dev .env files. Run after ./deploy/provision.sh and ./deploy/build.sh.
# ============================================================================
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/config.sh"
source "${HERE}/lib.sh"

emit() { printf '%s: "%s"\n' "$1" "$2" >> "$ENVOUT"; }   # KEY -> quoted YAML

gen_env_file() {
  ENVOUT="${STATE_DIR}/generation-service.env.yaml"; : > "$ENVOUT"; chmod 600 "$ENVOUT"
  emit APP_ENV prod
  emit APP_DEBUG false
  emit LOG_LEVEL INFO
  emit LOG_FORMAT json
  emit STORAGE_BACKEND gcs
  emit OBJECT_STORAGE_BUCKET "$GAMES_BUCKET"
  emit CDN_BASE_URL "$CDN_BASE_URL"
  emit DATABASE_URL "postgresql://${GEN_DB_USER}:${GEN_DB_PASSWORD}@/${GEN_DB}?host=/cloudsql/${SQL_CONNECTION_NAME}"
  emit AI_PROVIDER "$(dotenv_get "$GEN_ENV_SRC" AI_PROVIDER | grep . || echo openrouter)"
  emit OPENROUTER_API_KEY "$(dotenv_get "$GEN_ENV_SRC" OPENROUTER_API_KEY)"
  emit OPENROUTER_BASE_URL "$(dotenv_get "$GEN_ENV_SRC" OPENROUTER_BASE_URL | grep . || echo https://openrouter.ai/api/v1)"
  emit UNDERSTANDING_MODEL "$(dotenv_get "$GEN_ENV_SRC" UNDERSTANDING_MODEL | grep . || echo anthropic/claude-haiku-4.5)"
  emit BLUEPRINT_MODEL "$(dotenv_get "$GEN_ENV_SRC" BLUEPRINT_MODEL | grep . || echo anthropic/claude-opus-4.8)"
  emit CODE_MODEL "$(dotenv_get "$GEN_ENV_SRC" CODE_MODEL | grep . || echo anthropic/claude-sonnet-5)"
  emit GENERATION_TIMEOUT_SECONDS "$(dotenv_get "$GEN_ENV_SRC" GENERATION_TIMEOUT_SECONDS | grep . || echo 1800)"
  emit GEMINI_API_KEY "$(dotenv_get "$GEN_ENV_SRC" GEMINI_API_KEY)"
  emit FEATURE_BACKGROUND_ART "$(dotenv_get "$GEN_ENV_SRC" FEATURE_BACKGROUND_ART | grep . || echo true)"
  emit FEATURE_COVER_POSTER "$(dotenv_get "$GEN_ENV_SRC" FEATURE_COVER_POSTER | grep . || echo true)"
  emit SERVICE_TOKEN "$SERVICE_TOKEN"
  emit SECRET_KEY "$DJANGO_SECRET_KEY"
}

# arg1 = ALLOWED_HOSTS value (phase A uses "*", phase B the real host)
web_env_file() {
  ENVOUT="${STATE_DIR}/web-client.env.yaml"; : > "$ENVOUT"; chmod 600 "$ENVOUT"
  emit DJANGO_DEBUG false
  emit DJANGO_SECRET_KEY "$DJANGO_SECRET_KEY"
  emit DJANGO_ALLOWED_HOSTS "$1"
  emit POSTGRES_DB "$WEB_DB"
  emit POSTGRES_USER "$WEB_DB_USER"
  emit POSTGRES_PASSWORD "$WEB_DB_PASSWORD"
  emit POSTGRES_HOST "/cloudsql/${SQL_CONNECTION_NAME}"
  emit POSTGRES_PORT 5432
  emit GENERATION_API_URL "$GEN_URL"
  emit GENERATION_SERVICE_TOKEN "$SERVICE_TOKEN"
  emit GAMES_CDN_BASE_URL "$CDN_BASE_URL"
  emit VALIDATION_AI_PROVIDER "$(dotenv_get "$WEB_ENV_SRC" VALIDATION_AI_PROVIDER | grep . || echo openrouter)"
  emit OPENROUTER_API_KEY "$(dotenv_get "$WEB_ENV_SRC" OPENROUTER_API_KEY)"
  emit OPENROUTER_BASE_URL "$(dotenv_get "$WEB_ENV_SRC" OPENROUTER_BASE_URL | grep . || echo https://openrouter.ai/api/v1)"
  emit VALIDATION_MODEL "$(dotenv_get "$WEB_ENV_SRC" VALIDATION_MODEL | grep . || echo anthropic/claude-haiku-4.5)"
  emit WEB_DEFAULT_LOCALE "$(dotenv_get "$WEB_ENV_SRC" WEB_DEFAULT_LOCALE | grep . || echo ar)"
  emit GAMES_PAGE_SIZE "$(dotenv_get "$WEB_ENV_SRC" GAMES_PAGE_SIZE | grep . || echo 100)"
  emit AUTH_SKIP_EMAIL_VERIFICATION "$(dotenv_get "$WEB_ENV_SRC" AUTH_SKIP_EMAIL_VERIFICATION | grep . || echo false)"
  emit MAILGUN_API_KEY "$(dotenv_get "$WEB_ENV_SRC" MAILGUN_API_KEY)"
  emit MAILGUN_DOMAIN "$(dotenv_get "$WEB_ENV_SRC" MAILGUN_DOMAIN)"
  emit MAILGUN_BASE_URL "$(dotenv_get "$WEB_ENV_SRC" MAILGUN_BASE_URL | grep . || echo https://api.mailgun.net)"
  emit MAILGUN_FROM_EMAIL "$(dotenv_get "$WEB_ENV_SRC" MAILGUN_FROM_EMAIL)"
  emit STRIPE_SECRET_KEY "$(dotenv_get "$WEB_ENV_SRC" STRIPE_SECRET_KEY)"
  emit STRIPE_PUBLISHABLE_KEY "$(dotenv_get "$WEB_ENV_SRC" STRIPE_PUBLISHABLE_KEY)"
  emit STRIPE_WEBHOOK_SECRET "$(dotenv_get "$WEB_ENV_SRC" STRIPE_WEBHOOK_SECRET)"
  emit STRIPE_PRICE_PRO_MONTHLY "$(dotenv_get "$WEB_ENV_SRC" STRIPE_PRICE_PRO_MONTHLY)"
  emit STRIPE_PRICE_PRO_YEARLY "$(dotenv_get "$WEB_ENV_SRC" STRIPE_PRICE_PRO_YEARLY)"
}

run_url() { gcloud run services describe "$1" --region "$REGION" --format='value(status.url)'; }
host_of() { echo "${1#https://}"; }

main() {
  preflight
  load_state
  local TAG="${IMAGE_TAG:-latest}"
  [[ -n "${CDN_BASE_URL:-}" ]] || die "CDN_BASE_URL missing from state — run ./deploy/provision.sh first"
  log "deploying tag=${TAG} · games origin=${CDN_BASE_URL}"

  # --- generation-service (single always-on instance for in-process jobs) ---
  gen_env_file
  log "deploying ${GEN_SERVICE}"
  gcloud run deploy "$GEN_SERVICE" \
    --image "${GEN_IMAGE}:${TAG}" --region "$REGION" \
    --service-account "$GEN_SA_EMAIL" \
    --add-cloudsql-instances "$SQL_CONNECTION_NAME" \
    --env-vars-file "${STATE_DIR}/generation-service.env.yaml" \
    --allow-unauthenticated \
    --min-instances "$GEN_MIN_INSTANCES" --max-instances "$GEN_MAX_INSTANCES" \
    --cpu "$GEN_CPU" --memory "$GEN_MEMORY" --no-cpu-throttling \
    --concurrency "$GEN_CONCURRENCY" --timeout "$GEN_TIMEOUT" \
    --port 8080 --quiet
  GEN_URL="$(run_url "$GEN_SERVICE")"
  gcloud run services update "$GEN_SERVICE" --region "$REGION" \
    --update-env-vars "APP_PUBLIC_BASE_URL=${GEN_URL}" --quiet >/dev/null
  ok "generation-service → ${GEN_URL}"

  # --- Django migrations (Cloud Run job, run before the web app serves) -----
  web_env_file "*"
  log "running database migrations (${MIGRATE_JOB})"
  gcloud run jobs deploy "$MIGRATE_JOB" \
    --image "${WEB_IMAGE}:${TAG}" --region "$REGION" \
    --service-account "$WEB_SA_EMAIL" \
    --set-cloudsql-instances "$SQL_CONNECTION_NAME" \
    --env-vars-file "${STATE_DIR}/web-client.env.yaml" \
    --command python --args "manage.py,migrate,--noinput" \
    --max-retries 1 --task-timeout 600 --quiet
  gcloud run jobs execute "$MIGRATE_JOB" --region "$REGION" --wait
  ok "migrations applied"

  # --- web-client (phase A: ALLOWED_HOSTS=* so the health probe passes) -----
  log "deploying ${WEB_SERVICE}"
  gcloud run deploy "$WEB_SERVICE" \
    --image "${WEB_IMAGE}:${TAG}" --region "$REGION" \
    --service-account "$WEB_SA_EMAIL" \
    --add-cloudsql-instances "$SQL_CONNECTION_NAME" \
    --env-vars-file "${STATE_DIR}/web-client.env.yaml" \
    --allow-unauthenticated \
    --min-instances "$WEB_MIN_INSTANCES" --max-instances "$WEB_MAX_INSTANCES" \
    --cpu "$WEB_CPU" --memory "$WEB_MEMORY" \
    --concurrency "$WEB_CONCURRENCY" --timeout "$WEB_TIMEOUT" \
    --port 8080 --quiet
  WEB_URL="$(run_url "$WEB_SERVICE")"

  # --- phase B: pin host + origins now that the URL is known ----------------
  log "pinning web-client host/CSRF/site origin to ${WEB_URL}"
  gcloud run services update "$WEB_SERVICE" --region "$REGION" --quiet \
    --update-env-vars "^##^DJANGO_ALLOWED_HOSTS=$(host_of "$WEB_URL")##DJANGO_CSRF_TRUSTED_ORIGINS=${WEB_URL}##SITE_ORIGIN=${WEB_URL}##STRIPE_RETURN_BASE_URL=${WEB_URL}" >/dev/null
  ok "web-client → ${WEB_URL}"

  cat <<EOF

$(ok "DEPLOYMENT COMPLETE")
  Web client (public):     ${WEB_URL}
  Generation service:      ${GEN_URL}
  Games origin (Cloud CDN):${CDN_BASE_URL}

  Post-deploy:
    • Managed TLS cert for the games origin may still be provisioning (10–60 min).
    • For Stripe: point a webhook at ${WEB_URL}/api/v1/billing/stripe/webhook,
      then set STRIPE_WEBHOOK_SECRET and re-run deploy (or gcloud run services update).
EOF
}

main "$@"
