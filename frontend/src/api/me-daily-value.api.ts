import { apiClient } from "./api-client";
import type { IdeaListItemApi } from "./ideas.api";

export interface MyIdeasResponseApi {
  items: IdeaListItemApi[];
}

export interface MyRecognitionApi {
  id: string;
  type: string;
  message: string | null;
  fromPersonName: string | null;
  visibility: string;
  createdAt: string;
}

export interface MyRecognitionsResponseApi {
  items: MyRecognitionApi[];
}

export interface MyWeeklyPersonRowApi {
  personId: string;
  personName: string;
  departmentName: string | null;
  promisesGiven: number;
  promisesKept: number;
  promisesBroken: number;
  promisesOverdue: number;
  promisesNoAnswer: number;
  reliabilityPercent: number | null;
  tasksDone: number;
  checkInsCompleted: number;
}

export interface MyWeeklyPerPersonApi {
  weekStart: string;
  weekEnd: string;
  row: MyWeeklyPersonRowApi | null;
  teamAverageReliabilityPercent: number | null;
}

export const meDailyValueApi = {
  ideas: () => apiClient.get<MyIdeasResponseApi>("/api/v1/me/ideas"),

  recognitions: () =>
    apiClient.get<MyRecognitionsResponseApi>("/api/v1/me/recognitions"),

  weeklyPerPerson: (weekStart: string) =>
    apiClient.get<MyWeeklyPerPersonApi>(
      `/api/v1/me/weekly-per-person?weekStart=${encodeURIComponent(weekStart)}`,
    ),
};
