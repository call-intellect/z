'use client';

/**
 * Фаза A.2 — `PromptVersionsTab` — список версий с возможностью активации.
 */

import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';

import {
  adminPromptTemplatesApi,
  type PromptVersionApi,
} from '@/api/admin-prompt-templates.api';
import { ApiError } from '@/api/api-error';
import { useToast } from '@/contexts/toast-context';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

export function PromptVersionsTab({
  templateId,
  versions,
  activeVersionId,
  onActivated,
}: {
  templateId: string;
  versions: PromptVersionApi[];
  activeVersionId: string | null;
  onActivated: () => void;
}) {
  const { addToast } = useToast();
  const [activating, setActivating] = useState<string | null>(null);

  const activate = async (versionId: string) => {
    if (
      !confirm(
        'Активировать эту версию? Все новые встречи начнут использовать её для генерации отчётов.',
      )
    )
      return;
    setActivating(versionId);
    try {
      await adminPromptTemplatesApi.activateVersion(templateId, versionId);
      addToast({ type: 'success', message: 'Версия активирована' });
      onActivated();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Не удалось активировать';
      addToast({ type: 'error', message: msg });
    } finally {
      setActivating(null);
    }
  };

  if (versions.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
        Версий ещё нет. Создайте первую в редакторе.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Версия</th>
            <th className="px-3 py-2 text-left font-medium">Дата</th>
            <th className="px-3 py-2 text-left font-medium">Заметки</th>
            <th className="px-3 py-2 text-right font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => {
            const isActive = v.id === activeVersionId;
            return (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">Версия №{v.versionNumber}</span>
                    {isActive && (
                      <Badge
                        variant="outline"
                        className="border-emerald-200 bg-emerald-50 text-emerald-700"
                      >
                        <CheckCircle2 size={10} className="mr-1" /> Активная
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {new Date(v.createdAt).toLocaleString('ru-RU')}
                </td>
                <td className="px-3 py-2 text-slate-600">{v.notes ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  {isActive ? (
                    <span className="text-xs text-slate-500">текущая</span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => activate(v.id)}
                      disabled={activating === v.id}
                    >
                      {activating === v.id && (
                        <Loader2 size={12} className="mr-1 animate-spin" />
                      )}
                      Активировать
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
