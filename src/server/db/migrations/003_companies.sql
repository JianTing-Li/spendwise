-- Preserve every existing row and ID as the original Roast demo.
-- Company ownership is generated from server-owned, namespaced vendor IDs.
ALTER TABLE vendors ADD COLUMN company_id text GENERATED ALWAYS AS (
 CASE WHEN left(id,8)='hubspot:' THEN 'hubspot'
      WHEN left(id,4)='gxo:' THEN 'gxo' ELSE 'roast' END
) STORED;
CREATE INDEX vendors_company ON vendors(company_id);
ALTER TABLE demo_state DROP CONSTRAINT demo_state_id_check;
ALTER TABLE demo_state ADD CONSTRAINT demo_state_id_check CHECK (id IN (1,2,3));
INSERT INTO demo_state (id) VALUES (2),(3) ON CONFLICT DO NOTHING;
