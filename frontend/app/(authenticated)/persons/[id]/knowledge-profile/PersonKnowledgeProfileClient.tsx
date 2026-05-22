'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ArrowLeft, Calendar, ShieldCheck } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { knowledgeCloneApi } from '@/api/knowledge-clone.api';
import { useAuth } from '@/contexts/auth-context';
import {
  KNOWLEDGE_PROFILE_CONFIDENCE_SHORT,
  mapKnowledgeProfile,
  type KnowledgeProfile,
  type KnowledgeProfileCategory,
} from '@/domain/knowledge-profile';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * Профиль знаний другого Person (без кнопки «помечу неверным»).
 *
 * Член Org видит сводку без цитат; owner/admin/self — с цитатами.
 * Поведение «без цитат» уже обеспечивается на бэке через RBAC-уровень
 * (см. KnowledgeCloneService.serialize).
 */
export function PersonKnowledgeProfileClient({
  personId,
}: {
  personId: string;
}) {
  const { currentOrgId, isLoading } = useAuth();

  const swrKey = currentOrgId
    ? ['knowledge-profile-of-person', currentOrgId, personId]
    : null;
  const { data, error, isLoading: loadingProfile } = useSWR(
    swrKey,
    async () => {
      const res = await knowledgeCloneApi.getByPerson(currentOrgId!, personId);
      return mapKnowledgeProfile(res);
    },
  );

  const profile: KnowledgeProfile | undefined = data ?? undefined;

  const sortedCategories = useMemo(() => {
    if (!profile) return [];
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return [...profile.categories].sort((a, b) => {
      const byConf = order[a.confidence] - order[b.confidence];
      if (byConf !== 0) return byConf;
      return b.observationCount - a.observationCount;
    });
  }, [profile]);

  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <section className="p-6">
        <p className="text-muted-foreground">
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
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          К карточке сотрудника
        </Link>
        <h1 className="text-2xl font-semibold">
          {profile ? `Профиль знаний: ${profile.personName}` : 'Профиль знаний'}
        </h1>
        <p className="text-sm text-muted-foreground">
          Области экспертизы, которые Кора собрала из встреч и материалов.
        </p>
      </header>

      {loadingProfile && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader className="space-y-2">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {!loadingProfile && error && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            {error instanceof ApiError && error.code === 'person_not_found'
              ? 'Сотрудник не найден.'
              : 'Не удалось загрузить профиль. Попробуйте обновить страницу.'}
          </CardContent>
        </Card>
      )}

      {!loadingProfile && profile && profile.isEmpty && (
        <Card>
          <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              Профиль ещё не сформирован.
            </p>
            <p>
              У этого сотрудника пока мало материалов, чтобы Кора собрала
              профиль. После 10+ упоминаний на встречах и в документах профиль
              появится автоматически.
            </p>
          </CardContent>
        </Card>
      )}

      {!loadingProfile && profile && !profile.isEmpty && (
        <>
          <ProfileMeta profile={profile} />
          <ul className="space-y-4">
            {sortedCategories.map((cat) => (
              <li key={cat.name}>
                <CategoryCard category={cat} />
              </li>
            ))}
          </ul>
          {profile.experienceHighlights.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Значимый опыт</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {profile.experienceHighlights.map((h, idx) => (
                  <p key={idx}>• {h.summary}</p>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!loadingProfile && profile && profile.isSelf && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-4 text-sm">
            <span className="text-muted-foreground">
              Это ваш профиль — управлять им можно на отдельной странице.
            </span>
            <Link href="/me/knowledge-profile">
              <Button variant="outline" size="sm">
                Перейти к своему профилю
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function ProfileMeta({ profile }: { profile: KnowledgeProfile }) {
  const builtAt = profile.builtAt
    ? profile.builtAt.toLocaleString('ru-RU')
    : '—';
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Calendar className="h-4 w-4" />
        Обновлён: {builtAt}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <ShieldCheck className="h-4 w-4" />
        Версия: {profile.version}
      </span>
      <span>Областей: {profile.categories.length}</span>
    </div>
  );
}

function CategoryCard({ category }: { category: KnowledgeProfileCategory }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{category.name}</CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ConfidenceBadge confidence={category.confidence} />
          <span>Наблюдений: {category.observationCount}</span>
          <span>
            Свежее: {new Date(category.lastObservedAt).toLocaleDateString('ru-RU')}
          </span>
        </div>
      </CardHeader>
      {category.sampleStatements.length > 0 && (
        <CardContent className="space-y-2 text-sm">
          {category.sampleStatements.map((s, idx) => (
            <blockquote
              key={`${s.blockId}-${idx}`}
              className="border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground"
            >
              «{s.quote}»
            </blockquote>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function ConfidenceBadge({
  confidence,
}: {
  confidence: KnowledgeProfileCategory['confidence'];
}) {
  const variant =
    confidence === 'high'
      ? 'default'
      : confidence === 'medium'
        ? 'secondary'
        : 'outline';
  return (
    <Badge variant={variant} className="capitalize">
      {KNOWLEDGE_PROFILE_CONFIDENCE_SHORT[confidence]}
    </Badge>
  );
}
