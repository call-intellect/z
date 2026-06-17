import { Injectable } from '@nestjs/common';

export interface ContributionSnapshotForBadge {
  ideasInDevelopment: number;
  ideasShipped: number;
  thanksReceived: number;
  thanksReceivedWeek: number;
  helpfulComments: number;
  probeQuestionsAnswered: number;
  currentCheckinStreak: number;
  longestCheckinStreak: number;
}

export type BadgeConditionType =
  | 'ideas_in_dev'
  | 'thanks_received'
  | 'helpful_comments'
  | 'checkin_streak'
  | 'goal_alignment';

export interface BadgeCondition {
  type: BadgeConditionType;
  threshold: number;
}

@Injectable()
export class BadgeConditionsService {
  evaluate(condition: BadgeCondition | unknown, snapshot: ContributionSnapshotForBadge): boolean {
    if (!this.isCondition(condition)) return false;
    switch (condition.type) {
      case 'ideas_in_dev':
        return snapshot.ideasInDevelopment >= condition.threshold;
      case 'thanks_received':
        return snapshot.thanksReceived >= condition.threshold;
      case 'helpful_comments':
        return snapshot.helpfulComments >= condition.threshold;
      case 'checkin_streak':
        return snapshot.currentCheckinStreak >= condition.threshold;
      case 'goal_alignment':
        return false;
      default:
        return false;
    }
  }

  isCondition(v: unknown): v is BadgeCondition {
    if (typeof v !== 'object' || v === null) return false;
    const obj = v as Record<string, unknown>;
    const typeOk =
      typeof obj.type === 'string' &&
      [
        'ideas_in_dev',
        'thanks_received',
        'helpful_comments',
        'checkin_streak',
        'goal_alignment',
      ].includes(obj.type);
    const thOk = typeof obj.threshold === 'number' && Number.isFinite(obj.threshold);
    return typeOk && thOk;
  }
}
