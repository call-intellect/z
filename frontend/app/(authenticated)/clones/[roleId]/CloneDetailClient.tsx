'use client';

/**
 * `/clones/[roleId]` — карточка клона должности (ТЗ 2026-05-26 §3.6).
 *
 * Контент:
 *   - Шапка: CloneAvatar 80px + publicName + статус + bearer + confidence + traits.
 *   - Топ-черт (5-7 шт.) с провенансом.
 *   - Сотрудники на роли (read-only).
 *   - Мои диалоги с этим клоном (читается через useCloneConversations).
 *   - CTA «+ Новый диалог» — создаёт conversation и переходит в чат.
 *
 * Если у пользователя нет grant'а — CTA disabled + предложение запросить.
 *
 * Логика чата (Q/A inline) перенесена в /clones/[roleId]/chat/[conversationId].
 */

import {
  ArrowLeft,
  History,
  Loader2,
  Lock,
  MessageSquare,
  Plus,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';

import { ApiError, humanizeApiError } from '@/api/api-error';
import { clonesApi } from '@/api/clones.api';
import { useAuth } from '@/contexts/auth-context';
import {
  useCloneByRoleId,
  useCloneConversations,
  useMyCloneAccess,
} from '@/hooks/useClones';
import { CloneAvatar } from '@/ui/clones/CloneAvatar';
import { useRegisterBreadcrumb } from '@/ui/components/breadcrumbs/BreadcrumbContext';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { toast } from '@/ui/shadcn/toast';

import { AdminForbidden } from '@app/(admin)/admin/AdminStateViews';

export function CloneDetailClient({ roleId }: { roleId: string }) {
  const { currentOrgId, isLoading } = useAuth();
  if (isLoading) return <DetailSkeleton />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Раздел доступен только внутри организации."
      />
    );
  }
  return <Content orgId={currentOrgId} roleId={roleId} />;
}

