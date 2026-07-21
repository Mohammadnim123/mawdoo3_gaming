-- Fallback schema grants, only needed if provision.sh's automatic step failed
-- (e.g. `gcloud sql connect` could not allowlist the runner). Run as postgres.
--
-- Generation DB:
--   gcloud sql connect mawdoo3-gaming-pg --user=postgres --database=generation_service
ALTER DATABASE generation_service OWNER TO gen_service;
GRANT ALL ON SCHEMA public TO gen_service;

-- Web-client DB (reconnect with --database=web_client, then run):
--   ALTER DATABASE web_client OWNER TO webclient;
--   GRANT ALL ON SCHEMA public TO webclient;
