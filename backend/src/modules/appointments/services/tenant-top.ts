import { createHash } from 'node:crypto';

const BUCKET_COUNT = 100;

export function resolveAppointmentTenantTop(tenantId: string): string {
  if (!tenantId) return 'other';
  try {
    const hash = createHash('sha1').update(tenantId).digest();
    const slice = hash.readUInt32BE(0);
    const bucket = slice % BUCKET_COUNT;
    return `t${bucket}`;
  } catch {
    return 'other';
  }
}

export function resolveAppointmentStatus(
  validTo: Date | null,
  now: number = Date.now(),
): 'active' | 'former' {
  if (!validTo) return 'active';
  return validTo.getTime() < now ? 'former' : 'active';
}
