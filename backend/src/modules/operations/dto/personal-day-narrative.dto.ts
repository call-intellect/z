import { z } from 'zod';

export const DayLetterQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type DayLetterQuery = z.infer<typeof DayLetterQuerySchema>;

export type PersonalDayVerdictState = 'ok' | 'warn' | 'risk';

export type PersonalDayAxisKey = 'tasks' | 'commitments' | 'load' | 'contribution';

export type PersonalDayLoadLevel = 'idle' | 'normal' | 'overloaded';

export interface PersonalDayNarrativeMetricsDto {
  tasksDone: number;
  tasksNotDone: number;
  tasksOverdue: number;
  tasksStuck: number;
  commitmentsGiven: number;
  commitmentsOverdue: number;
  activeTasks: number;
  loadLevel: PersonalDayLoadLevel | null;
  goalNetScore: number | null;
  weekStart: string | null;
}

export interface PersonalDayVerdictAxisDto {
  key: PersonalDayAxisKey;
  state: PersonalDayVerdictState;
  label: string;
  why: string;
}

export interface PersonalDayVerdictDto {
  overall: {
    state: PersonalDayVerdictState;
    emoji: string;
    title: string;
    oneLiner: string;
  };
  axes: PersonalDayVerdictAxisDto[];
}

export interface PersonalDayLetterSectionDto {
  key: string;
  title: string;
  prose: string;
  cites?: Array<{ label: string; ref: string }>;
}

export interface PersonalDayNarrativeDto {
  dateLocal: string;
  generated: boolean;
  verdict: PersonalDayVerdictDto | null;
  letter: PersonalDayLetterSectionDto[];
  bodyMarkdown: string | null;
  shortSummary: string | null;
  metrics: PersonalDayNarrativeMetricsDto | null;
  deliveredAt: string | null;
  openedAt: string | null;
}

export interface PersonDayPackageTaskRef {
  id: string;
  title: string;
  hint: string | null;
}

export interface PersonDayPackageCommitment {
  id: string;
  text: string;
  counterpartName: string | null;
  dueLabel: string | null;
}

export interface PersonDayPackage {
  personName: string | null;
  dateLocal: string;
  tasksDoneToday: PersonDayPackageTaskRef[];
  tasksOverdue: PersonDayPackageTaskRef[];
  tasksStuck: PersonDayPackageTaskRef[];
  planText: string | null;
  factText: string | null;
  notDone: string[];
  commitmentsGiven: PersonDayPackageCommitment[];
  commitmentsOverdue: PersonDayPackageCommitment[];
  activeTasks: number;
  loadLevel: PersonalDayLoadLevel | null;
  goalNetScore: number | null;
  weekStart: string | null;
  goalName: string | null;
  meetings: Array<{ id: string; title: string; summary: string; ref: string }>;
  voice: Array<{ label: string; ref: string; excerpt: string }>;
  blockers: Array<{ id: string; text: string }>;
}

export function emptyPersonalDayNarrativeDto(dateLocal: string): PersonalDayNarrativeDto {
  return {
    dateLocal,
    generated: false,
    verdict: null,
    letter: [],
    bodyMarkdown: null,
    shortSummary: null,
    metrics: null,
    deliveredAt: null,
    openedAt: null,
  };
}

export function toPersonalDayNarrativeDto(row: {
  dateLocal: string;
  verdictJson: unknown;
  letterJson: unknown;
  bodyMarkdown: string | null;
  shortSummary: string | null;
  metricsJson: unknown;
  deliveredAt: Date | null;
  openedAt: Date | null;
}): PersonalDayNarrativeDto {
  const verdict = (row.verdictJson as PersonalDayVerdictDto | null) ?? null;
  const letterRaw = row.letterJson as PersonalDayLetterSectionDto[] | null;
  const metrics = (row.metricsJson as PersonalDayNarrativeMetricsDto | null) ?? null;
  return {
    dateLocal: row.dateLocal,
    generated: true,
    verdict,
    letter: Array.isArray(letterRaw) ? letterRaw : [],
    bodyMarkdown: row.bodyMarkdown,
    shortSummary: row.shortSummary,
    metrics,
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    openedAt: row.openedAt ? row.openedAt.toISOString() : null,
  };
}
