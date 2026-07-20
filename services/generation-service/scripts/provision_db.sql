-- Provision the generation-service Postgres role + database.
-- Run ONCE as a superuser, e.g.:
--   psql -h localhost -U postgres -f scripts/provision_db.sql
--
-- The role password here must match POSTGRES_PASSWORD in the service .env.
-- CREATEDB lets the test suite spin up (and drop) throwaway databases per test.
-- Idempotent: safe to re-run.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gen_service') THEN
        CREATE ROLE gen_service LOGIN CREATEDB PASSWORD 'gen_service_dev';
    END IF;
END
$$;

-- CREATE DATABASE cannot run inside a transaction/DO block; \gexec issues it
-- only when the database is missing.
SELECT 'CREATE DATABASE generation_service OWNER gen_service'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'generation_service')
\gexec
