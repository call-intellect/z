'use client';

import { useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { adminEmailTemplatesApi } from '@/api/admin-email-templates.api';
import {
  EMAIL_TEMPLATE_CATEGORY_LABELS,
  emailTemplateListFromApi,
  type EmailTemplateItemDomain,
} from '@/domain/admin-email-template';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';
import { EmailPreviewPanel } from './EmailPreviewPanel';
import { EmailTemplateEditor } from './EmailTemplateEditor';

const TABS: AdminTabDef[] = [
  { value: 'list', label: 'Список' },
  { value: 'editor', label: 'Редактор' },
  { value: 'preview', label: 'Превью' },
  { value: 'test-send', label: 'Тестовое отправление' },
  { value: 'history', label: 'История' },
];

/**
 * `/admin/content/emails` — управление email-шаблонами (Z-Admin Фаза 5).
 *
 * Шаблоны хранятся в БД (`EmailTemplate`), `mail.templates.ts` остаётся как
 * code-fallback. Редактор — inline (textarea + key/value variables),
 * превью — рендер Handlebars-light через `renderEmailPreview` (без тяжёлого
 * runtime'а). Тестовое отправление — POST с email-адресом.
 *
 * Активный шаблон выбирается из списка и шарится между всеми вкладками.
 */
export function EmailTemplatesClient() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const q = useAdminQuery('admin-email-templates', async () => {
    const res = await adminEmailTemplatesApi.list();
    return emailTemplateListFromApi(res);
  });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const it of items) seen.add(it.category);
    return Array.from(seen).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    if (categoryFilter === 'all') return items;
    return items.filter((it) => it.category === categoryFilter);
  }, [items, categoryFilter]);

  const activeTemplate = useMemo<EmailTemplateItemDomain | null>(() => {
    if (!activeKey) return items[0] ?? null;
    return items.find((it) => it.key === activeKey) ?? null;
  }, [items, activeKey]);

  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'Контент' },
        { label: 'Email-шаблоны' },
      ]}
      title="Email-шаблоны"
      description="Тексты транзакционных и маркетинговых писем в БД. Редактор + превью + тестовое отправление. Code-fallback в backend/src/modules/mail/mail.templates.ts."
    >
      {q.isLoading && <AdminLoading rows={6} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && (
        <AdminTabs tabs={TABS} defaultTab="list">
          {(active) => {
            if (active === 'list') {
              return (
                <ListTab
                  items={filteredItems}
                  allCategories={categories}
                  activeKey={activeTemplate?.key ?? null}
                  categoryFilter={categoryFilter}
                  onCategoryFilterChange={setCategoryFilter}
                  onPick={(key) => setActiveKey(key)}
                />
              );
            }
            if (active === 'editor') {
              if (!activeTemplate) {
                return (
                  <AdminEmpty
                    title="Шаблон не выбран"
                    description="Перейдите на вкладку «Список» и выберите шаблон."
                  />
                );
              }
              return (
                <EmailTemplateEditor
                  template={activeTemplate}
                  onSaved={() => {
                    q.refetch();
                  }}
                />
              );
            }
            if (active === 'preview') {
              if (!activeTemplate) {
                return (
                  <AdminEmpty
                    title="Шаблон не выбран"
                    description="Перейдите на вкладку «Список» и выберите шаблон."
                  />
                );
              }
              return <EmailPreviewPanel template={activeTemplate} />;
            }
            if (active === 'test-send') {
              if (!activeTemplate) {
                return (
                  <AdminEmpty
                    title="Шаблон не выбран"
                    description="Перейдите на вкладку «Список» и выберите шаблон."
                  />
                );
              }
              return <TestSendTab template={activeTemplate} />;
            }
            if (active === 'history') {
              return (
                <AdminEmpty
                  title="История не отслеживается"
                  description="У EmailTemplate отдельной таблицы истории нет. Audit-trail super_admin-действий доступен в разделе «Пульс → Журнал super_admin» (/admin/audit)."
                />
              );
            }
            return null;
          }}
        </AdminTabs>
      )}
    </AdminSection>
  );
}

