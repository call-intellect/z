'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError, humanizeApiError } from '@/api/api-error';
import { gamificationApi } from '@/api/gamification.api';
import {
  contributionFromApi,
  formatRuDate,
  ideasInDevLabel,
  pluralRu,
  streakLabel,
  thanksLabel,
  type Contribution,
  type RecognitionEntry,
  type UserBadgeDomain,
} from '@/domain/contribution';
import { Badge } from '@/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';

/**
 * T1 (2026-05-23) — общий клиентский компонент для `/me/contributions`
 * и `/persons/[id]/contributions`.
 *
 * Если `personId` передан — режим read-only (профиль сотрудника).
 * Если нет — личный профиль, дополнительно показываем opt-out тоггл.
 *
 * Принципы UI (см. ТЗ §«Что НЕ делаем»):
 *   - НЕ показываем рейтинги.
 *   - НЕ показываем штрафы за прерывание стрика.
 *   - НЕ называем людей «лучшими/худшими».
 */
export function ContributionsView({
  personId,
  title,
}: {
  /** Если undefined — режим `/me`. */
  personId?: string;
  /** Заголовок страницы. */
  title: string;
}) {
  const isReadOnly = Boolean(personId);

  const [contribution, setContribution] = useState<Contribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Opt-out state (только для /me).
  const [publicVisible, setPublicVisible] = useState<boolean | null>(null);
  const [optOutSaving, setOptOutSaving] = useState(false);
  const [optOutMsg, setOptOutMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const promise = personId
      ? gamificationApi.getPersonContributions(personId)
      : gamificationApi.getMyContributions();

    promise
      .then((dto) => {
        setContribution(contributionFromApi(dto));
        setError(null);
        setErrorCode(null);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          setError(humanizeApiError(err));
          setErrorCode(err.code);
        } else if (err instanceof Error) {
          setError(humanizeApiError(err));
          setErrorCode(null);
        } else {
          setError('Не удалось загрузить профиль вклада');
          setErrorCode(null);
        }
      })
      .finally(() => setLoading(false));
  }, [personId]);

  useEffect(() => {
    load();
  }, [load]);

  // Загружаем opt-out только для /me.
  useEffect(() => {
    if (isReadOnly) return;
    let cancelled = false;
    gamificationApi
      .getRecognitionOptOut()
      .then((dto) => {
        if (!cancelled) setPublicVisible(dto.publicVisible);
      })
      .catch(() => {
        // не блокируем основную загрузку — просто не показываем тоггл.
      });
    return () => {
      cancelled = true;
    };
  }, [isReadOnly]);

  const toggleOptOut = async () => {
    if (publicVisible === null) return;
    const next = !publicVisible;
    setOptOutSaving(true);
    setOptOutMsg(null);
    try {
      const res = await gamificationApi.setRecognitionOptOut(next);
      setPublicVisible(res.publicVisible);
      setOptOutMsg(
        res.publicVisible
          ? 'Ваши благодарности видны команде'
          : 'Ваши благодарности скрыты от команды',
      );
    } catch (err) {
      setOptOutMsg(
        err instanceof Error ? err.message : 'Не удалось сохранить настройку',
      );
    } finally {
      setOptOutSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-4 text-sm text-fg-secondary">Загрузка…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-4 text-sm text-danger">{error}</p>
        {errorCode === 'forbidden' ? (
          <p className="mt-2 text-sm text-fg-secondary">
            У вас нет прав на просмотр профиля этого сотрудника. Доступно только
            руководителям организации.
          </p>
        ) : null}
      </div>
    );
  }

  if (!contribution) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-4 text-sm text-fg-secondary">Данных пока нет.</p>
      </div>
    );
  }

  const { snapshot, badges, recentRecognitions } = contribution;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-fg-secondary">
          Мягкое признание участия. Никаких рейтингов и штрафов — только ваш
          вклад на этой неделе и за всё время.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SnapshotMetric
          label="Идеи в работе"
          value={snapshot.ideas.inDevelopment}
          hint={ideasInDevLabel(snapshot.ideas.inDevelopment)}
        />
        <SnapshotMetric
          label="Идей доехало до релиза"
          value={snapshot.ideas.shipped}
          hint={pluralRu(snapshot.ideas.shipped, 'идея', 'идеи', 'идей')}
        />
        <SnapshotMetric
          label="Спасибо за неделю"
          value={snapshot.thanksReceivedThisWeek}
          hint={thanksLabel(snapshot.thanksReceivedThisWeek)}
        />
        <SnapshotMetric
          label="Спасибо за всё время"
          value={snapshot.thanksReceivedTotal}
          hint={thanksLabel(snapshot.thanksReceivedTotal)}
        />
      </section>

      <IdeasSection inDev={snapshot.ideas.inDevelopment} shipped={snapshot.ideas.shipped} />

      <ThanksSection
        week={snapshot.thanksReceivedThisWeek}
        total={snapshot.thanksReceivedTotal}
      />

      <StreakSection
        current={snapshot.checkinStreak.current}
        longest={snapshot.checkinStreak.longest}
      />

      <AiRecognitionSection items={recentRecognitions.slice(0, 5)} />

      {badges.length > 0 ? <BadgesSection badges={badges} /> : null}

      {!isReadOnly ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Видимость для команды</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-fg-secondary">
              Если выключить — ваши благодарности и счётчики не попадут в Спотлайт
              команды и дашборды коллег. Свой профиль вы продолжите видеть как
              обычно.
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleOptOut}
                disabled={publicVisible === null || optOutSaving}
                className="rounded-md border border-border bg-bg-card px-4 py-2 text-sm font-medium text-fg-primary hover:bg-bg-overlay disabled:opacity-50"
              >
                {publicVisible === null
                  ? 'Загрузка…'
                  : publicVisible
                    ? 'Скрыть мои благодарности от команды'
                    : 'Показывать мои благодарности команде'}
              </button>
              {optOutMsg ? (
                <span className="text-xs text-fg-secondary">{optOutMsg}</span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ─────────────────────────── Subsections ────────────────────────────────────

function SnapshotMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-5">
        <span className="text-xs uppercase tracking-wide text-fg-secondary">
          {label}
        </span>
        <span className="text-3xl font-semibold text-fg-primary">{value}</span>
        <span className="text-xs text-fg-secondary">{hint}</span>
      </CardContent>
    </Card>
  );
}

