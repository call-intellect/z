import { z } from 'zod';

export type ReportRhythm = 'day' | 'week' | 'month';

export type AvailablePeriodStateHint = 'ok' | 'warn' | 'risk' | null;

export interface AvailablePeriodDto {
  period: string;
  stateHint: AvailablePeriodStateHint;
  title: string | null;
}

export interface AvailablePeriodsDto {
  rhythm: ReportRhythm;
  periods: AvailablePeriodDto[];
  latest: string | null;
}

export const AvailablePeriodsQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(50).optional() })
  .strict();

export type AvailablePeriodsQuery = z.infer<typeof AvailablePeriodsQuerySchema>;

function parseStateHint(raw: unknown): AvailablePeriodStateHint {
  return raw === 'ok' || raw === 'warn' || raw === 'risk' ? raw : null;
}

export function mapAvailablePeriod(period: string, verdictJson: unknown): AvailablePeriodDto {
  if (!verdictJson || typeof verdictJson !== 'object') {
    return { period, stateHint: null, title: null };
  }
  const obj = verdictJson as Record<string, unknown>;
  const overall =
    obj.overall && typeof obj.overall === 'object'
      ? (obj.overall as Record<string, unknown>)
      : {};
  return {
    period,
    stateHint: parseStateHint(overall.state),
    title: typeof overall.title === 'string' ? overall.title : null,
  };
}
