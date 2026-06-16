import type {
  MyRecognitionApi,
  MyWeeklyPerPersonApi,
  MyWeeklyPersonRowApi,
} from "@/api/me-daily-value.api";

export const RECOGNITION_TYPE_LABEL: Record<string, string> = {
  thanks_comment: "спасибо за комментарий",
  thanks_helpfulness: "спасибо за помощь",
  mention_helped: "отметили, что помог",
  idea_shipped: "идея реализована",
  streak_milestone: "серия достижений",
  weekly_summary: "итоги недели",
};

export function recognitionTypeLabel(type: string): string {
  return RECOGNITION_TYPE_LABEL[type] ?? type;
}

export interface MyRecognitionDomain {
  id: string;
  type: string;
  typeLabel: string;
  message: string | null;
  fromPersonName: string | null;
  visibility: string;
  createdAt: Date;
}

export function mapMyRecognition(api: MyRecognitionApi): MyRecognitionDomain {
  return {
    id: api.id,
    type: api.type,
    typeLabel: recognitionTypeLabel(api.type),
    message: api.message,
    fromPersonName: api.fromPersonName,
    visibility: api.visibility,
    createdAt: new Date(api.createdAt),
  };
}

export interface MyWeeklySelfRowDomain {
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
  reliabilityDenominator: number;
}

export interface MyWeeklySelfDomain {
  weekStart: string;
  weekEnd: string;
  row: MyWeeklySelfRowDomain | null;
  teamAverageReliabilityPercent: number | null;
}

function mapMyWeeklyRow(api: MyWeeklyPersonRowApi): MyWeeklySelfRowDomain {
  return {
    personId: api.personId,
    personName: api.personName,
    departmentName: api.departmentName,
    promisesGiven: api.promisesGiven,
    promisesKept: api.promisesKept,
    promisesBroken: api.promisesBroken,
    promisesOverdue: api.promisesOverdue,
    promisesNoAnswer: api.promisesNoAnswer,
    reliabilityPercent: api.reliabilityPercent,
    tasksDone: api.tasksDone,
    checkInsCompleted: api.checkInsCompleted,
    reliabilityDenominator:
      api.promisesKept + api.promisesBroken + api.promisesOverdue,
  };
}

export function mapMyWeeklySelf(api: MyWeeklyPerPersonApi): MyWeeklySelfDomain {
  return {
    weekStart: api.weekStart,
    weekEnd: api.weekEnd,
    row: api.row ? mapMyWeeklyRow(api.row) : null,
    teamAverageReliabilityPercent: api.teamAverageReliabilityPercent,
  };
}
