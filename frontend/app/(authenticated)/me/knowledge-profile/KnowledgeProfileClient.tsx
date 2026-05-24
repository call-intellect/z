'use client';

import { useMemo, useState } from 'react';
import useSWR, { mutate } from 'swr';
import { AlertCircle, Calendar, Flag, Loader2, ShieldCheck } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { knowledgeCloneApi } from '@/api/knowledge-clone.api';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import {
  KNOWLEDGE_PROFILE_CONFIDENCE_LABEL,
  KNOWLEDGE_PROFILE_CONFIDENCE_SHORT,
  mapKnowledgeProfile,
  type KnowledgeProfile,
  type KnowledgeProfileCategory,
} from '@/domain/knowledge-profile';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * `/me/knowledge-profile` (SBA β-2) — Read-only UI «Что Кора знает обо мне».
 *
 * Поведение:
 *   - SWR грузит `/api/v1/me/knowledge-profile` в контексте текущей Org.
 *   - Список категорий с confidence (low/medium/high) и числом наблюдений.
 *   - Под категорией — sampleStatements (1–3 цитаты).
 *   - Кнопка «помечу неверным» → POST mark-wrong → toast.
 *   - Кнопка «попробовать своего клона» — disabled (доступно в γ-1).
 */
export function KnowledgeProfileClient() {
  const { currentOrgId, isLoading } = useAuth();

  const swrKey = currentOrgId ? ['my-knowledge-profile', currentOrgId] : null;
  const { data, error, isLoading: loadingProfile } = useSWR(
    swrKey,
    async () => {
      const res = await knowledgeCloneApi.getMine(currentOrgId!);
      return mapKnowledgeProfile(res);
    },
  );

  const [activeMarkCategory, setActiveMarkCategory] =
    useState<KnowledgeProfileCategory | null>(null);
  const [markReason, setMarkReason] = useState('');
  const [markBusy, setMarkBusy] = useState(false);

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

  async function handleSubmitMark() {
    if (!activeMarkCategory || !currentOrgId) return;
    const reason = markReason.trim();
    if (reason.length < 5) {
      toast.error('Опишите, почему область неверна (минимум 5 символов).');
      return;
    }
    setMarkBusy(true);
    try {
      await knowledgeCloneApi.markWrong(currentOrgId, {
        categoryName: activeMarkCategory.name,
        reason,
      });
      toast.success('Отправлено на проверку администратору.');
      setActiveMarkCategory(null);
      setMarkReason('');
      void mutate(swrKey);
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.message
          : 'Не удалось отправить заявку — попробуйте ещё раз.';
      toast.error(message);
    } finally {
      setMarkBusy(false);
    }
  }

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
        <h1 className="text-2xl font-semibold">Что Кора знает обо мне</h1>
        <p className="text-sm text-muted-foreground">
          Это профиль ваших областей знаний, который Кора собирает из ваших
          встреч и материалов. Профиль пересобирается автоматически — раз в
          несколько часов или после крупных обновлений.
        </p>
      </header>

      {loadingProfile && <ProfileSkeleton />}

      {!loadingProfile && error && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Не удалось загрузить профиль. Попробуйте обновить страницу.
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
              Кора начнёт собирать ваш профиль после нескольких встреч и
              документов. Обычно нужно 10+ материалов с вашим участием.
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
                <CategoryCard
                  category={cat}
                  onMarkWrong={() => {
                    setActiveMarkCategory(cat);
                    setMarkReason('');
                  }}
                />
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

      <Card>
        <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-medium">Попробовать своего клона</p>
            <p className="text-sm text-muted-foreground">
              Чат-режим, где Кора отвечает в моём стиле на основе моих
              reasoning-блоков. Накопится после нескольких встреч с обсуждением
              «почему я так решил».
            </p>
          </div>
          <Button asChild type="button">
            <a href="/me/clone">Попробовать клона</a>
          </Button>
        </CardContent>
      </Card>

      {activeMarkCategory && (
        <MarkWrongDialog
          category={activeMarkCategory}
          reason={markReason}
          busy={markBusy}
          onChangeReason={setMarkReason}
          onCancel={() => {
            if (markBusy) return;
            setActiveMarkCategory(null);
            setMarkReason('');
          }}
          onSubmit={() => void handleSubmitMark()}
        />
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

function CategoryCard({
  category,
  onMarkWrong,
}: {
  category: KnowledgeProfileCategory;
  onMarkWrong: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base">{category.name}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <ConfidenceBadge confidence={category.confidence} />
            <span>Наблюдений: {category.observationCount}</span>
            <span>
              Свежее: {new Date(category.lastObservedAt).toLocaleDateString('ru-RU')}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={onMarkWrong}
        >
          <Flag className="mr-1.5 h-3.5 w-3.5" />
          Помечу неверным
        </Button>
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

function MarkWrongDialog({
  category,
  reason,
  busy,
  onChangeReason,
  onCancel,
  onSubmit,
}: {
  category: KnowledgeProfileCategory;
  reason: string;
  busy: boolean;
  onChangeReason: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle>Пометить как неверное</CardTitle>
          <p className="text-sm text-muted-foreground">
            Область: «{category.name}».
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <p className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Заявка уйдёт администратору на проверку. Профиль не изменится
                автоматически — мы посмотрим вместе с вашим руководителем.
              </span>
            </p>
          </div>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Что не так с этой областью?</span>
            <textarea
              className="min-h-[100px] w-full rounded-md border border-input bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={reason}
              onChange={(e) => onChangeReason(e.target.value)}
              maxLength={2000}
              disabled={busy}
              placeholder="Например: я не занимаюсь этим направлением, или эта область устарела"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={busy}
            >
              Отмена
            </Button>
            <Button type="button" onClick={onSubmit} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Отправить
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader className="space-y-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

void KNOWLEDGE_PROFILE_CONFIDENCE_LABEL;
