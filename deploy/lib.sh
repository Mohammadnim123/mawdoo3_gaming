#!/usr/bin/env bash
# Shared helpers for the deploy scripts. Sourced after config.sh.

set -euo pipefail

# --- pretty logging ----------------------------------------------------------
_c() { printf '\033[%sm' "$1"; }
log()  { printf '%s➜ %s%s\n' "$(_c '1;34')" "$*" "$(_c 0)"; }
ok()   { printf '%s✓ %s%s\n' "$(_c '1;32')" "$*" "$(_c 0)"; }
warn() { printf '%s! %s%s\n' "$(_c '1;33')" "$*" "$(_c 0)" >&2; }
die()  { printf '%s✗ %s%s\n' "$(_c '1;31')" "$*" "$(_c 0)" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

# Verify gcloud is authenticated & pointed at the right project (fails clearly
# instead of the opaque "Reauthentication failed" mid-run).
preflight() {
  require_cmd gcloud
  if ! gcloud auth print-access-token >/dev/null 2>&1; then
    die "gcloud is not authenticated. Run:  gcloud auth login  &&  gcloud auth application-default login"
  fi
  gcloud config set project "$PROJECT_ID" >/dev/null
  ok "authenticated as $(gcloud config get-value account 2>/dev/null) · project=${PROJECT_ID} · region=${REGION}"
}

# Idempotency guard: run "create" only when the resource is absent. Usage:
#   ensure "artifact repo" "gcloud artifacts repositories describe ... " "gcloud artifacts repositories create ..."
ensure() {
  local what="$1" check="$2" create="$3"
  if eval "$check" >/dev/null 2>&1; then
    ok "${what} already exists"
  else
    log "creating ${what}"
    eval "$create"
    ok "created ${what}"
  fi
}

# --- generated-secret state ---------------------------------------------------
# Persists provision-time secrets (DB passwords, service token, LB IP, ...) so
# the deploy step can consume them. Written to deploy/.secrets/ (gitignored).
state_init() { mkdir -p "$STATE_DIR"; touch "$STATE_FILE"; chmod 700 "$STATE_DIR"; chmod 600 "$STATE_FILE"; }

# state_set KEY VALUE — upsert (idempotent so re-provisioning keeps secrets).
state_set() {
  local key="$1" val="$2"
  state_init
  if grep -q "^${key}=" "$STATE_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$STATE_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$STATE_FILE"
  fi
}

# state_get_or_create KEY GENERATOR — return an existing secret or generate,
# persist, and return a new one. Keeps values stable across re-runs.
state_get_or_create() {
  local key="$1" gen="$2" existing
  state_init
  # `|| true`: a no-match grep returns non-zero which, under `set -o pipefail`,
  # would trip `set -e` when this runs as a direct (non-substituted) call.
  existing="$(grep "^${key}=" "$STATE_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  if [[ -n "$existing" ]]; then printf '%s' "$existing"; return; fi
  local val; val="$(eval "$gen")"
  state_set "$key" "$val"
  printf '%s' "$val"
}

load_state() { state_init; set -a; # shellcheck disable=SC1090
  source "$STATE_FILE"; set +a; }

gen_secret() { openssl rand -hex 32; }   # 64 hex chars — >Django's 50-char floor, no URL-encoding needed

# Read a single KEY's value from a dotenv file (real env vars are NOT consulted
# here — we want exactly what the dev .env holds). Empty if absent.
dotenv_get() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || { printf ''; return; }
  grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true
}
