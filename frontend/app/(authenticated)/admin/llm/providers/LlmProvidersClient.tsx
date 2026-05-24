'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, Zap } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { adminLlmProvidersApi } from '@/api/admin-llm-providers.api';
import {
  adminLlmProviderFromApi,
  type AdminLlmProviderDomain,
} from '@/domain/admin-llm-provider';
import { toast } from 'sonner';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

/**
 * SBA α-10 wave 3 — /admin/llm/providers.
 * Список LlmProvider с возможностью запуска smoke-теста.
 */
export function LlmProvidersClient() {
  const [includeInactive, setIncludeInactive] = useState(false);

  const q = useAdminQuery(
    `admin-llm-providers:${includeInactive}`,
    async () => {
      const res = await adminLlmProvidersApi.list({ includeInactive });
      return res.items.map(adminLlmProviderFromApi);
    },
    [includeInactive],
  );

  const handleSmokeTest = async (id: string, name: string) => {
    try {
      const r = await adminLlmProvidersApi.smokeTest(id);
      const message = `${name}: ${r.success ? 'OK' : `провал — ${r.error ?? 'unknown'}`} (${r.durationSeconds.toFixed(2)}s)`;
      if (r.success) toast.success(message);
      else toast.error(message);
      q.refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Ошибка smoke-теста');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">LLM провайдеры</h1>
          <p className="text-sm text-fg-tertiary">
            Реестр LlmProvider: 5 типов протоколов, smoke-тесты, ключи.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Показать неактивные
        </label>
      </div>

      {q.isLoading && <AdminLoading rows={5} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && q.data.length === 0 && (
        <AdminEmpty
          title="Реестр пуст"
          description="Запустите seed: bun run scripts/seed-default-llm-providers-and-models.ts"
        />
      )}
      {!q.isLoading && q.data && q.data.length > 0 && (
        <ProvidersTable items={q.data} onSmokeTest={handleSmokeTest} />
      )}
    </div>
  );
}

function ProvidersTable({
  items,
  onSmokeTest,
}: {
  items: AdminLlmProviderDomain[];
  onSmokeTest: (id: string, name: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-3 py-2 text-left">Имя</th>
            <th className="px-3 py-2 text-left">Отображение</th>
            <th className="px-3 py-2 text-left">Протокол</th>
            <th className="px-3 py-2 text-left">Класс данных</th>
            <th className="px-3 py-2 text-left">Статус</th>
            <th className="px-3 py-2 text-left">Последний smoke-тест</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr
              key={p.id}
              className="border-t border-border-subtle hover:bg-bg-overlay"
            >
              <td className="px-3 py-2 font-mono text-xs">{p.name}</td>
              <td className="px-3 py-2">{p.displayName}</td>
              <td className="px-3 py-2 font-mono text-xs">{p.protocolKind}</td>
              <td className="px-3 py-2">{p.capability}</td>
              <td className="px-3 py-2">
                {p.isActive ? (
                  <Badge variant="default">активен</Badge>
                ) : (
                  <Badge variant="secondary">отключён</Badge>
                )}
              </td>
              <td className="px-3 py-2 text-xs">
                {p.lastSmokeAt ? (
                  <span className="flex items-center gap-1">
                    {p.lastSmokeSuccess ? (
                      <CheckCircle2 size={12} className="text-green-600" />
                    ) : (
                      <XCircle size={12} className="text-red-600" />
                    )}
                    {p.lastSmokeAt.toLocaleString('ru-RU')}
                  </span>
                ) : (
                  <span className="text-fg-tertiary">не запускался</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSmokeTest(p.id, p.name)}
                >
                  <Zap size={12} /> Smoke-тест
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
