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
/** APP-03 must load scope from trusted application records, never tool arguments alone. */
export function permitsResource(principal: Principal, scope: {
  subject: string; generation: number; resourceIds: readonly string[];
}, resourceId: string, currentGeneration: number): boolean {
  return permits(principal, 'read') && scope.subject === principal.subject &&
    scope.generation === currentGeneration && scope.resourceIds.includes(resourceId);
}
