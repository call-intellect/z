'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { Calendar, FileText, IdCard, Users } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { documentsApi } from '@/api/documents.api';
import { meetingsApi } from '@/api/meetings.api';
import { meProfileApi, type MyProfileApi } from '@/api/structure.api';
import { useAuth } from '@/contexts/auth-context';
import { Badge } from '@/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
} from '@app/(admin)/admin/AdminStateViews';

import { MyPositionCard } from './MyPositionCard';
import { MyTelegramCard } from './MyTelegramCard';

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

  if (profileSwr.error) {
    if (
      profileSwr.error instanceof ApiError &&
      profileSwr.error.code === 'http_404'
    ) {
      return (
        <div className="mx-auto w-full max-w-4xl px-6 py-8">
          <AdminEmpty
            title="Раздел в разработке"
            description="API личного профиля ещё не подключён."
          />
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminError
          message={
            profileSwr.error instanceof Error
              ? profileSwr.error.message
              : 'Ошибка загрузки'
          }
          onRetry={() => void profileSwr.mutate()}
        />
      </div>
    );
  }

  const profile = profileSwr.data;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <ProfileHeader
        loading={profileSwr.isLoading}
        profile={profile ?? null}
        userName={userName}
      />

      <MyPositionCard orgId={orgId} profile={profile ?? null} />

      <RoleProfileBlock loading={profileSwr.isLoading} profile={profile ?? null} />

      <MyTelegramCard orgId={orgId} />

      <MyDocumentsBlock orgId={orgId} />

      <MyMeetingsBlock />
    </div>
  );
}

function ProfileHeader({
  loading,
  profile,
  userName,
}: {
  loading: boolean;
  profile: MyProfileApi | null;
  userName: string | null;
}) {
  if (loading) {
    return (
      <header className="mb-8">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="mt-2 h-4 w-1/4" />
      </header>
    );
  }
  const name = profile?.person?.fullName ?? userName ?? 'Я';
  const role = profile?.role;
  const department = profile?.department;
  return (
    <header className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
        {name}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-fg-secondary">
        {role ? (
          <Link
            href={`/roles/${encodeURIComponent(role.id)}`}
            className="inline-flex items-center gap-1 hover:text-accent"
          >
            <IdCard size={14} /> {role.name}
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 text-fg-tertiary">
            <IdCard size={14} /> Должность не назначена
          </span>
        )}
        {department && (
          <span className="inline-flex items-center gap-1 text-fg-tertiary">
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
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Моя карта должности</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : !profile?.roleProfile || !profile.roleProfile.summaryCache ? (
          <p className="text-sm text-fg-tertiary">
            Карта формируется. Заполнится автоматически по мере встреч,
            документов и дампов.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {profile.roleProfile.summaryCache.blocks.map((block) => (
              <div key={block.key}>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
                  {block.title ?? BLOCK_TITLES[block.key] ?? block.key}
                </h3>
                {block.items.length === 0 ? (
                  <p className="text-sm text-fg-tertiary">—</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-fg-primary">
                    {block.items.map((it, i) => (
                      <li key={i}>{it}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText size={16} /> Мои документы
        </CardTitle>
      </CardHeader>
      <CardContent>
        {swr.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : swr.error ? (
          <p className="text-sm text-fg-tertiary">
            Список документов недоступен. Попробуйте позже.
          </p>
        ) : (swr.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-fg-tertiary">Документы пока не загружены.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {swr.data!.items.slice(0, 5).map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <Link
                  href={`/documents/${encodeURIComponent(d.id)}`}
                  className="flex-1 truncate text-fg-primary hover:text-accent"
                >
                  {d.name}
                </Link>
                <Badge variant="secondary" className="ml-2 text-[10px]">
                  {documentStatusLabel(d.status)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar size={16} /> Мои встречи
        </CardTitle>
      </CardHeader>
      <CardContent>
        {swr.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : swr.error || !swr.data ? (
          <p className="text-sm text-fg-tertiary">
            Список встреч пока недоступен.
          </p>
        ) : swr.data.items.length === 0 ? (
          <p className="text-sm text-fg-tertiary">Встреч пока нет.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {swr.data.items.slice(0, 5).map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <Link
                  href={`/meetings/${encodeURIComponent(m.id)}/result`}
                  className="flex-1 truncate text-fg-primary hover:text-accent"
                >
                  {m.title}
                </Link>
                <span className="ml-2 text-xs text-fg-tertiary">
                  {formatDate(m.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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
