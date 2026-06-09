'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { Calendar, FileText, IdCard, Sparkles, Users } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { listMyChannels } from '@/api/conversational.api';
import { documentsApi } from '@/api/documents.api';
import { meetingsApi } from '@/api/meetings.api';
import { meProfileApi, type MyProfileApi } from '@/api/structure.api';
import { mapTelegramChannelEntry } from '@/domain/me-channels';
import { useAuth } from '@/contexts/auth-context';
import { Skeleton } from '@/ui/shadcn/skeleton';
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
  MODERN_PAGE_BG,
  ModernPageShell,
} from '@/ui/components/dashboard/modern';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
} from '@app/(admin)/admin/AdminStateViews';

import { MyPositionCard } from './MyPositionCard';
import { MyTelegramCard } from './MyTelegramCard';
import { MemoryHelpedMeWidget } from './widgets/MemoryHelpedMeWidget';
import { MyIdeasFateWidget } from './widgets/MyIdeasFateWidget';
import { MyWeeklyPlanFactWidget } from './widgets/MyWeeklyPlanFactWidget';
import { RecognitionInboxWidget } from './widgets/RecognitionInboxWidget';

const BLOCK_TITLES: Record<string, string> = {
  responsibilities: 'Обязанности',
  skills: 'Навыки',
  decision_patterns: 'Решения, которые принимаю',
  common_pitfalls: 'Типичные грабли',
  style_profile: 'Стиль работы',
};

export function MeClient() {
  const { currentOrgId, user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Этот раздел доступен только в рамках Org."
      />
    );
  }
  return <Content orgId={currentOrgId} userName={user?.name ?? null} />;
}

function Content({
  orgId,
  userName,
}: {
  orgId: string;
  userName: string | null;
}) {
  const profileSwr = useSWR(['me-profile', orgId], () =>
    meProfileApi.get(orgId),
  );

  // Тот же SWR-ключ и фетчер, что в MyTelegramCard — SWR дедуплицирует запрос.
  const channelsSwr = useSWR(['me-channels', orgId], async () => {
    const res = await listMyChannels(orgId);
    for (const entry of res.items) {
      const view = mapTelegramChannelEntry(entry);
      if (view) return view;
    }
    return null;
  });

  if (profileSwr.error) {
    if (
      profileSwr.error instanceof ApiError &&
      profileSwr.error.code === 'http_404'
    ) {
      return (
        <div style={{ background: MODERN_PAGE_BG, minHeight: '100vh' }}>
          <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-8">
            <AdminEmpty
              title="Раздел в разработке"
              description="API личного профиля ещё не подключён."
            />
          </div>
        </div>
      );
    }
    return (
      <div style={{ background: MODERN_PAGE_BG, minHeight: '100vh' }}>
        <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-8">
          <AdminError
            message={
              profileSwr.error instanceof Error
                ? profileSwr.error.message
                : 'Ошибка загрузки'
            }
            onRetry={() => void profileSwr.mutate()}
          />
        </div>
      </div>
    );
  }

  const profile = profileSwr.data;

  const tgLinked = channelsSwr.data?.status === 'linked';
  const needPosition = !profileSwr.isLoading && profile?.role == null;
  const needTelegram = !channelsSwr.isLoading && !channelsSwr.error && !tgLinked;
  const showNudge = needPosition || needTelegram;

  // Заголовок shell: пока профиль грузится — нейтральный «Мой кабинет» без
  // подзаголовка (скелетоны имени/должности остаются в теле, в ProfileHeader).
  // После загрузки — имя пользователя в title, «должность · отдел» в subtitle.
  const shellTitle = profileSwr.isLoading
    ? 'Мой кабинет'
    : (profile?.person?.fullName ?? userName ?? 'Мой кабинет');
  const shellSubtitle = profileSwr.isLoading
    ? undefined
    : ([profile?.role?.name, profile?.department?.name]
        .filter(Boolean)
        .join(' · ') || undefined);

  return (
    <ModernPageShell
      maxWidth="max-w-4xl"
      title={shellTitle}
      subtitle={shellSubtitle}
    >
      {showNudge && (
        <ProfileNudgeBanner
          needPosition={needPosition}
          needTelegram={needTelegram}
        />
      )}

      <ProfileHeader
        loading={profileSwr.isLoading}
        profile={profile ?? null}
      />

      <MyPositionCard orgId={orgId} profile={profile ?? null} />

      <RoleProfileBlock loading={profileSwr.isLoading} profile={profile ?? null} />

      <DailyValueSection />

      <MyTelegramCard orgId={orgId} />

      <MyDocumentsBlock orgId={orgId} />

      <MyMeetingsBlock />
    </ModernPageShell>
  );
}

