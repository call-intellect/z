'use client';

import { useMemo, useState } from 'react';
import { History as HistoryIcon, Save, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import {
  adminCopyStringsApi,
  COPY_SECTIONS,
  type AdminSettingRowApi,
  type CopySection,
} from '@/api/admin-copy-strings.api';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminSettingHistoryDrawer } from '@/ui/components/admin/AdminSettingHistoryDrawer';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';
import { adminRootCrumb } from '@/ui/components/admin/brand';

const TABS: AdminTabDef[] = [
  { value: 'glossary', label: 'Термины' },
  { value: 'copy-strings', label: 'UI-строки' },
  { value: 'history', label: 'История' },
];

/**
 * `/admin/content/copy` — глоссарий и UI-строки.
 *
 * Записи живут в `AdminSetting` (category='content', section=
 * 'glossary' | 'copy-strings'). value — строка. На бэкенде эти секции
 * могут быть ещё не засеяны (Phase 5 backend ещё в работе) — в этом
 * случае показываем AdminEmpty с подсказкой про bulk-import.
 *
 * Каждая строка редактируется inline через простой Input + кнопка
 * «Сохранить». Используется прямой POST на `/admin/settings/:key`
 * (а не общий хук `useAdminSettingEditor`) — чтобы не плодить 100+ SWR
 * подписок на странице.
 */
export function CopyStringsClient() {
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: 'Контент' },
        { label: 'Глоссарий и UI-строки' },
      ]}
      title="Глоссарий и UI-строки"
      description="Термины Z (Concierge, Кора, Org → «компания»…) и UI-копия. Хранятся в AdminSetting (category=content). Можно править значения inline, история — через выезжающую панель."
    >
      <AdminTabs tabs={TABS} defaultTab="glossary">
        {(active) => {
          if (active === 'history') {
            return (
              <AdminEmpty
                title="История по конкретной строке"
                description="Откройте «История» через карточку записи (кнопка «История» возле каждой строки). Полный аудит super_admin-действий — в /admin/audit."
              />
            );
          }
          const section = active as CopySection;
          return (
            <SectionPanel
              section={section}
              onOpenHistory={(key) => setHistoryKey(key)}
            />
          );
        }}
      </AdminTabs>

      <AdminSettingHistoryDrawer
        settingKey={historyKey}
        open={Boolean(historyKey)}
        onOpenChange={(open) => {
          if (!open) setHistoryKey(null);
        }}
      />
    </AdminSection>
  );
}

function SectionPanel({
  section,
  onOpenHistory,
}: {
  section: CopySection;
  onOpenHistory: (key: string) => void;
}) {
  const q = useAdminQuery(
    `admin-copy-strings:${section}`,
    async () => {
      const items = await adminCopyStringsApi.list(section);
      return { items };
    },
    [section],
  );

  if (q.isLoading) return <AdminLoading rows={5} />;
  if (q.isForbidden) return <AdminForbidden />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data) return null;

  const items = q.data.items;
  if (items.length === 0) {
    return (
      <AdminEmpty
        title={
          section === COPY_SECTIONS.GLOSSARY
            ? 'Терминов пока нет'
            : 'UI-строк пока нет'
        }
        description={
          section === COPY_SECTIONS.GLOSSARY
            ? 'Добавьте через bulk-import из second-brain/13_glossary/ui-glossary.md или создайте записи руками.'
            : 'Добавьте через bulk-import из second-brain/13_glossary/copy-strings.ru.md или создайте записи руками.'
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          title="Импорт из markdown ещё не реализован на бэкенде"
        >
          <Upload size={14} /> Импортировать из second-brain/13_glossary/
          <span className="ml-1 rounded bg-bg-overlay px-1.5 py-0.5 text-[10px]">
            TODO
          </span>
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Key</th>
              <th className="px-3 py-2 text-left">Value</th>
              <th className="px-3 py-2 text-left">Обновлён</th>
              <th className="px-3 py-2 text-left">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <CopyRow
                key={row.key}
                row={row}
                onOpenHistory={() => onOpenHistory(row.key)}
                onSaved={() => q.refetch()}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────── CopyRow ────────────────────────────────────

function CopyRow({
  row,
  onOpenHistory,
  onSaved,
}: {
  row: AdminSettingRowApi;
  onOpenHistory: () => void;
  onSaved: () => void;
}) {
  const initialValue = useMemo(() => coerceToString(row.value), [row.value]);
  const [draft, setDraft] = useState<string>(initialValue);
  const [saving, setSaving] = useState(false);

  const isDirty = draft !== initialValue;

  const handleSave = async () => {
    if (saving || !isDirty) return;
    setSaving(true);
    try {
      await adminCopyStringsApi.set(row.key, draft);
      toast.success(`«${row.key}» сохранено`);
      onSaved();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Не удалось сохранить';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="border-t border-border-subtle align-top hover:bg-bg-overlay">
      <td className="px-3 py-3">
        <code className="rounded bg-bg-overlay px-1.5 py-0.5 text-[11px]">
          {row.key}
        </code>
        {row.description && (
          <p className="mt-1 text-[10px] text-fg-tertiary">{row.description}</p>
        )}
      </td>
      <td className="px-3 py-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="—"
          disabled={saving}
        />
      </td>
      <td className="px-3 py-3 text-xs text-fg-tertiary">
        {new Date(row.updatedAt).toLocaleString('ru-RU')}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            disabled={!isDirty || saving}
            onClick={() => void handleSave()}
          >
            <Save size={14} />
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onOpenHistory}
            title="История"
          >
            <HistoryIcon size={14} />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function coerceToString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
