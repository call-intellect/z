import { parseIssueStateCategory, type IssueStateCategory } from "./enums";

export interface TrackerStateApi {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  color: string;
  category: string;
  sequence: number;
  isDefault: boolean;
}

export interface ListStatesResponseApi {
  items: TrackerStateApi[];
  total: number;
}

export interface TrackerState {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  color: string;
  category: IssueStateCategory;
  sequence: number;
  isDefault: boolean;
}

export function trackerStateFromApi(api: TrackerStateApi): TrackerState {
  return {
    id: api.id,
    tenantId: api.tenantId,
    projectId: api.projectId,
    name: api.name,
    color: api.color,
    category: parseIssueStateCategory(api.category),
    sequence: api.sequence,
    isDefault: api.isDefault,
  };
}

const CATEGORY_ORDER: Record<IssueStateCategory, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  cancelled: 4,
};

export function compareStatesForBoard(
  a: TrackerState,
  b: TrackerState,
): number {
  const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
  if (byCategory !== 0) return byCategory;
  const bySequence = a.sequence - b.sequence;
  if (bySequence !== 0) return bySequence;
  return a.name.localeCompare(b.name, "ru");
}
