export type RegulationKind = 'policy' | 'regulation' | 'process' | 'instruction';
export type RegulationSeverity = 'advisory' | 'mandatory' | 'blocking';

export interface RetrievedRegulation {
  kind: RegulationKind;
  id: string;
  name: string;
  text: string;
  severity: RegulationSeverity | null;
  scope: string | null;
  distance: number;
}

export function parseRoleScope(scope: string | null | undefined): string | null {
  const trimmed = scope?.trim();
  if (!trimmed || !trimmed.startsWith('role:')) return null;
  const id = trimmed.slice('role:'.length).trim();
  if (!id) return null;
  return id.slice(0, 120);
}

export function buildRoleScopeFilter(args: {
  roleId: string;
  includeOrg: boolean;
  departmentId?: string | null;
}): string[] {
  const scopes = [`role:${args.roleId}`];
  if (args.includeOrg) scopes.push('org');
  const departmentId = args.departmentId?.trim();
  if (departmentId) scopes.push(`department:${departmentId}`);
  return scopes;
}

export function regulationPriorityRank(r: {
  kind: RegulationKind;
  severity: RegulationSeverity | null;
}): number {
  if (r.kind === 'policy') {
    if (r.severity === 'blocking') return 0;
    if (r.severity === 'mandatory') return 1;
    return 3;
  }
  return 2;
}

export function rankRegulations(
  items: ReadonlyArray<RetrievedRegulation>,
  topN: number,
): RetrievedRegulation[] {
  return [...items]
    .sort((a, b) => {
      const rankDiff = regulationPriorityRank(a) - regulationPriorityRank(b);
      if (rankDiff !== 0) return rankDiff;
      return a.distance - b.distance;
    })
    .slice(0, topN);
}
