#!/usr/bin/env bash
# build.sh — build + push both images to Artifact Registry via Cloud Build.
# Tags with the current git short SHA (and :latest). No local Docker needed.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/config.sh"
source "${HERE}/lib.sh"

main() {
  preflight
  require_cmd git
  local tag; tag="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo manual)"
  log "building images with Cloud Build (tag=${tag})"
  gcloud builds submit "$REPO_ROOT" \
    --config "${REPO_ROOT}/cloudbuild.yaml" \
    --substitutions="_AR_HOST=${AR_HOST},_REPO_PATH=${PROJECT_ID}/${AR_REPO},_TAG=${tag}"
  state_set IMAGE_TAG "$tag"
  ok "images pushed: ${GEN_IMAGE}:${tag} · ${WEB_IMAGE}:${tag}"
}

main "$@"
