/**
 * API-клиент Specialist 3.8 — Helpfulness Agent (SBA Wave 2).
 *
 * Контракт: `backend/src/modules/specialist-3-8-helpfulness/`.
 *
 * Эндпоинты (user-facing):
 *   - GET  /api/v1/me/social-contribution                              — мой профиль (полная картина)
 *   - GET  /api/v1/persons/:id/social-contribution                     — другой человек (public-traits)
 *   - GET  /api/v1/feed/spotlights?status=&helperUserId=&page=&limit=  — публичная лента «Спасибо команде»
 *   - POST /api/v1/feed/spotlights/:id/approve                         — одобрить (руководитель/admin)
 *   - POST /api/v1/feed/spotlights/:id/hide                            — скрыть
 *   - POST /api/v1/feed/spotlights/:id/republish                       — пере-опубликовать
 *   - POST /api/v1/me/social-contribution/traits/:id/mark-as-misleading — пометить ошибку
 *
 * Эндпоинты (admin — только owner/admin org-level):
 *   - GET  /api/v1/admin/helpfulness/team-map        — карта помощников команды
 *   - GET  /api/v1/admin/helpfulness/unanswered      — ⚠ PRIVATE — приватные негативные сигналы
 *
 * Защита: `CookieAuthGuard + TenantGuard`, RBAC `social_contribution_profile:read`,
 * `helpfulness_spotlight:write`, `helpfulness_trait:write` (для админ-эндпоинтов).
 *
 * Этика (КРИТИЧНО):
 *   - 5 позитивных типов trait'ов (help_provided, proactive_hint, mentoring,
 *     emotional_support, constructive_feedback) — публичны.
 *   - 2 негативных (question_unanswered, question_acknowledged_no_action) —
 *     никогда не возвращаются в /me и /persons/:id, только в /admin/.../unanswered.
 *   - Spotlight публикуется только после ручного одобрения руководителем.
 */

import { apiClient } from './api-client';

// ─────────────────────────── SocialContributionProfile ──────────────────────

export interface SocialContributionProfileApi {
  id: string;
  userId: string;
  helpProvidedCount: number;
  proactiveHintCount: number;
  mentoringCount: number;
  emotionalSupportCount: number;
  expertiseTopics: string[];
  socialRoles: string[];
  lastWeekHelpCount: number;
  lastMonthHelpCount: number;
  /**
   * Сводный «вклад в команду» — виден только владельцу + admin/manager.
   * Никогда не отображается публично как рейтинг.
   */
  contributionScoreCached: number | null;
  buildVersion: number;
  lastBuiltAt: string;
}

// ─────────────────────────── HelpfulnessTrait ───────────────────────────────

export interface HelpfulnessTraitApi {
  id: string;
  /** help_provided | proactive_hint | mentoring | emotional_support | constructive_feedback | ... */
  traitType: string;
  /** 0..1 — насколько ярко проявлено. */
  intensity: number;
  /** О чём была помощь. */
  topicHint: string | null;
  /** Цитата-источник (для прозрачности). */
  evidenceQuote: string | null;
  confidence: number;
  /** public_team | internal | restricted */
  visibility: string;
  lastObservedAt: string;
  /** active | decayed | mark_as_misleading | opt_out */
  status: string;
}

// ─────────────────────────── HelpfulnessSpotlight ───────────────────────────

export type SpotlightStatusApi =
  | 'pending'
  | 'approved'
  | 'published'
  | 'hidden';

export interface HelpfulnessSpotlightApi {
  id: string;
  helperUserId: string;
  /** Имя помощника (резолвится бэком). */
  helperName: string | null;
  topicHint: string | null;
  /** Готовый текст от LLM («Иван 12 раз помог...»). */
  message: string;
  periodFrom: string;
  periodTo: string;
  helpCount: number;
  status: SpotlightStatusApi;
  approvedByUserId: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface ListSpotlightsRequest {
  status?: SpotlightStatusApi;
  helperUserId?: string;
  page?: number;
  limit?: number;
}

export interface ListSpotlightsResponseApi {
  items: HelpfulnessSpotlightApi[];
  total: number;
  page: number;
  limit: number;
}

// ─────────────────────────── Admin DTO ──────────────────────────────────────

export interface TeamHelperRowApi {
  userId: string;
  name: string | null;
  helpProvidedCount: number;
  mentoringCount: number;
  proactiveHintCount: number;
  emotionalSupportCount: number;
  lastWeekHelpCount: number;
  topTopics: string[];
}

export interface UnansweredQuestionRowApi {
  id: string;
  /** Кому не ответили. */
  recipientUserId: string | null;
  recipientName: string | null;
  /** Кто проигнорировал. */
  helperUserId: string;
  helperName: string | null;
  topicHint: string | null;
  evidenceQuote: string | null;
  lastObservedAt: string;
}

// ─────────────────────────── Composed responses ─────────────────────────────

export interface MyProfileResponseApi {
  profile: SocialContributionProfileApi | null;
  recentTraits: HelpfulnessTraitApi[];
}

export interface PersonProfileResponseApi {
  profile: SocialContributionProfileApi | null;
  publicTraits: HelpfulnessTraitApi[];
}

// ─────────────────────────── helpers ────────────────────────────────────────

function buildSpotlightsQuery(req?: ListSpotlightsRequest): string {
  if (!req) return '';
  const p = new URLSearchParams();
  if (req.status) p.set('status', req.status);
  if (req.helperUserId) p.set('helperUserId', req.helperUserId);
  if (req.page) p.set('page', String(req.page));
  if (req.limit) p.set('limit', String(req.limit));
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

// ─────────────────────────── client ─────────────────────────────────────────

export const helpfulnessApi = {
  // ─── Profile ───
  getMySocialContribution: () =>
    apiClient.get<MyProfileResponseApi>('/api/v1/me/social-contribution'),

  getPersonSocialContribution: (personId: string) =>
    apiClient.get<PersonProfileResponseApi>(
      `/api/v1/persons/${encodeURIComponent(personId)}/social-contribution`,
    ),

  // ─── Spotlights feed ───
  getFeedSpotlights: (params?: ListSpotlightsRequest) =>
    apiClient.get<ListSpotlightsResponseApi>(
      `/api/v1/feed/spotlights${buildSpotlightsQuery(params)}`,
    ),

  approveSpotlight: (id: string) =>
    apiClient.post<{ ok: true; spotlight: HelpfulnessSpotlightApi }>(
      `/api/v1/feed/spotlights/${encodeURIComponent(id)}/approve`,
    ),

  hideSpotlight: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/feed/spotlights/${encodeURIComponent(id)}/hide`,
    ),

  republishSpotlight: (id: string) =>
    apiClient.post<{ ok: true; spotlight: HelpfulnessSpotlightApi }>(
      `/api/v1/feed/spotlights/${encodeURIComponent(id)}/republish`,
    ),

  // ─── Mark-as-misleading (owner-only inside service) ───
  markTraitAsMisleading: (traitId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/me/social-contribution/traits/${encodeURIComponent(
        traitId,
      )}/mark-as-misleading`,
    ),

  // ─── Admin ───
  getAdminTeamMap: () =>
    apiClient.get<TeamHelperRowApi[]>('/api/v1/admin/helpfulness/team-map'),

  getAdminUnanswered: () =>
    apiClient.get<UnansweredQuestionRowApi[]>(
      '/api/v1/admin/helpfulness/unanswered',
    ),
};
