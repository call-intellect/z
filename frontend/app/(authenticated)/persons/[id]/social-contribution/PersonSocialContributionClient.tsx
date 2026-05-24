'use client';

/**
 * `/persons/[id]/social-contribution` — read-only публичный профиль (Specialist 3.8).
 *
 * Что показываем:
 *   - Счётчики по 5 публичным trait-типам.
 *   - Социальные роли + темы экспертизы (если есть).
 *   - Список публичных traits с цитатами (если бэк отдал — он может скрыть
 *     цитаты для member'а, оставив только tag/topic).
 *
 * Чего НЕ показываем:
 *   - Никакой негатив (question_unanswered и т.п.).
 *   - Никакой контрольный score (он отдаётся в DTO, но визуально его как
 *     рейтинг не показываем — это запрещено ТЗ §«Privacy & Ethics»).
 *   - Никаких кнопок «Пометить как ошибку» (это только для self).
 *
 * 403 → пользователь видит сообщение «Профиль доступен только сотруднику и
 * руководителю».
 */

import Link from 'next/link';
import useSWR from 'swr';
import { ArrowLeft, Calendar, ShieldCheck } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { helpfulnessApi } from '@/api/helpfulness.api';
import { useAuth } from '@/contexts/auth-context';
import {
  HELPFULNESS_TRAIT_LABEL,
  HELPFULNESS_TRAIT_SHORT,
  PUBLIC_TRAIT_TYPES,
  mapPersonProfile,
  socialRoleLabel,
  type HelpfulnessTrait,
  type PersonContributionView,
  type PublicHelpfulnessTraitType,
} from '@/domain/helpfulness';
import { Badge } from '@/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

export function PersonSocialContributionClient({
  personId,
}: {
  personId: string;
}) {
  const { currentOrgId, isLoading } = useAuth();

  const swrKey = currentOrgId
    ? ['persons/social-contribution', currentOrgId, personId]
    : null;

  const { data, error, isLoading: loading } = useSWR(
    swrKey,
    async () => {
      const res = await helpfulnessApi.getPersonSocialContribution(personId);
      return mapPersonProfile(res);
    },
    { shouldRetryOnError: false },
  );

  if (isLoading) return null;

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
        <Link
          href={`/persons/${encodeURIComponent(personId)}`}
          className="inline-flex items-center gap-1 text-sm text-fg-tertiary hover:text-fg-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          К карточке сотрудника
        </Link>
        <h1 className="text-2xl font-semibold text-fg-primary">
          Вклад в команду
        </h1>
        <p className="text-sm text-fg-tertiary">
          Публичный профиль социального вклада. Видно сотруднику, его
          руководителю и администратору организации. Только позитивные
          наблюдения — никаких рейтингов и сравнений.
        </p>
      </header>

      {loading && <ProfileSkeleton />}

      {!loading && error && <ErrorPanel error={error} />}

      {!loading && data && <ProfileView view={data} />}
    </section>
  );
}

function ErrorPanel({ error }: { error: unknown }) {
  const isForbidden = error instanceof ApiError && error.code === 'forbidden';
  if (isForbidden) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6 text-sm">
          <p className="font-medium text-fg-primary">Недостаточно прав</p>
          <p className="text-fg-tertiary">
            Профиль социального вклада доступен только самому сотруднику, его
            руководителю и администратору организации. Спросите своего
            руководителя, если этот сотрудник в вашей команде.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-6 text-sm text-danger">
        Не удалось загрузить профиль. Попробуйте обновить страницу.
      </CardContent>
    </Card>
  );
}

function ProfileView({ view }: { view: PersonContributionView }) {
  if (!view.profile) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-fg-tertiary">
          Профиль ещё не сформирован — нужны несколько недель данных.
        </CardContent>
      </Card>
    );
  }

  const profile = view.profile;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-sm text-fg-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <Calendar size={14} />
          Обновлён: {profile.lastBuiltAt.toLocaleString('ru-RU')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck size={14} />
          Версия: {profile.buildVersion}
        </span>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-fg-tertiary">
          За неделю / месяц
        </h2>
        <div className="grid grid-cols-2 gap-3">
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

      {(profile.socialRoles.length > 0 ||
        profile.expertiseTopics.length > 0) && (
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
                <CardTitle className="text-sm">
                  Темы, где сотрудник помогает
                </CardTitle>
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
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-fg-tertiary">
          Публичные наблюдения
        </h2>
        {view.publicTraits.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-fg-tertiary">
              Публичных наблюдений пока нет — они появятся по мере накопления
              сигналов.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {view.publicTraits.slice(0, 10).map((trait) => (
              <TraitCard key={trait.id} trait={trait} />
            ))}
          </ul>
        )}
      </section>
    </>
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
      <CardContent className="space-y-1 p-3">
        <div className="text-xs text-fg-tertiary">
          {HELPFULNESS_TRAIT_SHORT[type]}
        </div>
        <div className="text-xl font-semibold text-fg-primary">{count}</div>
      </CardContent>
    </Card>
  );
}

function TraitCard({ trait }: { trait: HelpfulnessTrait }) {
  const label = trait.publicType
    ? HELPFULNESS_TRAIT_LABEL[trait.publicType]
    : trait.traitType;
  return (
    <li>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{label}</Badge>
            {trait.topicHint && (
              <span className="text-xs text-fg-tertiary">
                · {trait.topicHint}
              </span>
            )}
          </div>
          <p className="text-xs text-fg-tertiary">
            {trait.lastObservedAt.toLocaleString('ru-RU')}
          </p>
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