/**
 * ТЗ-2 Ф5 + ТЗ-3 Ф3 — секция «Моя польза за неделю»: 4 виджета ежедневной
 * ценности на современном визуальном языке (стеклянные карточки). Каждый
 * виджет фетчит свои данные сам (SWR) и gracefully показывает empty-state,
 * поэтому шелл `/me` остаётся прежним, а виджеты живут локально в GlassCard.
 */
function DailyValueSection() {
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-base font-semibold tracking-tight text-fg-primary">
        Моя польза за неделю
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MyWeeklyPlanFactWidget />
        <MemoryHelpedMeWidget />
        <MyIdeasFateWidget />
        <RecognitionInboxWidget />
      </div>
    </section>
  );
}

function ProfileNudgeBanner({
  needPosition,
  needTelegram,
}: {
  needPosition: boolean;
  needTelegram: boolean;
}) {
  return (
    <div
      className="mb-6 flex flex-col gap-2 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between"
      style={{
        background: 'oklch(0.66 0.2 300 / 0.1)',
        border: '1px solid oklch(0.66 0.2 300 / 0.3)',
      }}
    >
      <p
        className="flex items-start gap-2 text-sm"
        style={{ color: CHART.dim }}
      >
        <Sparkles
          size={16}
          className="mt-0.5 shrink-0"
          style={{ color: CHART.violet }}
        />
        <span>
          Заполните профиль, чтобы Кора работала точнее
          {needPosition && needTelegram
            ? ': укажите должность и подключите Telegram.'
            : needPosition
              ? ': укажите свою должность.'
              : ': подключите Telegram для уведомлений.'}
        </span>
      </p>
      <div className="flex flex-wrap gap-3 text-sm">
        {needPosition && (
          <Link
            href="#me-card-position"
            className="font-medium hover:underline"
            style={{ color: CHART.violet }}
          >
            Указать должность
          </Link>
        )}
        {needTelegram && (
          <Link
            href="#me-card-telegram"
            className="font-medium hover:underline"
            style={{ color: CHART.violet }}
          >
            Подключить Telegram
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Слим-шапка профиля. Имя и «должность · отдел» вынесены в заголовок
 * `ModernPageShell` (title/subtitle), поэтому здесь — только интерактивные
 * чипы: кликабельная ссылка на должность (`/roles/[id]`) и отдел, плюс
 * loading-скелетон. Это навигация, которой нет в текстовом subtitle.
 */
function ProfileHeader({
  loading,
  profile,
}: {
  loading: boolean;
  profile: MyProfileApi | null;
}) {
  if (loading) {
    return (
      <header className="mb-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="mt-2 h-4 w-1/4" />
      </header>
    );
  }
  const role = profile?.role;
  const department = profile?.department;
  return (
    <header className="mb-6">
      <div
        className="flex flex-wrap items-center gap-3 text-sm"
        style={{ color: CHART.dim }}
      >
        {role ? (
          <Link
            href={`/roles/${encodeURIComponent(role.id)}`}
            className="inline-flex items-center gap-1 hover:underline"
            style={{ color: CHART.text }}
          >
            <IdCard size={14} /> {role.name}
          </Link>
        ) : (
          <span
            className="inline-flex items-center gap-1"
            style={{ color: CHART.faint }}
          >
            <IdCard size={14} /> Должность не назначена
          </span>
        )}
        {department && (
          <span
            className="inline-flex items-center gap-1"
            style={{ color: CHART.faint }}
          >
            <Users size={14} /> {department.name}
          </span>
        )}
      </div>
    </header>
  );
}

function RoleProfileBlock({
  loading,
  profile,
}: {
  loading: boolean;
  profile: MyProfileApi | null;
}) {
  return (
    <div className="mb-6">
      <GlassCard>
        <CardTitle icon={<IdCard size={16} />} grad={GRAD.violet}>
          Моя карта должности
        </CardTitle>
        <div className="mt-4">
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : !profile?.roleProfile || !profile.roleProfile.summaryCache ? (
            <p className="text-sm" style={{ color: CHART.faint }}>
              Карта формируется. Заполнится автоматически по мере встреч,
              документов и дампов.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {profile.roleProfile.summaryCache.blocks.map((block) => (
                <div key={block.key}>
                  <h3
                    className="mb-1 text-xs font-medium uppercase tracking-wider"
                    style={{ color: CHART.faint }}
                  >
                    {block.title ?? BLOCK_TITLES[block.key] ?? block.key}
                  </h3>
                  {block.items.length === 0 ? (
                    <p className="text-sm" style={{ color: CHART.faint }}>
                      —
                    </p>
                  ) : (
                    <ul
                      className="list-disc space-y-1 pl-5 text-sm"
                      style={{ color: CHART.text }}
                    >
                      {block.items.map((it, i) => (
                        <li key={i}>{it}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

function MyDocumentsBlock({ orgId }: { orgId: string }) {
  const swr = useSWR(['me-documents', orgId], () =>
    // Маркер `me` понимает backend (см. backend/src/modules/documents).
    // Если эндпоинт его не поддерживает — список придёт по умолчанию,
    // и мы отрендерим первые 5.
    documentsApi.list(orgId, { uploaderId: 'me' }),
  );
  return (
    <div className="mb-6">
      <GlassCard>
        <CardTitle icon={<FileText size={16} />} grad={GRAD.teal}>
          Мои документы
        </CardTitle>
        <div className="mt-4">
          {swr.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : swr.error ? (
            <p className="text-sm" style={{ color: CHART.faint }}>
              Список документов недоступен. Попробуйте позже.
            </p>
          ) : (swr.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm" style={{ color: CHART.faint }}>
              Документы пока не загружены.
            </p>
          ) : (
            <ul>
              {swr.data!.items.slice(0, 5).map((d, i) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-2 py-3 text-sm"
                  style={
                    i === 0
                      ? undefined
                      : { borderTop: '1px solid oklch(1 0 0 / 0.06)' }
                  }
                >
                  <Link
                    href={`/documents/${encodeURIComponent(d.id)}`}
                    className="flex-1 truncate hover:underline"
                    style={{ color: CHART.text }}
                  >
                    {d.name}
                  </Link>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                    style={{
                      color: documentStatusColor(d.status),
                      background: 'oklch(1 0 0 / 0.06)',
                    }}
                  >
                    {documentStatusLabel(d.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

function MyMeetingsBlock() {
  const swr = useSWR(
    ['me-meetings'],
    async () => {
      // Backend сейчас фильтрует /api/v1/meetings по текущему юзеру
      // (контекст из cookie). Если эндпоинт расширят на participantId — UI
      // переключим. Пока — обычный список.
      return meetingsApi.list({ limit: 5 });
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  return (
    <GlassCard>
      <CardTitle icon={<Calendar size={16} />} grad={GRAD.blue}>
        Мои встречи
      </CardTitle>
      <div className="mt-4">
        {swr.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : swr.error || !swr.data ? (
          <p className="text-sm" style={{ color: CHART.faint }}>
            Список встреч пока недоступен.
          </p>
        ) : swr.data.items.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.faint }}>
            Встреч пока нет.
          </p>
        ) : (
          <ul>
            {swr.data.items.slice(0, 5).map((m, i) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-2 py-3 text-sm"
                style={
                  i === 0
                    ? undefined
                    : { borderTop: '1px solid oklch(1 0 0 / 0.06)' }
                }
              >
                <Link
                  href={`/meetings/${encodeURIComponent(m.id)}/result`}
                  className="flex-1 truncate hover:underline"
                  style={{ color: CHART.text }}
                >
                  {m.title}
                </Link>
                <span
                  className="shrink-0 text-xs"
                  style={{ color: CHART.faint }}
                >
                  {formatDate(m.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}

function documentStatusLabel(status: string): string {
  switch (status) {
    case 'parsed':
      return 'готово';
    case 'parsing':
      return 'обрабатывается';
    case 'uploaded':
      return 'загружено';
    case 'failed':
      return 'ошибка';
    default:
      return status;
  }
}

/** Цвет плашки статуса документа в палитре современного языка. */
function documentStatusColor(status: string): string {
  switch (status) {
    case 'parsed':
      return CHART.mint;
    case 'failed':
      return CHART.red;
    case 'parsing':
    case 'uploaded':
      return CHART.amber;
    default:
      return CHART.dim;
  }
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
