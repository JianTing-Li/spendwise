CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS demo_state (
  id integer PRIMARY KEY CHECK (id = 1), generation integer NOT NULL DEFAULT 0,
  injected boolean NOT NULL DEFAULT false
);
INSERT INTO demo_state (id) VALUES (1) ON CONFLICT DO NOTHING;
-- Zod validates complete payloads and relationships before every dataset write.
-- Stable IDs and vendor foreign keys also protect persistence boundaries.
CREATE TABLE IF NOT EXISTS vendors (id text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS invoices (id text PRIMARY KEY, vendor_id text NOT NULL REFERENCES vendors(id), payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS payments (id text PRIMARY KEY, vendor_id text NOT NULL REFERENCES vendors(id), payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS vendor_notes (id text PRIMARY KEY, vendor_id text NOT NULL REFERENCES vendors(id), payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS exceptions (id text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS investigation_runs (
  id text PRIMARY KEY, exception_id text NOT NULL UNIQUE REFERENCES exceptions(id),
  generation integer NOT NULL, status text NOT NULL CHECK (status IN ('pending','running','completed','incomplete','failed','cancelled')),
  deadline_at timestamptz NOT NULL, payload jsonb NOT NULL
);
INSERT INTO schema_migrations (version) VALUES (1) ON CONFLICT DO NOTHING;
