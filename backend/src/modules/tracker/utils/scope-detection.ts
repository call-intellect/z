import type { Project } from '@prisma/client';

export function detectProjectScopeKind(
  p: Pick<Project, 'customerCardId' | 'vendorId' | 'subjectPersonId' | 'departmentId'>,
): 'org' | 'customer' | 'vendor' | 'person' | 'department' {
  if (p.customerCardId) return 'customer';
  if (p.vendorId) return 'vendor';
  if (p.subjectPersonId) return 'person';
  if (p.departmentId) return 'department';
  return 'org';
}
