import { Injectable } from '@nestjs/common';

/**
 * Wave 2 — BadgeConditionsService.
 *
 * Чистые функции-проверщики условий выдачи бейджа на основе ContributionSnapshot.
 *
 * Каждый Badge в БД хранит `condition` как Json (например, `{ type: 'ideas_in_dev', threshold: 5 }`).
 * `evaluate(condition, snapshot)` возвращает true если условие выполнено.
 *
 * 5 базовых типов условий:
 *   - ideas_in_dev          — snapshot.ideasInDevelopment >= threshold
 *   - thanks_received       — snapshot.thanksReceived >= threshold
 *   - helpful_comments      — snapshot.helpfulComments >= threshold
 *   - checkin_streak        — snapshot.currentCheckinStreak >= threshold
 *   - goal_alignment        — TODO (требует данных Goal alignment) — пока всегда false.
 *
 * Дизайн: чистые функции (без Prisma) — упрощает unit-тесты.
 */
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
  /** Проверка условия. На неподдерживаемом type → false (no-op). */
  evaluate(
    condition: BadgeCondition | unknown,
    snapshot: ContributionSnapshotForBadge,
  ): boolean {
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
        // TODO: подключить когда появятся данные Goal alignment. Сейчас условие
        //       не выполняется (никто не получит бейдж 'aligned' автоматически).
        return false;
      default:
        return false;
    }
  }

  /** Type-guard для произвольного JSON из `Badge.condition`. */
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
    const thOk =
      typeof obj.threshold === 'number' && Number.isFinite(obj.threshold);
    return typeOk && thOk;
  }
}
