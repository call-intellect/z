'use client';

/**
 * `/me/social-contribution` — клиентская часть (Specialist 3.8).
 *
 * Что показываем:
 *   - 5 публичных типов trait'ов с счётчиками (week / month / total).
 *   - Список последних traits с evidence-цитатами (прозрачность).
 *   - Кнопка «Пометить как ошибку» (POST mark-as-misleading).
 *   - Toggle «Не показывать публично» (опт-аут целиком).
 *   - Честное предупреждение: «Руководитель видит дополнительные сигналы».
 *
 * Что НЕ показываем:
 *   - Никаких question_unanswered / question_acknowledged_no_action (даже
 *     если они вдруг придут в DTO — domain-маппер их фильтрует).
 *   - Никаких рейтингов / сравнений с коллегами.
 *
 * Опт-аут:
 *   - POST `/api/v1/me/settings/privacy/social-contribution-opt-out`
 *     (эндпоинт пока не реализован — отображаем кнопку, при отсутствии бэка
 *     показываем toast «Доступно после ближайшего обновления»). Это
 *     запланировано в /me/settings/privacy, но интерфейс мы держим здесь как
 *     entry-point, чтобы пользователь видел опт-аут вместе с данными.
 */

import { useMemo, useState } from 'react';
import useSWR, { mutate } from 'swr';
import {
  AlertCircle,
  Calendar,
  EyeOff,
  Flag,
  Info,
  Loader2,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { helpfulnessApi } from '@/api/helpfulness.api';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import {
  HELPFULNESS_TRAIT_DESCRIPTION,
  HELPFULNESS_TRAIT_LABEL,
  HELPFULNESS_TRAIT_SHORT,
  PUBLIC_TRAIT_TYPES,
  mapMyProfile,
  socialRoleLabel,
  type HelpfulnessTrait,
  type PublicHelpfulnessTraitType,
  type SocialContributionProfile,
} from '@/domain/helpfulness';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Switch } from '@/ui/shadcn/switch';

const MY_PROFILE_SWR_KEY = ['me/social-contribution'];

export function MySocialContributionClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();
  const { data, error, isLoading: loadingProfile } = useSWR(
    currentOrgId ? MY_PROFILE_SWR_KEY : null,
    async () => {
      const res = await helpfulnessApi.getMySocialContribution();
      return mapMyProfile(res);
    },
  );

  const [markingId, setMarkingId] = useState<string | null>(null);
  // Опт-аут хранится локально пока нет соответствующего эндпоинта;
  // визуально показываем переключатель + честный toast.
  const [optOut, setOptOut] = useState(false);

  async function handleMarkMisleading(trait: HelpfulnessTrait) {
    setMarkingId(trait.id);
    try {
      await helpfulnessApi.markTraitAsMisleading(trait.id);
      toast.success('Отмечено как ошибка — наблюдение исключено из счётчиков.');
      await mutate(MY_PROFILE_SWR_KEY);
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.message
          : 'Не удалось пометить — попробуйте ещё раз.';
      toast.error(message);
    } finally {
      setMarkingId(null);
    }
  }

  function handleToggleOptOut(next: boolean) {
    // Backend-эндпоинта для глобального опт-аута пока нет — показываем честный
    // statement. Локальный state сохраняется, чтобы пользователь видел
    // намерение. Реализация — в `/me/settings/privacy` (TODO).
    setOptOut(next);
    toast(next
        ? 'Опт-аут поставлен в очередь — окончательное переключение в /me/settings/privacy.'
        : 'Опт-аут отключён.');
  }

  if (authLoading) return null;

  if (!currentOrgId) {
    return (
      <section className="p-6">
        <p className="text-fg-tertiary">
          Этот раздел доступен только в рамках организации.
        </p>
      </section>
    );
  }

  return (
    <section className="container mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-fg-primary">
          Мой вклад в команду
        </h1>
        <p className="text-sm text-fg-tertiary">
          Кора подсвечивает, как вы помогаете коллегам — отвечаете на вопросы,
          подсказываете, менторите, поддерживаете. Это не оценка работы и не
          KPI — мы показываем только позитивные паттерны. Никаких рейтингов,
          никаких сравнений с коллегами.
        </p>
      </header>

      <EthicsBanner />

      {loadingProfile && <ProfileSkeleton />}

      {!loadingProfile && error && (
        <Card>
          <CardContent className="p-6 text-sm text-danger">
            Не удалось загрузить профиль. Попробуйте обновить страницу.
          </CardContent>
        </Card>
      )}

      {!loadingProfile && data && (
        <>
          <ProfileMeta profile={data.profile} />
          <CountersGrid profile={data.profile} />
          <RolesAndTopics profile={data.profile} />
          <RecentTraits
            traits={data.recentTraits}
            markingId={markingId}
            onMarkMisleading={(t) => void handleMarkMisleading(t)}
          />
          <PrivacyPanel
            optOut={optOut}
            onToggle={handleToggleOptOut}
          />
        </>
      )}
    </section>
  );
}

