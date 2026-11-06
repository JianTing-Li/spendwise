import type { DatabaseTransaction } from "./database";
/** Fail closed if a configured retrieval login can mutate app records. */
export async function assertReadOnly(tx: DatabaseTransaction) {
  const row = (await tx.query<{
    safe: boolean;
  }>(`SELECT NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls)
  AND NOT has_schema_privilege(current_user,current_schema(),'CREATE')
  AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname=current_schema() AND pg_has_role(current_user,tableowner,'MEMBER'))
  AND NOT EXISTS (SELECT 1 FROM information_schema.tables t WHERE t.table_schema=current_schema()
    AND has_table_privilege(current_user,quote_ident(t.table_schema)||'.'||quote_ident(t.table_name),'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname=current_schema()
    AND tablename IN ('schema_migrations','demo_state','exceptions','investigation_runs')
    AND has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'SELECT')) AS safe
  FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
  if (!row?.safe)
    throw new Error("Read-only database permissions required");
  await tx.exec("SELECT id FROM vendors LIMIT 0; SELECT id FROM payments LIMIT 0; SELECT id FROM invoices LIMIT 0; SELECT id FROM vendor_notes LIMIT 0; SELECT note_id FROM note_payments LIMIT 0; SELECT note_id FROM note_invoices LIMIT 0;");
}
/** Application may mutate records, but cannot own schema objects or run DDL. */
export async function assertApplication(tx: DatabaseTransaction) {
  const row = (await tx.query<{
    safe: boolean;
  }>(`SELECT NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls)
  AND NOT has_schema_privilege(current_user,current_schema(),'CREATE')
  AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname=current_schema() AND pg_has_role(current_user,tableowner,'MEMBER')) AS safe
  FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
  if (!row?.safe)
    throw new Error("Application database permissions required");
}

/** Read-only catalog preflight; does not exercise runtime writes or grant anything. */
export async function assertApplicationGrants(tx: DatabaseTransaction) {
  const rows = (await tx.query<{ safe: boolean }>(`SELECT bool_and(
        has_table_privilege(current_user, table_name, 'SELECT')
        AND has_table_privilege(current_user, table_name, 'INSERT')
        AND has_table_privilege(current_user, table_name, 'UPDATE')
        AND has_table_privilege(current_user, table_name, 'DELETE')) AS safe
        FROM unnest(ARRAY['demo_state','vendors','invoices','payments','vendor_notes',
          'note_payments','note_invoices','exceptions','investigation_runs']) AS table_name`)).rows;
  if (!rows[0]?.safe) throw new Error("Application record grants required");
}
