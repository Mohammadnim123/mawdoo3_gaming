#!/usr/bin/env bash
# ============================================================================
# setup_wif.sh — keyless GitHub Actions -> GCP auth (Workload Identity
# Federation). Creates a deployer service account, a WIF pool/provider scoped
# to THIS GitHub repo, and the IAM bindings CI needs. Idempotent.
#
# Prints the two values to add as GitHub Actions repository *variables*:
#   GCP_WIF_PROVIDER   and   GCP_DEPLOYER_SA
# ============================================================================
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/config.sh"
source "${HERE}/lib.sh"

main() {
  preflight
  local project_number
  project_number="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

  # --- deployer service account + roles --------------------------------------
  ensure "deployer SA ${DEPLOYER_SA}" \
    "gcloud iam service-accounts describe '$DEPLOYER_SA_EMAIL'" \
    "gcloud iam service-accounts create '$DEPLOYER_SA' --display-name='GitHub Actions deployer'"

  log "binding deployer roles"
  for role in roles/run.admin roles/cloudbuild.builds.editor \
              roles/artifactregistry.writer roles/storage.admin; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:${DEPLOYER_SA_EMAIL}" --role="$role" --condition=None >/dev/null
  done
  # Deploy Cloud Run *as* the runtime service accounts (actAs).
  for sa in "$GEN_SA_EMAIL" "$WEB_SA_EMAIL"; do
    gcloud iam service-accounts add-iam-policy-binding "$sa" \
      --member="serviceAccount:${DEPLOYER_SA_EMAIL}" --role="roles/iam.serviceAccountUser" >/dev/null 2>&1 || true
  done

  # --- let Cloud Build push to Artifact Registry -----------------------------
  # Newer projects run builds as the Compute default SA; older ones as the
  # Cloud Build SA. Grant both (idempotent; ignore if one doesn't exist).
  for build_sa in "${project_number}-compute@developer.gserviceaccount.com" \
                  "${project_number}@cloudbuild.gserviceaccount.com"; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:${build_sa}" --role="roles/artifactregistry.writer" --condition=None >/dev/null 2>&1 || true
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:${build_sa}" --role="roles/logging.logWriter" --condition=None >/dev/null 2>&1 || true
  done

  # --- Workload Identity pool + GitHub OIDC provider -------------------------
  ensure "WIF pool ${WIF_POOL}" \
    "gcloud iam workload-identity-pools describe '$WIF_POOL' --location=global" \
    "gcloud iam workload-identity-pools create '$WIF_POOL' --location=global --display-name='GitHub Actions'"

  ensure "WIF provider ${WIF_PROVIDER}" \
    "gcloud iam workload-identity-pools providers describe '$WIF_PROVIDER' --location=global --workload-identity-pool='$WIF_POOL'" \
    "gcloud iam workload-identity-pools providers create-oidc '$WIF_PROVIDER' \
        --location=global --workload-identity-pool='$WIF_POOL' \
        --display-name='GitHub OIDC' \
        --issuer-uri='https://token.actions.githubusercontent.com' \
        --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository' \
        --attribute-condition=\"assertion.repository=='${GITHUB_REPO}'\""

  # Only workflows from THIS repo may impersonate the deployer SA.
  # Brief pause: a freshly-created SA's IAM resource can lag, and setIamPolicy
  # then fails with PERMISSION_DENIED ("may not exist") until it propagates.
  sleep 10
  log "allowing repo ${GITHUB_REPO} to impersonate ${DEPLOYER_SA}"
  gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA_EMAIL" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/projects/${project_number}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository/${GITHUB_REPO}" >/dev/null

  local provider_resource="projects/${project_number}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"
  cat <<EOF

$(ok "Workload Identity Federation ready")

Add these as GitHub Actions repository VARIABLES (Settings → Secrets and
variables → Actions → Variables), used by .github/workflows/deploy.yml:

  GCP_PROJECT_ID     = ${PROJECT_ID}
  GCP_REGION         = ${REGION}
  GCP_WIF_PROVIDER   = ${provider_resource}
  GCP_DEPLOYER_SA    = ${DEPLOYER_SA_EMAIL}

No JSON key is created or stored — auth is keyless via OIDC.
EOF
}

main "$@"
