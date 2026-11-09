import { z } from 'zod';
export const Permission = z.enum(['read', 'inject', 'reset', 'review', 'retry']);
export type Permission = z.infer<typeof Permission>;
const Grant = z.object({
  permissions: z.array(Permission),
  runIds: z.array(z.string().min(1).max(200)).optional(),
}).strict();
export const Grants = z.record(z.string().regex(/^github:\d+$/), Grant);
export type Grant = z.infer<typeof Grant>;
export type Principal = { subject: string; grant: Grant };
export function permits(principal: Principal, permission: Permission, runId?: string): boolean {
  if (!principal.grant.permissions.includes(permission)) return false;
  if ((permission === 'review' || permission === 'retry') && principal.grant.runIds)
    return !!runId && principal.grant.runIds.includes(runId);
  return true;
}