function Content({ orgId, roleId }: { orgId: string; roleId: string }) {
  const router = useRouter();
  const { item, isLoading: cloneLoading, error: cloneError } =
    useCloneByRoleId(orgId, roleId);
  const { access } = useMyCloneAccess(orgId);
  const hasGrant = access?.has('role', roleId) ?? false;

  // Role skill profile — для top traits + people.
  const profileSwr = useSWR(['clones:role-skill-profile', orgId, roleId], () =>
    clonesApi.getRoleSkillProfile(orgId, roleId),
  );

  // Мои диалоги с этим клоном (показываем только если hasGrant).
  const conversations = useCloneConversations(orgId, hasGrant ? roleId : null);

  const [creating, setCreating] = useState(false);

  // Хлебные крошки: имя клона из уже загруженных данных (без доп. запроса).
  const profileData = profileSwr.data;
  useRegisterBreadcrumb(
    item || profileData
      ? {
          label:
            item?.publicName ??
            (profileData ? `Клон ${profileData.roleName}` : ''),
        }
      : null,
  );

  async function handleCreateConversation() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await clonesApi.createRoleConversation(orgId, roleId);
      router.push(
        `/clones/${encodeURIComponent(roleId)}/chat/${encodeURIComponent(
          res.conversationId,
        )}`,
      );
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Не удалось создать диалог. Попробуйте ещё раз.';
      toast.error(message);
      setCreating(false);
    }
  }

  async function handleRequestAccess() {
    try {
      await clonesApi.requestAccess(orgId, 'role', roleId);
      toast.success('Запрос отправлен администратору.');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (
        code === 'not_found' ||
        code === 'http_404' ||
        /404/.test(String(code))
      ) {
        toast.message('Функция временно недоступна.', {
          description: 'Попросите администратора выдать доступ вручную.',
        });
      } else {
        toast.error('Не удалось отправить запрос.');
      }
    }
  }

  if (cloneLoading || profileSwr.isLoading) return <DetailSkeleton />;

  if (cloneError || profileSwr.error) {
    const err = cloneError ?? profileSwr.error;
    if (err instanceof ApiError && err.code === 'not_found') {
      return <NotFound />;
    }
    const message =
      humanizeApiError(err, 'Не удалось загрузить клона.');
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <BackLink />
        <div className="mt-4 rounded-md border border-border-subtle bg-bg-card p-6 text-sm">
          <p className="text-error">{message}</p>
        </div>
      </div>
    );
  }

  const profile = profileSwr.data;
  if (!profile) return <NotFound />;
  if (!item && !profile.hasRolePersona) {
    return <NotFound />;
  }

  const headerName = item?.publicName ?? `Клон ${profile.roleName}`;
  const departmentName = item?.departmentName ?? null;
  const bearerName = item?.bearerName ?? null;
  const confidencePct = item?.confidencePct ?? null;
  const lastBuildAt = item?.lastBuildAt ?? null;
  const traitsCount = item?.traitsCount ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
      <BackLink />

      {/* Шапка клона */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3 sm:gap-4">
              <CloneAvatar
                roleName={profile.roleName}
                departmentId={item?.departmentId ?? null}
                size={64}
                className="sm:h-20 sm:w-20"
              />
              <div className="min-w-0">
                <CardTitle className="text-lg sm:text-xl">
                  {headerName}
                </CardTitle>
                <p className="mt-1 text-sm text-fg-secondary">
                  Должность: {profile.roleName}
                  {departmentName ? ` · ${departmentName}` : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {item?.status === 'pending_rebuild' ? (
                <Badge variant="secondary">Клон обновляется</Badge>
              ) : null}
              {!hasGrant ? (
                <Badge variant="outline" className="gap-1">
                  <Lock size={11} />
                  Доступ ограничен
                </Badge>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-fg-secondary">
            <Users size={14} />
            <span>
              {bearerName
                ? `Сейчас на роли: ${bearerName}`
                : 'Носитель не назначен'}
            </span>
          </div>
          {confidencePct !== null ? (
            <div>
              <div className="flex items-center justify-between text-xs text-fg-tertiary">
                <span className="flex items-center gap-1">
                  <Sparkles size={12} />
                  Уверенность клона
                </span>
                <span>{confidencePct}%</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-muted">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${confidencePct}%` }}
                />
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-tertiary">
            {traitsCount !== null ? (
              <span>Активных черт: {traitsCount}</span>
            ) : null}
            {lastBuildAt ? (
              <span>
                Обновлён: {lastBuildAt.toLocaleDateString('ru-RU')}
              </span>
            ) : null}
          </div>

          {/* CTA: + Новый диалог или Запросить доступ */}
          <div className="flex flex-wrap gap-2 pt-2">
            {hasGrant ? (
              <Button
                type="button"
                size="sm"
                onClick={() => void handleCreateConversation()}
                disabled={creating}
              >
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Новый диалог
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleRequestAccess()}
              >
                <Lock className="mr-2 h-4 w-4" />
                Запросить доступ
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/roles/${encodeURIComponent(roleId)}/clone/history`}
              >
                <History className="mr-2 h-4 w-4" />
                История версий
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Мои диалоги (только если hasGrant) */}
      {hasGrant ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4" />
              Мои диалоги с клоном
            </CardTitle>
          </CardHeader>
          <CardContent>
            {conversations.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : conversations.error ? (
              <p className="text-sm text-error">
                Не удалось загрузить список диалогов.
              </p>
            ) : conversations.items.length === 0 ? (
              <p className="text-sm text-fg-secondary">
                У вас пока нет диалогов с этим клоном. Нажмите «Новый диалог»,
                чтобы задать первый вопрос.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {conversations.items.slice(0, 20).map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/clones/${encodeURIComponent(
                        roleId,
                      )}/chat/${encodeURIComponent(c.id)}`}
                      className="flex items-center justify-between gap-2 py-2 text-sm hover:text-accent"
                    >
                      <span className="truncate font-medium">
                        {c.title ?? 'Без названия'}
                      </span>
                      <span className="shrink-0 text-xs text-fg-tertiary">
                        {formatRelativeDate(c.lastMessageAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Топ-черт */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            Топ общих черт
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profile.topTraits.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Пока нет накопленных черт для этой роли — нужны обсуждения подхода
              к решениям на встречах.
            </p>
          ) : (
            <ul className="space-y-3 text-sm">
              {profile.topTraits.slice(0, 7).map((t) => (
                <li key={t.category} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.category}</span>
                    <Badge variant="outline">
                      наблюдений: {t.observationCount}
                    </Badge>
                  </div>
                  <p className="text-fg-secondary">{t.statement}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Сотрудники на роли */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Сотрудники на роли ({profile.people.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profile.people.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              На этой роли пока нет сотрудников с накопленным профилем.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {profile.people.map((p) => (
                <li
                  key={p.personId}
                  className="flex items-center justify-between"
                >
                  <Link
                    href={`/persons/${encodeURIComponent(p.personId)}`}
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    {p.personName}
                  </Link>
                  <span className="text-xs text-fg-tertiary">
                    черт: {p.activeTraitsCount} · v{p.profileBuildVersion}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────── helpers ───────────

function BackLink() {
  return (
    <Link
      href="/clones"
      className="inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-fg-primary"
    >
      <ArrowLeft size={14} />
      Все клоны должностей
    </Link>
  );
}

function NotFound() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12 text-center sm:px-6">
      <p className="text-base text-fg-primary">
        Клон должности не найден.
      </p>
      <p className="mt-2 text-sm text-fg-tertiary">
        Возможно, он был удалён или ещё не собран.
      </p>
      <div className="mt-4">
        <Button asChild variant="outline">
          <Link href="/clones">Все клоны</Link>
        </Button>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/** «сегодня 14:23» / «вчера» / «23 мая» */
export function formatRelativeDate(d: Date): string {
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `сегодня ${d.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const wasYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (wasYesterday) return 'вчера';

  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
