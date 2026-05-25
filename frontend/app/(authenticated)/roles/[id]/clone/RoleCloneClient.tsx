'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  ArrowLeft,
  Bot,
  History,
  Loader2,
  RefreshCcw,
  Send,
  Sparkles,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { clonesApi } from '@/api/clones.api';
import { useAuth } from '@/contexts/auth-context';
import {
  mapCloneAnswer,
  mapCloneListItem,
  type CloneAnswer,
  type CloneListUiItem,
} from '@/domain/clone';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Textarea } from '@/ui/shadcn/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/ui/shadcn/tooltip';

import { AdminForbidden } from '../../../admin/AdminStateViews';

/**
 * `/roles/:id/clone` (Clones=Roles Ф4) — детали ролевого клона.
 *
 * Получает список клонов и находит текущий active для этой роли (нет
 * отдельного `byRoleId`-эндпоинта — listClones с фильтром по q даёт всё
 * нужное и легче в reuse). Параллельно тянет `getRoleSkillProfile` для
 * блока traits + people. Бэк-страница `/roles/:id/skill-profile` (legacy)
 * не удаляется — фаза 3 ТЗ оставила её отдельным redirect-кейсом.
 */
export function RoleCloneClient({ roleId }: { roleId: string }) {
  const { currentOrgId, isLoading } = useAuth();
  if (isLoading) return <DetailSkeleton />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Раздел доступен только внутри Org."
      />
    );
  }
  return <Content orgId={currentOrgId} roleId={roleId} />;
}

function Content({ orgId, roleId }: { orgId: string; roleId: string }) {
  // List + filter — берём активную карточку клона этой роли.
  const listSwr = useSWR(
    ['clones-list-for-detail', orgId],
    () =>
      clonesApi.listClones(orgId, {
        status: 'active',
        pageSize: 100,
      }),
    { revalidateOnFocus: false },
  );

  // Role-skill-profile — даёт top traits, людей на роли и hasRolePersona.
  const roleSwr = useSWR(['role-skill-profile', orgId, roleId], () =>
    clonesApi.getRoleSkillProfile(orgId, roleId),
  );

  const cloneItem: CloneListUiItem | null = useMemo(() => {
    const items = listSwr.data?.items ?? [];
    const found = items.find((i) => i.roleId === roleId);
    return found ? mapCloneListItem(found) : null;
  }, [listSwr.data, roleId]);

  // Chat state — повторяет логику RoleSkillProfileClient (ask role).
  const [chatOpen, setChatOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<
    Array<{ id: string; role: 'user' | 'assistant'; text: string; clone?: CloneAnswer }>
  >([]);

  async function handleAsk() {
    const text = question.trim();
    if (text.length < 3) {
      toast.error('Вопрос слишком короткий.');
      return;
    }
    setPending(true);
    const userMessageId = `user-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userMessageId, role: 'user', text },
    ]);
    setQuestion('');
    try {
      const apiRes = await clonesApi.askRole(orgId, roleId, {
        question: text,
        conversationId: conversationId ?? undefined,
      });
      const answer = mapCloneAnswer(apiRes);
      setConversationId(answer.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: answer.messageId,
          role: 'assistant',
          text: answer.text,
          clone: answer,
        },
      ]);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Не удалось получить ответ от клона роли.';
      toast.error(message);
      setMessages((prev) => prev.filter((m) => m.id !== userMessageId));
    } finally {
      setPending(false);
    }
  }

  if (listSwr.isLoading || roleSwr.isLoading) return <DetailSkeleton />;

  if (roleSwr.error || listSwr.error) {
    const err = roleSwr.error ?? listSwr.error;
    const message =
      err instanceof ApiError ? err.message : 'Не удалось загрузить клона роли.';
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <BackLink />
        <div className="mt-4 rounded-md border border-border-subtle bg-bg-card p-6 text-sm">
          <p className="text-error">{message}</p>
        </div>
      </div>
    );
  }

  const profile = roleSwr.data;
  if (!profile) return null;

  const headerName =
    cloneItem?.publicName ?? `Клон ${profile.roleName}`;
  const confidencePct = cloneItem?.confidencePct ?? null;
  const lastBuildAt = cloneItem?.lastBuildAt ?? null;
  const bearerName = cloneItem?.bearerName ?? null;
  const traitsCount = cloneItem?.traitsCount ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-6 py-8">
      <BackLink />

      {/* Шапка клона роли */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-xl">{headerName}</CardTitle>
              <p className="mt-1 text-sm text-fg-secondary">
                Должность: {profile.roleName}
              </p>
            </div>
            {cloneItem ? (
              <Badge variant={cloneItem.status === 'active' ? 'default' : 'secondary'}>
                {cloneItem.status === 'active' ? 'Активен' : 'Архив'}
              </Badge>
            ) : null}
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
              <span>Активных черт в snapshot: {traitsCount}</span>
            ) : null}
            {lastBuildAt ? (
              <span>
                Последнее обновление:{' '}
                {lastBuildAt.toLocaleDateString('ru-RU')}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/roles/${encodeURIComponent(roleId)}/clone/history`}>
                <History className="mr-2 h-4 w-4" />
                История версий
              </Link>
            </Button>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* span-обёртка нужна, чтобы Tooltip работал с disabled-кнопкой. */}
                  <span>
                    <Button variant="outline" size="sm" disabled>
                      <RefreshCcw className="mr-2 h-4 w-4" />
                      Обновить клона
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  TODO: ручной rebuild клона роли — доступно владельцу
                  или администратору (RBAC ещё не реализован).
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>

      {/* Top traits с провенансом */}
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
              {profile.topTraits.map((t) => (
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

      {/* Люди на роли */}
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

      {/* Диалог с клоном */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4" />
            Спросить клона
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-fg-secondary">
            Чат с клоном должности — отвечает в стиле типичного носителя этой
            роли, опираясь на накопленные обсуждения подхода к решениям.
          </p>
          {!profile.hasRolePersona && (
            <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
              Клон роли пока не собран — нужно минимум 2 сотрудника с активным
              профилем. Снапшот собирается воскресенье 06:00.
            </p>
          )}
          {!chatOpen ? (
            <Button
              type="button"
              onClick={() => setChatOpen(true)}
              disabled={!profile.hasRolePersona}
            >
              <Bot className="mr-2 h-4 w-4" />
              Начать диалог
            </Button>
          ) : (
            <div className="space-y-3">
              <ul className="space-y-2">
                {messages.map((m) => (
                  <li key={m.id}>
                    <Card
                      className={
                        m.role === 'user'
                          ? 'ml-auto max-w-[80%]'
                          : 'max-w-[85%]'
                      }
                    >
                      <CardContent className="p-3 text-sm">
                        {m.role === 'assistant' && (
                          <div className="mb-1 flex items-center gap-2 text-xs text-fg-secondary">
                            <Bot className="h-3 w-3" />
                            <span>Клон роли</span>
                            <Badge variant="secondary" className="gap-1">
                              <Sparkles className="h-3 w-3" />в стиле роли
                            </Badge>
                          </div>
                        )}
                        <div className="whitespace-pre-wrap">{m.text}</div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
                {pending && (
                  <li>
                    <Card>
                      <CardContent className="flex items-center gap-2 p-3 text-sm text-fg-secondary">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Клон думает…
                      </CardContent>
                    </Card>
                  </li>
                )}
              </ul>
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Как подходит эта роль к …?"
                rows={3}
                disabled={pending}
              />
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  onClick={() => void handleAsk()}
                  disabled={pending || question.trim().length < 3}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Спросить
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

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

function DetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-6 py-8">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
