-- 001 is immutable. The runner holds the migration lock for this entire upgrade.
-- Generated filter columns cannot drift from the validated record payload.
ALTER TABLE vendors
 ADD COLUMN name text GENERATED ALWAYS AS (payload->>'name') STORED,
 ADD COLUMN category text GENERATED ALWAYS AS (payload->>'category') STORED;
CREATE INDEX vendors_category ON vendors(category);
ALTER TABLE invoices
 ADD COLUMN number text GENERATED ALWAYS AS (payload->>'number') STORED,
 ADD COLUMN service_period text GENERATED ALWAYS AS (payload->>'servicePeriod') STORED;
ALTER TABLE invoices
 ADD COLUMN invoice_date date GENERATED ALWAYS AS (make_date(substr(payload->>'date',1,4)::int, substr(payload->>'date',6,2)::int, substr(payload->>'date',9,2)::int)) STORED;
ALTER TABLE invoices ADD COLUMN amount_cents bigint GENERATED ALWAYS AS ((payload->>'amountCents')::bigint) STORED CHECK (amount_cents BETWEEN 0 AND 9007199254740991), ADD COLUMN currency text GENERATED ALWAYS AS (payload->>'currency') STORED CHECK (currency = 'USD');
ALTER TABLE payments ADD COLUMN amount_cents bigint GENERATED ALWAYS AS ((payload->>'amountCents')::bigint) STORED CHECK (amount_cents BETWEEN 0 AND 9007199254740991), ADD COLUMN currency text GENERATED ALWAYS AS (payload->>'currency') STORED CHECK (currency = 'USD');
ALTER TABLE payments
 ADD COLUMN payment_date date GENERATED ALWAYS AS (make_date(substr(payload->>'date',1,4)::int, substr(payload->>'date',6,2)::int, substr(payload->>'date',9,2)::int)) STORED,
 ADD COLUMN status text GENERATED ALWAYS AS (payload->>'status') STORED CHECK (status IN ('pending','completed','failed')),
 ADD COLUMN entry_type text GENERATED ALWAYS AS (payload->>'entryType') STORED CHECK (entry_type IN ('outgoing','reversal')),
 ADD COLUMN invoice_id text GENERATED ALWAYS AS (payload->>'invoiceId') STORED REFERENCES invoices(id),
 ADD COLUMN reversal_reference text GENERATED ALWAYS AS (payload->>'reversalReference') STORED REFERENCES payments(id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX one_reversal ON payments(reversal_reference) WHERE reversal_reference IS NOT NULL;
CREATE INDEX payments_scope ON payments(vendor_id, payment_date, status);
CREATE INDEX payments_invoice ON payments(invoice_id);
CREATE INDEX invoices_scope ON invoices(vendor_id, invoice_date);
ALTER TABLE vendor_notes ADD COLUMN note_date date GENERATED ALWAYS AS (make_date(substr(payload->>'date',1,4)::int, substr(payload->>'date',6,2)::int, substr(payload->>'date',9,2)::int)) STORED;
CREATE TABLE note_payments (note_id text REFERENCES vendor_notes(id) ON DELETE CASCADE, payment_id text REFERENCES payments(id), PRIMARY KEY(note_id,payment_id));
CREATE TABLE note_invoices (note_id text REFERENCES vendor_notes(id) ON DELETE CASCADE, invoice_id text REFERENCES invoices(id), PRIMARY KEY(note_id,invoice_id));
INSERT INTO note_payments SELECT id, jsonb_array_elements_text(payload->'paymentIds') FROM vendor_notes ON CONFLICT DO NOTHING;
INSERT INTO note_invoices SELECT id, jsonb_array_elements_text(payload->'invoiceIds') FROM vendor_notes ON CONFLICT DO NOTHING;
CREATE INDEX notes_by_payment ON note_payments(payment_id);
CREATE INDEX notes_by_invoice ON note_invoices(invoice_id);
CREATE INDEX notes_scope ON vendor_notes(vendor_id,note_date);
ALTER TABLE investigation_runs DROP CONSTRAINT investigation_runs_exception_id_key;
ALTER TABLE investigation_runs
 ADD COLUMN attempt integer NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 3),
 ADD COLUMN predecessor_id text UNIQUE REFERENCES investigation_runs(id),
 ADD CONSTRAINT run_attempt UNIQUE(exception_id,generation,attempt),
 ADD CONSTRAINT run_payload_metadata CHECK (NOT (payload ?| ARRAY['id','exceptionId','generation','state'])) NOT VALID;
UPDATE investigation_runs SET payload = payload - ARRAY['id','exceptionId','generation','state'];
ALTER TABLE investigation_runs VALIDATE CONSTRAINT run_payload_metadata;
