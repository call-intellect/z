import type {
  ExperimentDetailApi,
  ExperimentLessonApi,
  ExperimentLessonTypeApi,
  ExperimentListItemApi,
  ExperimentStatusApi,
} from "@/api/experiments.api";

export type ExperimentStatus = ExperimentStatusApi;
export type ExperimentLessonType = ExperimentLessonTypeApi;

export const EXPERIMENT_STATUS_LABEL: Record<ExperimentStatus, string> = {
  hypothesis: "Гипотеза",
  running: "Идёт",
  completed: "Завершён",
  dropped: "Прекращён",
  paused: "На паузе",
};

export const EXPERIMENT_STATUS_TONE: Record<
  ExperimentStatus,
  "info" | "warning" | "success" | "neutral" | "danger"
> = {
  hypothesis: "info",
  running: "warning",
  completed: "success",
  dropped: "neutral",
  paused: "neutral",
};

export const EXPERIMENT_LESSON_TYPE_LABEL: Record<
  ExperimentLessonType,
  string
> = {
  what_worked: "Что сработало",
  what_failed: "Что не сработало",
  next_time: "В следующий раз",
};

export const EXPERIMENT_LESSON_TYPE_TONE: Record<
  ExperimentLessonType,
  "success" | "danger" | "info"
> = {
  what_worked: "success",
  what_failed: "danger",
  next_time: "info",
};

export interface ExperimentListItem extends ExperimentListItemApi {}

export interface ExperimentDetail extends ExperimentDetailApi {}

export interface ExperimentLesson extends ExperimentLessonApi {}

export function mapExperimentListItem(
  dto: ExperimentListItemApi,
): ExperimentListItem {
  return { ...dto };
}

export function mapExperimentDetail(
  dto: ExperimentDetailApi,
): ExperimentDetail {
  return { ...dto };
}

export function experimentRunningDurationDays(
  exp: Pick<ExperimentDetailApi, "status" | "startedAt" | "completedAt">,
): number | null {
  if (!exp.startedAt) return null;
  const start = new Date(exp.startedAt).getTime();
  const end = exp.completedAt
    ? new Date(exp.completedAt).getTime()
    : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / (24 * 3600 * 1000)));
}
