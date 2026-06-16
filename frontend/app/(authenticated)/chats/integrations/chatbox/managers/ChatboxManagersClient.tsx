'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { ArrowLeft, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { chatboxApi } from '@/api/chatbox.api';
import { personsApi } from '@/api/persons.api';
import {
  chatboxLinkModeBadgeVariant,
  mapMember,
  type ChatboxMemberView,
} from '@/domain/chatbox';
import { useAuth } from '@/contexts/auth-context';
import { TierGate } from '@/ui/components/TierGate';
import { Badge } from '@/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

/**
 * `/chats/integrations/chatbox/managers` — ручной маппинг менеджеров Чат бокса
 * на сотрудников (Person) Коры. ТЗ 2026-06-05 chatbox-integration, Фаза 9.
 *
 * Контракт: `GET /chatbox/members`, `PUT /chatbox/members/:id/link`.
 * Список сотрудников для пикера — `personsApi.list` (type=person).
 */

const NONE_VALUE = '__none__';
const CREATE_VALUE = '__create__';

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export function ChatboxManagersClient() {
  return (
    <TierGate feature="feature.chatbox">
      <ChatboxManagersContent />
    </TierGate>
  );
}

function ChatboxManagersContent() {
  const { currentOrgId } = useAuth();

  const {
    data: members,
    error: membersError,
    isLoading: membersLoading,
    mutate,
  } = useSWR(['chatbox-members'], () =>
    chatboxApi.listMembers().then((list) => list.map(mapMember)),
  );

  const { data: persons } = useSWR(
    currentOrgId ? ['org-persons', currentOrgId] : null,
    () => personsApi.list(currentOrgId!, { limit: 200 }),
  );

  // Эндпоинт /persons отдаёт person-card (`name`), а типизирован как entity
  // (`canonicalName`) — берём реальный `name` с фолбэком, чтобы опции не были
  // пустыми (иначе менеджера не с кем связать).
  const personOptions: { id: string; name: string }[] = (
    persons?.items ?? []
  ).map((p) => {
    const raw = p as unknown as { name?: string; canonicalName?: string };
    return { id: p.id, name: raw.name ?? raw.canonicalName ?? '(без имени)' };
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-6">
        <Link
          href="/chats/integrations/chatbox"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg-primary"
        >
          <ArrowLeft size={14} /> К интеграции
        </Link>
        <div className="flex items-center gap-2">
          <Users size={20} className="text-accent" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
              Менеджеры и сотрудники
            </h1>
            <p className="text-sm text-fg-secondary">
              Свяжите менеджеров Чат бокса с сотрудниками компании, чтобы Кора
              верно приписывала знания из переписок.
            </p>
          </div>
        </div>
      </header>

      {membersLoading && (
        <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
        </div>
      )}

      {membersError && !membersLoading && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {errMessage(membersError, 'Не удалось загрузить менеджеров')}
        </div>
      )}

      {!membersLoading && !membersError && members && members.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-fg-secondary">
              Менеджеров нет — синхронизируйте их на{' '}
              <Link
                href="/chats/integrations/chatbox"
                className="text-accent hover:underline"
              >
                странице интеграции
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}

      {!membersLoading && !membersError && members && members.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Менеджеры ({members.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                personOptions={personOptions}
                onLinked={() => void mutate()}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MemberRow({
  member,
  personOptions,
  onLinked,
}: {
  member: ChatboxMemberView;
  personOptions: { id: string; name: string }[];
  onLinked: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await chatboxApi.createMemberPerson(member.id);
      toast.success('Сотрудник создан и связан');
      onLinked();
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.code === 'chatbox_member_already_linked'
      ) {
        toast.error('Менеджер уже связан с сотрудником');
      } else {
        toast.error(errMessage(e, 'Не удалось создать сотрудника'));
      }
    } finally {
      setCreating(false);
    }
  };

  const handleChange = async (value: string) => {
    if (value === CREATE_VALUE) {
      await handleCreate();
      return;
    }
    const personId = value === NONE_VALUE ? null : value;
    setSaving(true);
    try {
      await chatboxApi.linkMember(member.id, personId);
      toast.success('Связь обновлена');
      onLinked();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'chatbox_member_not_found') {
        toast.error('Менеджер не найден');
      } else if (e instanceof ApiError && e.code === 'person_not_found') {
        toast.error('Сотрудник не найден');
      } else {
        toast.error(errMessage(e, 'Не удалось обновить связь'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-fg-primary">
            {member.displayName}
          </span>
          <Badge variant={chatboxLinkModeBadgeVariant(member.linkMode)}>
            {member.linkModeLabel}
          </Badge>
        </div>
        <div className="mt-0.5 truncate text-xs text-fg-tertiary">
          {member.email ?? '—'}
          {member.role ? ` · ${member.role}` : ''}
        </div>
        {member.linkedPersonName && (
          <div className="mt-0.5 truncate text-xs text-fg-secondary">
            Сотрудник: {member.linkedPersonName}
          </div>
        )}
      </div>

      {/* Единый селект: связать с человеком / не связывать / создать нового */}
      <div className="flex items-center gap-2 sm:w-72 sm:shrink-0">
        <Select
          value={member.linkedPersonId ?? NONE_VALUE}
          onValueChange={(v) => void handleChange(v)}
          disabled={saving || creating}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Действие" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>— Не связывать —</SelectItem>
            {personOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
            <SelectItem value={CREATE_VALUE}>
              ＋ Создать нового сотрудника
            </SelectItem>
          </SelectContent>
        </Select>
        {(saving || creating) && (
          <Loader2 size={16} className="animate-spin text-fg-tertiary" />
        )}
      </div>
    </div>
  );
}