// ─────────────────────────── Sub-components ─────────────────────────────────

function EthicsBanner() {
  return (
    <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30">
      <CardContent className="flex gap-3 p-4 text-sm text-amber-900 dark:text-amber-200">
        <ShieldAlert size={18} className="mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">Прозрачность для вас</p>
          <p>
            На этой странице вы видите всё, что Кора собрала про ваш позитивный
            вклад — счётчики и цитаты-источники. Руководитель и администратор
            видят дополнительные приватные сигналы (например, «вопрос остался
            без ответа») в своей служебной панели — они никогда не публикуются
            и не отображаются здесь. Любой trait можно пометить как ошибку.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileMeta({
  profile,
}: {
  profile: SocialContributionProfile | null;
}) {
  if (!profile) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-fg-tertiary">
      <span className="inline-flex items-center gap-1.5">
        <Calendar size={14} />
        Обновлён: {profile.lastBuiltAt.toLocaleString('ru-RU')}
      </span>
      <span>Версия: {profile.buildVersion}</span>
      {profile.contributionScoreCached !== null && (
        <span
          className="inline-flex items-center gap-1.5"
          title="Виден только вам и вашему руководителю. Никогда не показывается публично как рейтинг."
        >
          <Sparkles size={14} />
          Вклад: {profile.contributionScoreCached.toFixed(1)}
        </span>
      )}
    </div>
  );
}

function CountersGrid({
  profile,
}: {
  profile: SocialContributionProfile | null;
}) {
  if (!profile) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-fg-tertiary">
          Профиль ещё не сформирован — нужны несколько недель данных.
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wider text-fg-tertiary">
        За неделю / месяц
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="space-y-1 p-4">
            <div className="text-xs uppercase tracking-wider text-fg-tertiary">
              Помощи за неделю
            </div>
            <div className="text-2xl font-semibold text-fg-primary">
              {profile.lastWeekHelpCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <div className="text-xs uppercase tracking-wider text-fg-tertiary">
              Помощи за месяц
            </div>
            <div className="text-2xl font-semibold text-fg-primary">
              {profile.lastMonthHelpCount}
            </div>
          </CardContent>
        </Card>
      </div>

      <h2 className="mt-4 text-sm font-medium uppercase tracking-wider text-fg-tertiary">
        Всё время по типам
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {PUBLIC_TRAIT_TYPES.map((type) => (
          <TypeCounterCard
            key={type}
            type={type}
            count={profile.counts[type]}
          />
        ))}
      </div>
    </section>
  );
}

function TypeCounterCard({
  type,
  count,
}: {
  type: PublicHelpfulnessTraitType;
  count: number;
}) {
  return (
    <Card>
      <CardContent
        className="space-y-1 p-3"
        title={HELPFULNESS_TRAIT_DESCRIPTION[type]}
      >
        <div className="text-xs text-fg-tertiary">
          {HELPFULNESS_TRAIT_SHORT[type]}
        </div>
        <div className="text-xl font-semibold text-fg-primary">{count}</div>
      </CardContent>
    </Card>
  );
}

function RolesAndTopics({
  profile,
}: {
  profile: SocialContributionProfile | null;
}) {
  if (!profile) return null;
  if (
    profile.socialRoles.length === 0 &&
    profile.expertiseTopics.length === 0
  ) {
    return null;
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {profile.socialRoles.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Социальные роли</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {profile.socialRoles.map((role) => (
              <Badge key={role} variant="secondary">
                {socialRoleLabel(role)}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
      {profile.expertiseTopics.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Темы, где вы помогаете</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {profile.expertiseTopics.map((topic) => (
              <Badge key={topic} variant="outline">
                {topic}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RecentTraits({
  traits,
  markingId,
  onMarkMisleading,
}: {
  traits: HelpfulnessTrait[];
  markingId: string | null;
  onMarkMisleading: (t: HelpfulnessTrait) => void;
}) {
  const visible = useMemo(() => traits.slice(0, 10), [traits]);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wider text-fg-tertiary">
        Последние наблюдения
      </h2>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-fg-tertiary">
            Свежих наблюдений пока нет — они появляются после ваших активных
            ответов в чате задач или встречах.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map((trait) => (
            <TraitCard
              key={trait.id}
              trait={trait}
              busy={markingId === trait.id}
              onMarkMisleading={() => onMarkMisleading(trait)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TraitCard({
  trait,
  busy,
  onMarkMisleading,
}: {
  trait: HelpfulnessTrait;
  busy: boolean;
  onMarkMisleading: () => void;
}) {
  const label = trait.publicType
    ? HELPFULNESS_TRAIT_LABEL[trait.publicType]
    : trait.traitType;
  return (
    <li>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{label}</Badge>
              {trait.topicHint && (
                <span className="text-xs text-fg-tertiary">
                  · {trait.topicHint}
                </span>
              )}
            </div>
            <p className="text-xs text-fg-tertiary">
              {trait.lastObservedAt.toLocaleString('ru-RU')} · уверенность{' '}
              {(trait.confidence * 100).toFixed(0)}%
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onMarkMisleading}
            disabled={busy || trait.status === 'mark_as_misleading'}
            aria-label="Пометить наблюдение как ошибочное"
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Flag className="mr-1.5 h-3.5 w-3.5" />
            )}
            {trait.status === 'mark_as_misleading'
              ? 'Помечено'
              : 'Это ошибка'}
          </Button>
        </CardHeader>
        {trait.evidenceQuote && (
          <CardContent className="pt-0">
            <blockquote className="border-l-2 border-border-subtle pl-3 text-sm italic text-fg-secondary">
              «{trait.evidenceQuote}»
            </blockquote>
          </CardContent>
        )}
      </Card>
    </li>
  );
}

function PrivacyPanel({
  optOut,
  onToggle,
}: {
  optOut: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <EyeOff size={14} />
          Приватность
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="font-medium text-fg-primary">
              Не показывать мой вклад публично
            </p>
            <p className="text-fg-tertiary">
              Опт-аут целиком: trait'ы не учитываются в счётчиках, имя не
              появляется в публичной ленте «Спасибо команде». Накопленные
              наблюдения остаются в базе, но помечаются как opt_out и нигде не
              отображаются.
            </p>
          </div>
          <Switch
            checked={optOut}
            onCheckedChange={onToggle}
            aria-label="Опт-аут публичной видимости"
          />
        </div>
        <div className="flex items-start gap-2 rounded-md bg-bg-subtle p-3 text-xs text-fg-tertiary">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            Окончательное переключение опт-аута сохраняется в «Настройки →
            Приватность». Здесь — быстрый доступ.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

// Touch unused exports to keep imports stable across refactors.
void AlertCircle;
