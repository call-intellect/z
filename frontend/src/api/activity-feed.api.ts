import { apiClient } from './api-client';
import type {
  FeedListApi,
  FeedStatus,
  FeedType,
} from '@/domain/activity-feed';

/**
 * REST-клиент ActivityFeed (Pulse §1.8).
 *
 * Бэк: `GET /api/v1/feed/:type` (см. `backend/.../feed.controller.ts`).
 *
 * Параметры:
 *   - status — опц. фильтр статуса (`emitted` / `responded` / …).
 *   - scopedToMe — по умолчанию `false` для дашборда (показываем всё, что
 *     видно tenant'у, а не только адресованное мне).
 *   - teamId / page / limit — стандартная пагинация.
 */
export const activityFeedApi = {
  list: (args: {
    feedType: FeedType;
    status?: FeedStatus;
    limit?: number;
    page?: number;
    scopedToMe?: boolean;
    teamId?: string;
    /**
     * Фильтр «адресовано конкретному User.id». Используется секцией
     * «Вопросы AI этому человеку» на карточке сотрудника
     * (`PersonProbeQuestionsSection`). Работает поверх `scopedToMe`.
     */
    viewedUserId?: string;
  }) => {
    const params = new URLSearchParams();
    if (args.status) params.set('status', args.status);
    if (args.limit !== undefined) params.set('limit', String(args.limit));
    if (args.page !== undefined) params.set('page', String(args.page));
    params.set('scopedToMe', String(args.scopedToMe ?? false));
    if (args.teamId) params.set('teamId', args.teamId);
    if (args.viewedUserId) params.set('viewedUserId', args.viewedUserId);
    const query = params.toString();
    return apiClient.get<FeedListApi>(
      `/api/v1/feed/${encodeURIComponent(args.feedType)}${query ? `?${query}` : ''}`,
    );
  },
};
