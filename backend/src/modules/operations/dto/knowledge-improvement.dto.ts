/**
 * TZ-1 Фаза 4 (daily-value-engine) — DTO эндпоинтов «улучшения и знания» на
 * COO-дашборде операций:
 *   - `GET /dashboard/operations/knowledge-at-risk` — знание-под-риском × уход.
 *   - `GET /dashboard/operations/team-capacity` — загрузка команд.
 *   - `GET /dashboard/operations/onboarding-ramp` — активация новичков.
 */

// ── Ф4.C — знание-под-риском ─────────────────────────────────────────

export interface KnowledgeAtRiskItemDto {
  categoryName: string;
  soleExpertPersonId: string | null;
  soleExpertPersonName: string | null;
  busFactorLevel: string;
  personRiskLevel: string | null;
  combinedSeverity: string;
  snapshotAt: string;
}

export interface KnowledgeAtRiskListDto {
  items: KnowledgeAtRiskItemDto[];
}

// ── Ф4.D — загрузка команд ───────────────────────────────────────────

export interface TeamCapacityItemDto {
  departmentId: string;
  departmentName: string;
  personCount: number;
  avgLoadPercent: number;
  maxLoadPercent: number;
  classification: 'overload' | 'underload' | 'ok';
}

export interface TeamCapacityListDto {
  items: TeamCapacityItemDto[];
  overloadedCount: number;
  underloadedCount: number;
  /** true, если нигде не заполнен loadPercent (пустое состояние). */
  empty: boolean;
}

// ── Ф4.E — активация новичков ────────────────────────────────────────

export interface OnboardingRampItemDto {
  personId: string;
  personName: string;
  userId: string | null;
  createdAt: string;
  firstActivityAt: string | null;
  daysSinceJoined: number;
  stalled: boolean;
}

export interface OnboardingRampListDto {
  items: OnboardingRampItemDto[];
  silentDays: number;
}
