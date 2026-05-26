'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import { AlertCircle, Calendar, Loader2, ShieldCheck } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { knowledgeCloneApi } from '@/api/knowledge-clone.api';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import {
  mapKnowledgeProfile,
  type KnowledgeProfile,
  type KnowledgeProfileCategory,
} from '@/domain/knowledge-profile';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { SkillsTable } from '@/ui/components/knowledge-profile/SkillsTable';

/**
 * `/me/knowledge-profile` (SBA β-2) — Read-only UI «Что Кора знает обо мне».
 *
 * ТЗ 2026-05-26 §4: вместо списка карточек — компактная таблица скиллов
 * с раскрывающимися строками (SkillsTable). Аккордеон показывает цитаты.
 *
 * Поведение:
 *   - SWR грузит `/api/v1/me/knowledge-profile` в контексте текущей Org.
 *   - Таблица сортируется high → medium → low, внутри уровня по observationCount.
 *   - Кнопка «Неверно» в строке → MarkWrongDialog → POST mark-wrong → toast.
 *   - Кнопка «попробовать своего клона» ведёт на /clones (ТЗ §4: исправили
 *     старый битый /me/clone → /clones).
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
          <SkillsTable
            categories={profile.categories}
            onMarkWrong={(cat) => {
              setActiveMarkCategory(cat);
              setMarkReason('');
            }}
          />

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
            <Link href="/clones">Попробовать клона</Link>
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
          <div className="rounded-md bg-chip-warning-bg p-3 text-sm text-chip-warning-fg">
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
