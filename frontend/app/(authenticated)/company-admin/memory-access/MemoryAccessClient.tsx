'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Lightbulb } from 'lucide-react';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  adminMemoryAccessApi,
  type MemoryAccessApi,
} from '@/api/admin-memory-access.api';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

/**
 * Настройки доступа к разделам «Памяти компании» (ТЗ 2026-05-26 §6).
 *
 * Owner/admin Org переключает: видят ли рядовые сотрудники (роль `member`)
 * разделы /regulations и /entities. Действия (подтвердить, изменить статус)
 * остаются за manager+ независимо от настроек.
 *
 * Раздел /ideas открыт для всех — переключателя нет, только пояснение.
 */
export function MemoryAccessClient() {
  const { currentOrgRole, isLoading: authLoading } = useAuth();
  const canEdit =
    currentOrgRole === 'owner' || currentOrgRole === 'admin';

  const [data, setData] = useState<MemoryAccessApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<keyof MemoryAccessApi | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dto = await adminMemoryAccessApi.get();
      setData(dto);
    } catch (e) {
      setError(
        humanizeApiError(e, 'Не удалось загрузить настройки'),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canEdit) void load();
  }, [canEdit, load]);

  const update = useCallback(
    async (key: keyof MemoryAccessApi, value: boolean) => {
      setSavingKey(key);
      try {
        const dto = await adminMemoryAccessApi.patch({ [key]: value });
        setData(dto);
        toast.success('Настройки сохранены');
      } catch (e) {
        toast.error(
          humanizeApiError(e, 'Не удалось сохранить'),
        );
      } finally {
        setSavingKey(null);
      }
    },
    [],
  );

  if (authLoading) return <AdminLoading rows={3} />;
  if (!canEdit) {
    return (
      <AdminForbidden
        title="Раздел доступен только администраторам"
        description="Настройки доступа к памяти компании может менять только владелец или администратор организации."
      />
    );
  }
  if (loading) return <AdminLoading rows={3} />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!data) return null;

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          Доступ к разделам «Памяти компании»
        </h1>
        <p className="text-sm text-fg-secondary">
          Решайте, какие разделы видят рядовые сотрудники. По умолчанию
          закрытые разделы доступны только менеджерам и руководителям —
          вы можете открыть их всем.
        </p>
      </header>

      <AccessRow
        title="Правила и стандарты"
        description="Регламенты, процессы, политики и стандарты компании. По умолчанию доступны только менеджерам и руководителям — можно открыть всем, тогда любой сотрудник прочитает правила, но изменить их сможет только менеджер."
        enabled={data.regulationsForMembers}
        saving={savingKey === 'regulationsForMembers'}
        onChange={(v) => void update('regulationsForMembers', v)}
      />

      <AccessRow
        title="Сущности"
        description="Клиенты, проекты, продукты и связи между ними. Откройте всем только если уверены, что участникам нужна эта информация."
        enabled={data.entitiesForMembers}
        saving={savingKey === 'entitiesForMembers'}
        onChange={(v) => void update('entitiesForMembers', v)}
      />

      <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
        <div className="flex items-start gap-3">
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div className="space-y-1">
            <h3 className="font-medium text-fg-primary">Идеи</h3>
            <p className="text-sm text-fg-secondary">
              Идеи доступны всем сотрудникам и не могут быть закрыты — их
              ценность в том, что их видит и поддерживает вся команда.
              Изменять статус идей могут только менеджеры и руководители.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function AccessRow({
  title,
  description,
  enabled,
  saving,
  onChange,
}: {
  title: string;
  description: string;
  enabled: boolean;
  saving: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-medium text-fg-primary">{title}</h3>
          <p className="text-sm text-fg-secondary">{description}</p>
          <p className="text-xs text-fg-tertiary">
            Кто видит:{' '}
            <span className="font-medium text-fg-secondary">
              {enabled ? 'Все участники' : 'Менеджеры и выше'}
            </span>
          </p>
        </div>
        <div className="flex gap-2 sm:flex-col">
          <Button
            type="button"
            size="sm"
            variant={enabled ? 'outline' : 'default'}
            disabled={saving || !enabled}
            onClick={() => onChange(false)}
          >
            Менеджеры и выше
          </Button>
          <Button
            type="button"
            size="sm"
            variant={enabled ? 'default' : 'outline'}
            disabled={saving || enabled}
            onClick={() => onChange(true)}
          >
            Все участники
          </Button>
        </div>
      </div>
    </div>
  );
}
