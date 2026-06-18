import { apiClient } from "../api-client";

export interface TourEntryApi {
  completedAt?: string;
  skipped?: boolean;
}

export interface TourProgressApi {
  welcome?: TourEntryApi;
  project?: TourEntryApi;
  meeting?: TourEntryApi;
  overview?: TourEntryApi;
  demo?: TourEntryApi;
}

export type TourIdApi = "welcome" | "project" | "meeting" | "overview" | "demo";

export interface UpdateTourProgressBodyApi {
  tourId: TourIdApi;
  completedAt?: string;
  skipped?: boolean;
}

export const tourProgressApi = {
  get: (): Promise<TourProgressApi> =>
    apiClient.get<TourProgressApi>("/api/v1/users/me/tour-progress"),

  update: (body: UpdateTourProgressBodyApi): Promise<TourProgressApi> =>
    apiClient.patch<TourProgressApi>("/api/v1/users/me/tour-progress", body),

  reset: (): Promise<{ ok: true }> =>
    apiClient.post<{ ok: true }>("/api/v1/users/me/tour-progress/reset", {}),
};
