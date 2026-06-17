export type SeverityLevel = 'critical' | 'warning' | 'ok';
export type PersonRiskLevel = 'high' | 'medium' | 'low';

export function computeCombinedSeverity(
  busFactor: SeverityLevel,
  personRisk: PersonRiskLevel | null,
): SeverityLevel {
  if (busFactor === 'critical') {
    if (personRisk === 'high' || personRisk === 'medium') return 'critical';
    return 'warning';
  }
  if (busFactor === 'warning') {
    if (personRisk === 'high' || personRisk === 'medium') return 'warning';
    return 'ok';
  }
  return 'ok';
}

export function derivePersonRiskLevel(args: {
  riskFlags: Array<{ severity?: string | null }>;
  engagementScore: number | null;
}): PersonRiskLevel {
  const flags = Array.isArray(args.riskFlags) ? args.riskFlags : [];
  const hasHigh = flags.some((f) => f && f.severity === 'high');
  if (hasHigh) return 'high';
  const hasMedium = flags.some((f) => f && f.severity === 'medium');
  const lowEngagement =
    typeof args.engagementScore === 'number' &&
    Number.isFinite(args.engagementScore) &&
    args.engagementScore < 0.4;
  if (hasMedium || lowEngagement) return 'medium';
  return 'low';
}

export function normalizeBusFactorLevel(raw: string | null | undefined): SeverityLevel {
  if (raw === 'critical') return 'critical';
  if (raw === 'warning') return 'warning';
  return 'ok';
}
