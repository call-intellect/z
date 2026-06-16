'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { ArrowLeft, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import {
  bitrixApi,
  type BitrixPersonOptionApi,
  type BitrixUserApi,
} from '@/api/bitrix.api';
import { bitrixLinkModeLabel } from '@/domain/bitrix';
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
 * `/company-admin/sources/bitrix/managers` — ручное сопоставление сотрудников
 * Bitrix24 с людьми (Person) Коры. ТЗ 2026-06-17 bitrix24-source-sync, Ф5.
 *
 * Контракт: `GET /bitrix/integration/users` (сотрудники + кандидаты Person),
 * `PATCH /bitrix/integration/users/:externalId/link` (link/unlink/create).
 */

const NONE_VALUE = '__none__';
const CREATE_VALUE = '__create__';

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function linkModeBadgeVariant(
  mode: BitrixUserApi['linkMode'],
): 'default' | 'secondary' | 'outline' {
  if (mode === 'manual') return 'default';
  if (mode === 'auto') return 'secondary';
  return 'outline';
}

export function BitrixManagersClient() {
  return (
    <TierGate feature="feature.bitrix">
      <BitrixManagersContent />
    </TierGate>
  );
}

function BitrixManagersContent() {
  const { data, error, isLoading, mutate } = useSWR(['bitrix-users'], () =>
    bitrixApi.listUsers(),
  );

  const users = data?.users ?? [];
  const personOptions = data?.personCandidates ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-6">
        <Link
          href="/company-admin/sources/bitrix"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg-primary"
        >
          <ArrowLeft size={14} /> К интеграции
        </Link>
        <div className="flex items-center gap-2">
          <Users size={20} className="text-accent" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
              Сотрудники Bitrix24
            </h1>
            <p className="text-sm text-fg-secondary">
              Свяжите сотрудников портала с людьми компании, чтобы Кора верно
              приписывала знания из внутренних переписок.
            </p>
          </div>
        </div>
      </header>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
        </div>
      )}

      {error && !isLoading && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {errMessage(error, 'Не удалось загрузить сотрудников')}
        </div>
      )}

      {!isLoading && !error && users.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-fg-secondary">
              Сотрудников нет — синхронизируйте их на{' '}
              <Link
                href="/company-admin/sources/bitrix"
                className="text-accent hover:underline"
              >
                странице интеграции
              </Link>{' '}
              (кнопка «Сотрудники»).
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && users.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Сотрудники ({users.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {users.map((user) => (
              <UserRow
                key={user.externalId}
                user={user}
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

function UserRow({
  user,
  personOptions,
  onLinked,
}: {
  user: BitrixUserApi;
  personOptions: BitrixPersonOptionApi[];
  onLinked: () => void;
}) {
  const [saving, setSaving] = useState(false);

  const handleChange = async (value: string) => {
    setSaving(true);
    try {
      if (value === CREATE_VALUE) {
        await bitrixApi.linkUser(user.externalId, 'create');
        toast.success('Сотрудник создан и связан');
      } else if (value === NONE_VALUE) {
        await bitrixApi.linkUser(user.externalId, 'unlink');
        toast.success('Связь снята');
      } else {
        await bitrixApi.linkUser(user.externalId, 'link', value);
        toast.success('Связь обновлена');
      }
      onLinked();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'bitrix_user_not_found') {
        toast.error('Сотрудник Bitrix24 не найден');
      } else if (e instanceof ApiError && e.code === 'person_not_found') {
        toast.error('Сотрудник (Person) не найден');
      } else {
        toast.error(errMessage(e, 'Не удалось обновить связь'));
      }
    } finally {
      setSaving(false);
    }
  };

  const displayName = user.name?.trim() || user.email || user.externalId;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-fg-primary">
            {displayName}
          </span>
          <Badge variant={linkModeBadgeVariant(user.linkMode)}>
            {bitrixLinkModeLabel(user.linkMode)}
          </Badge>
          {!user.active && (
            <Badge variant="outline" className="text-fg-tertiary">
              неактивен
            </Badge>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-fg-tertiary">
          {user.email ?? '—'}
          {user.position ? ` · ${user.position}` : ''}
        </div>
        {user.linkedPersonName && (
          <div className="mt-0.5 truncate text-xs text-fg-secondary">
            Сотрудник: {user.linkedPersonName}
          </div>
        )}
      </div>

      {/* Единый селект: связать с человеком / не связывать / создать нового */}
      <div className="flex items-center gap-2 sm:w-72 sm:shrink-0">
        <Select
          value={user.linkedPersonId ?? NONE_VALUE}
          onValueChange={(v) => void handleChange(v)}
          disabled={saving}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Действие" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>— Не связывать —</SelectItem>
            {personOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name?.trim() || p.email || '(без имени)'}
              </SelectItem>
            ))}
            <SelectItem value={CREATE_VALUE}>
              ＋ Создать нового сотрудника
            </SelectItem>
          </SelectContent>
        </Select>
        {saving && <Loader2 size={16} className="animate-spin text-fg-tertiary" />}
      </div>
    </div>
  );
}