// ──────────────────────────────── ListTab ───────────────────────────────────

function ListTab({
  items,
  allCategories,
  activeKey,
  categoryFilter,
  onCategoryFilterChange,
  onPick,
}: {
  items: EmailTemplateItemDomain[];
  allCategories: string[];
  activeKey: string | null;
  categoryFilter: string;
  onCategoryFilterChange: (next: string) => void;
  onPick: (key: string) => void;
}) {
  if (items.length === 0) {
    return (
      <AdminEmpty
        title="Шаблонов пока нет"
        description="Запустите backend-сидер `bun run seed-admin-settings`, чтобы заполнить EmailTemplate из mail.templates.ts."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-fg-tertiary">Категория:</Label>
        <Select value={categoryFilter} onValueChange={onCategoryFilterChange}>
          <SelectTrigger className="max-w-[260px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            {allCategories.map((c) => (
              <SelectItem key={c} value={c}>
                {EMAIL_TEMPLATE_CATEGORY_LABELS[c] ?? c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Key</th>
              <th className="px-3 py-2 text-left">Тема</th>
              <th className="px-3 py-2 text-left">Категория</th>
              <th className="px-3 py-2 text-left">Обновлён</th>
              <th className="px-3 py-2 text-left">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr
                key={t.key}
                className={`border-t border-border-subtle align-top hover:bg-bg-overlay ${
                  activeKey === t.key ? 'bg-accent/5' : ''
                }`}
              >
                <td className="px-3 py-3">
                  <code className="rounded bg-bg-overlay px-1.5 py-0.5 text-[11px]">
                    {t.key}
                  </code>
                </td>
                <td className="px-3 py-3 font-medium">{t.subject || '—'}</td>
                <td className="px-3 py-3 text-xs">
                  <Badge variant="secondary" className="text-[10px]">
                    {EMAIL_TEMPLATE_CATEGORY_LABELS[t.category] ?? t.category}
                  </Badge>
                </td>
                <td className="px-3 py-3 text-xs text-fg-tertiary">
                  {t.updatedAt.toLocaleString('ru-RU')}
                </td>
                <td className="px-3 py-3">
                  <Button
                    variant={activeKey === t.key ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onPick(t.key)}
                  >
                    {activeKey === t.key ? 'Выбран' : 'Выбрать'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-fg-tertiary">
        Выберите шаблон, затем перейдите на вкладки «Редактор» / «Превью» /
        «Тестовое отправление».
      </p>
    </div>
  );
}

// ────────────────────────────── TestSendTab ─────────────────────────────────

function TestSendTab({ template }: { template: EmailTemplateItemDomain }) {
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (sending) return;
    setError(null);
    const email = to.trim();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
      setError('Введите корректный email-адрес');
      return;
    }
    setSending(true);
    try {
      await adminEmailTemplatesApi.testSend(template.key, email);
      toast.success(`Тестовое письмо отправлено на ${email}`);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Не удалось отправить';
      setError(msg);
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-xl space-y-3 rounded-md border border-border-subtle p-4">
      <header>
        <h3 className="text-sm font-medium">
          Отправить шаблон «{template.key}» на проверку
        </h3>
        <p className="text-xs text-fg-tertiary">
          Бэкенд отправит письмо реальному адресату с mock-значениями для
          переменных (например, {`{{name}}`} → «Получатель»). Используйте свой
          адрес, чтобы убедиться в корректности рендера.
        </p>
      </header>
      <div className="space-y-1">
        <Label htmlFor="test-to">Email получателя</Label>
        <Input
          id="test-to"
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      {error && (
        <p
          className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
      <Button
        type="button"
        size="sm"
        disabled={sending || !to.trim()}
        onClick={() => void handleSend()}
      >
        <Send size={14} />
        {sending ? 'Отправляем…' : 'Отправить себе'}
      </Button>
    </div>
  );
}