function IdeasSection({ inDev, shipped }: { inDev: number; shipped: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Идеи в работе</CardTitle>
      </CardHeader>
      <CardContent>
        {inDev === 0 && shipped === 0 ? (
          <p className="text-sm text-fg-secondary">
            Идей в разработке пока нет — самое время поделиться следующей.
          </p>
        ) : (
          <p className="text-sm text-fg-primary">
            Сейчас в разработке —{' '}
            <strong>{ideasInDevLabel(inDev)}</strong>. Доехало до релиза —{' '}
            <strong>
              {pluralRu(shipped, 'идея', 'идеи', 'идей')}
            </strong>
            . Спасибо за инициативу.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ThanksSection({ week, total }: { week: number; total: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Полученные благодарности</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-fg-primary">
          За неделю — <strong>{thanksLabel(week)}</strong>. За всё время —{' '}
          <strong>{thanksLabel(total)}</strong>.
        </p>
        <p className="mt-2 text-xs text-fg-secondary">
          Без сравнения с коллегами — просто счётчик ваших «спасибо».
        </p>
      </CardContent>
    </Card>
  );
}

function StreakSection({
  current,
  longest,
}: {
  current: number;
  longest: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Стрик чек-инов</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-fg-primary">
          Сейчас — <strong>{streakLabel(current)}</strong>. Лучший результат —{' '}
          <strong>{streakLabel(longest)}</strong>.
        </p>
        <p className="mt-2 text-xs text-fg-secondary">
          Прервали стрик — не беда, начнёте заново без штрафов.
        </p>
      </CardContent>
    </Card>
  );
}

function AiRecognitionSection({ items }: { items: RecognitionEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Благодарности от Коры</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-fg-secondary">
            Пока тихо. Кора шлёт благодарности только когда есть что отметить.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1 rounded-md border border-border-subtle bg-bg-overlay p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default">{r.typeLabel}</Badge>
                  <span className="text-xs text-fg-secondary">
                    {formatRuDate(r.createdAt)}
                  </span>
                </div>
                {r.message ? (
                  <p className="text-sm text-fg-primary">{r.message}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BadgesSection({ badges }: { badges: UserBadgeDomain[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Бейджи</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-wrap gap-3">
          {badges.map((b) => (
            <li
              key={b.id}
              className="flex max-w-xs flex-col gap-1 rounded-md border border-border-subtle bg-bg-overlay p-3"
              title={b.description}
            >
              <span className="text-sm font-medium text-fg-primary">{b.name}</span>
              <span className="text-xs text-fg-secondary">{b.description}</span>
              <span className="text-[10px] text-fg-tertiary">
                Получено {formatRuDate(b.awardedAt)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
