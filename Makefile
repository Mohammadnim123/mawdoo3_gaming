.PHONY: setup setup-service setup-web dev-service dev-web dev-cdn test test-service test-web lint demo consistency

SERVICE_DIR := services/generation-service
WEB_DIR     := apps/web-client
WEB_PORT    ?= 8001
# Base URL of the generation service (tracks APP_PORT / a remote deployment).
SERVICE_URL ?= http://localhost:8000

setup: setup-service setup-web

setup-service:
	python3 -m venv $(SERVICE_DIR)/.venv
	$(SERVICE_DIR)/.venv/bin/pip install --upgrade pip
	$(SERVICE_DIR)/.venv/bin/pip install -e "$(SERVICE_DIR)[dev]"
	@test -f $(SERVICE_DIR)/.env || cp $(SERVICE_DIR)/.env.example $(SERVICE_DIR)/.env
	@echo ">> edit $(SERVICE_DIR)/.env and set OPENROUTER_API_KEY"

setup-web:
	python3 -m venv $(WEB_DIR)/.venv
	$(WEB_DIR)/.venv/bin/pip install --upgrade pip
	$(WEB_DIR)/.venv/bin/pip install -e "$(WEB_DIR)[dev]"
	@test -f $(WEB_DIR)/.env || cp $(WEB_DIR)/.env.example $(WEB_DIR)/.env
	@echo ">> edit $(WEB_DIR)/.env and set OPENROUTER_API_KEY (prompt validation)"

dev-service:
	cd $(SERVICE_DIR) && .venv/bin/python -m generation_service

dev-web:
	cd $(WEB_DIR) && .venv/bin/python manage.py runserver 0.0.0.0:$(WEB_PORT)

# The dedicated static origin for generated games (S3+CDN stand-in).
dev-cdn:
	python3 services/games-cdn/serve.py

test: test-service test-web

test-service:
	cd $(SERVICE_DIR) && .venv/bin/python -m pytest -q

test-web:
	cd $(WEB_DIR) && .venv/bin/python manage.py test games -v 1

lint:
	cd $(SERVICE_DIR) && .venv/bin/python -m ruff check src tests
	cd $(WEB_DIR) && .venv/bin/python -m ruff check webclient games

# Kick off a generation from the terminal, e.g.:
#   make demo PROMPT="Make a Flappy Bird clone"
#   make demo PROMPT="لعبة تخمين أرقام"
# The prompt travels via the environment and is JSON-encoded by python3, so
# quotes and apostrophes in natural text survive intact.
demo: export DEMO_PROMPT := $(PROMPT)
demo:
	@curl -s -X POST $(SERVICE_URL)/api/v1/generations \
	  -H 'Content-Type: application/json' \
	  -d "$$(python3 -c 'import json, os; print(json.dumps({"prompt": os.environ.get("DEMO_PROMPT", "")}))')"

# Generate two different games and verify the bundles are structurally
# consistent (same file set, same pinned runtime, bespoke gameplay code).
consistency:
	GENERATION_API_URL=$(SERVICE_URL) python3 scripts/consistency_test.py
