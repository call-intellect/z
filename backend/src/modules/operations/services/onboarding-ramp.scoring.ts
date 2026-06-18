export const DEFAULT_ONBOARDING_SILENT_DAYS = 5;

export function isOnboardingStalled(args: {
  createdAt: Date;
  firstActivityAt: Date | null;
  silentDays: number;
  now: Date;
}): boolean {
  const silentDays = safeNonNeg(args.silentDays) || DEFAULT_ONBOARDING_SILENT_DAYS;
  const ageDays = (args.now.getTime() - args.createdAt.getTime()) / 86_400_000;

  if (ageDays < silentDays) return false;
  if (ageDays > silentDays * 2) return false;

  if (args.firstActivityAt === null) return true;

  const activityDays = (args.firstActivityAt.getTime() - args.createdAt.getTime()) / 86_400_000;
  return safeNonNeg(activityDays) >= silentDays;
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function safeNonNeg(v: unknown): number {
  const n = safeNumber(v);
  return n > 0 ? n : 0;
}
