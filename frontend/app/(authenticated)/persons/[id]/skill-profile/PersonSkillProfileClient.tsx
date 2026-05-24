'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Brain, Calendar, Flag, History, Loader2, ShieldCheck } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { clonesApi, type SkillProfileApi, type SkillTraitApi } from '@/api/clones.api';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Textarea } from '@/ui/shadcn/textarea';

const CONFIDENCE_LABEL: Record<string, string> = {
  low: 'низкая',
  medium: 'средняя',
  high: 'высокая',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'активен',
  archived: 'в архиве',
  paused_relationship: 'приостановлен (не сотрудник)',
};

/**
 * `/persons/:id/skill-profile` (SBA γ-1) — UI для manager'а / admin'а / self.
 *
 * Поведение:
 *   - SWR грузит профиль (traits + persona snapshots history).
 *   - Под каждой trait — кнопка «помечу неверным» (только если canMarkMisleading).
 *   - Кнопка «попробовать клона» → /me/clone (для self) или /clones/persons/:id (для manager).
 */
export function PersonSkillProfileClient({ personId }: { personId: string }) {
  const { currentOrgId, isLoading } = useAuth();
  const { addToast } = useToast();
  const [markingTraitId, setMarkingTraitId] = useState<string | null>(null);
  const [markReason, setMarkReason] = useState('');
  const [markBusy, setMarkBusy] = useState(false);

  const swrKey = currentOrgId ? ['person-skill-profile', currentOrgId, personId] : null;
  const { data, error, isLoading: loading } = useSWR(swrKey, async () =>
    clonesApi.getPersonSkillProfile(currentOrgId!, personId),
  );

  async function handleMarkSubmit() {
    if (!markingTraitId || !currentOrgId) return;
    const reason = markReason.trim();
    if (reason.length < 5) {
      addToast({
        type: 'error',
        message: 'Опишите, почему черта неверна (минимум 5 символов).',
      });
      return;
    }
    setMarkBusy(true);
    try {
      await clonesApi.markTraitMisleading(currentOrgId, markingTraitId, { reason });
      addToast({
        type: 'success',
        message: 'Черта помечена как неверная. Спасибо за обратную связь.',
      });
      setMarkingTraitId(null);
      setMarkReason('');
      if (swrKey) await mutate(swrKey);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.payload?.message ?? err.message
          : 'Не удалось пометить черту неверной.';
      addToast({ type: 'error', message });
    } finally {
      setMarkBusy(false);
    }
  }

  if (isLoading || loading) {
    return (
      <section className="space-y-4 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="p-4">
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Не удалось загрузить навыковый профиль. Возможно, у вас нет доступа.
          </CardContent>
        </Card>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section className="space-y-4 p-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Навыковый профиль: {data.personName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Эмерджентные черты подхода к решениям, наблюдаемые в reasoning-блоках.
          Формулировки — гипотезные («похоже»/«склонен»/«в большинстве случаев»).
        </p>
        <ProfileMeta profile={data} />
      </div>

      {data.isEmpty && (
        <Card>
          <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              Профиль ещё не сформирован.
            </p>
            <p>
              Кора начнёт собирать профиль после нескольких встреч с обсуждением
              «почему я так решил». Обычно нужно 5–10 таких эпизодов.
            </p>
          </CardContent>
        </Card>
      )}

      {!data.isEmpty && (
        <div className="space-y-6">
          {groupTraitsByCategory(data.traits).map(({ category, traits }) => (
            <div key={category} className="space-y-2">
              <h2 className="text-base font-semibold text-foreground">
                {category}
              </h2>
              <ul className="space-y-3">
                {traits.map((t) => (
                  <li key={t.id}>
                    <TraitCard
                      trait={t}
                      canMark={data.canMarkMisleading}
                      onMarkClick={() => {
                        setMarkingTraitId(t.id);
                        setMarkReason('');
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {data.personaSnapshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              История снапшотов персоны
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {data.personaSnapshots.map((s) => (
                <li key={s.id}>
                  v{s.version} — {new Date(s.snapshotAt).toLocaleString('ru-RU')} ·
                  {' '}черт: {s.builtFromTraitsCount} · {s.status === 'active' ? 'активна' : 'заменена'}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {markingTraitId && (
        <MarkMisleadingDialog
          reason={markReason}
          busy={markBusy}
          onChangeReason={setMarkReason}
          onCancel={() => {
            if (markBusy) return;
            setMarkingTraitId(null);
            setMarkReason('');
          }}
          onSubmit={() => void handleMarkSubmit()}
        />
      )}
    </section>
  );
}

function ProfileMeta({ profile }: { profile: SkillProfileApi }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Brain className="h-4 w-4" />
        Статус: {STATUS_LABEL[profile.status] ?? profile.status}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <ShieldCheck className="h-4 w-4" />
        Версия сборки: {profile.buildVersion}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Calendar className="h-4 w-4" />
        {profile.lastBuildAt
          ? `Собран: ${new Date(profile.lastBuildAt).toLocaleString('ru-RU')}`
          : 'Ещё не собирался'}
      </span>
    </div>
  );
}

/**
 * SBA γ-1 доделки — группировка traits по `category` (frontend-side).
 * Категории сортируются по алфавиту; traits внутри категории — по
 * confidence DESC, потом по lastConfirmedAt DESC. Пустая категория
 * («Без категории») всегда последняя.
 */
const CONFIDENCE_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function groupTraitsByCategory(traits: SkillTraitApi[]): Array<{
  category: string;
  traits: SkillTraitApi[];
}> {
  const NO_CATEGORY = 'Без категории';
  const buckets = new Map<string, SkillTraitApi[]>();
  for (const t of traits) {
    const key = (t.category && t.category.trim()) || NO_CATEGORY;
    const list = buckets.get(key);
    if (list) list.push(t);
    else buckets.set(key, [t]);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => {
      const ca = CONFIDENCE_ORDER[a.confidence] ?? 9;
      const cb = CONFIDENCE_ORDER[b.confidence] ?? 9;
      if (ca !== cb) return ca - cb;
      return (
        new Date(b.lastConfirmedAt).getTime() -
        new Date(a.lastConfirmedAt).getTime()
      );
    });
  }
  const named = [...buckets.entries()]
    .filter(([k]) => k !== NO_CATEGORY)
    .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
    .map(([category, traits]) => ({ category, traits }));
  if (buckets.has(NO_CATEGORY)) {
    named.push({
      category: NO_CATEGORY,
      traits: buckets.get(NO_CATEGORY)!,
    });
  }
  return named;
}

function TraitCard({
  trait,
  canMark,
  onMarkClick,
}: {
  trait: SkillTraitApi;
  canMark: boolean;
  onMarkClick: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base">{trait.category}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">
              уверенность: {CONFIDENCE_LABEL[trait.confidence] ?? trait.confidence}
            </Badge>
            <span>наблюдений: {trait.observationCount}</span>
            <span>
              последнее: {new Date(trait.lastConfirmedAt).toLocaleDateString('ru-RU')}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed">{trait.statement}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Скрыть источники' : `Источники (${trait.sourceBlockIds.length})`}
          </Button>
          {canMark && (
            <Button type="button" variant="ghost" size="sm" onClick={onMarkClick}>
              <Flag className="mr-1 h-3 w-3" />
              Помечу неверным
            </Button>
          )}
        </div>
        {expanded && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {trait.sourceBlockIds.map((id) => (
              <li key={id}>
                <a
                  className="underline hover:text-foreground"
                  href={`/cards/block/${id}`}
                >
                  block {id.slice(0, 8)}…
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MarkMisleadingDialog({
  reason,
  busy,
  onChangeReason,
  onCancel,
  onSubmit,
}: {
  reason: string;
  busy: boolean;
  onChangeReason: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Пометить черту неверной</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Опишите, почему эта черта не отражает реальное поведение сотрудника.
            Куратор использует обоснование для тюна промпта.
          </p>
          <Textarea
            value={reason}
            onChange={(e) => onChangeReason(e.target.value)}
            placeholder="Например: «На самом деле он редко так делает — это была единичная ситуация»."
            rows={4}
            disabled={busy}
          />
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
              Отмена
            </Button>
            <Button type="button" disabled={busy} onClick={onSubmit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Пометить неверной'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
