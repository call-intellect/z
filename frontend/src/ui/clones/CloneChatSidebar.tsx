'use client';

/**
 * CloneChatSidebar — боковая панель диалогов с клоном (ТЗ §3.7).
 *
 * Используется в `CloneChatClient` двумя путями:
 *   - Desktop (≥ lg): sticky слева 320px.
 *   - Mobile (< lg):  внутри `<Sheet side="left">` (drawer).
 *
 * Контент:
 *   - Header: CloneAvatar + publicName + кнопка «← Назад».
 *   - Большая primary-кнопка «+ Новый диалог».
 *   - Скроллируемый список диалогов (active — подсвечен bg-accent/10).
 *   - Каждый item: title или «Без названия» + относительная дата.
 */

import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import type { ReactElement } from 'react';

import type { CloneConversationUiItem } from '@/domain/clone';
import { Button } from '@/ui/shadcn/button';
import { cn } from '@/ui/shadcn/lib/utils';

import { CloneAvatar } from './CloneAvatar';

export interface CloneChatSidebarProps {
  roleId: string;
  publicName: string;
  /** Если undefined — клон ещё грузится; departmentId влияет на цвет аватара. */
  departmentId?: string | null;
  activeConversationId: string | null;
  conversations: CloneConversationUiItem[];
  isLoading: boolean;
  error: unknown;
  /** Создать новый диалог (родитель сам делает createRoleConversation + push). */
  onCreateConversation: () => void | Promise<void>;
  /** Switch на другой диалог (родитель сам делает router.push). */
  onSelectConversation: (conversationId: string) => void;
  creating?: boolean;
  /** Доп. action в шапке — кнопка «Закрыть» drawer'а на mobile. */
  onClose?: () => void;
}

export function CloneChatSidebar({
  roleId,
  publicName,
  departmentId,
  activeConversationId,
  conversations,
  isLoading,
  error,
  onCreateConversation,
  onSelectConversation,
  creating = false,
  onClose,
}: CloneChatSidebarProps): ReactElement {
  return (
    <aside className="flex h-full w-full flex-col border-r border-border-subtle bg-bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-subtle p-3">
        <Link
          href={`/clones/${encodeURIComponent(roleId)}`}
          className="flex-none rounded p-1.5 text-fg-secondary hover:bg-bg-hover hover:text-fg-primary"
          aria-label="К карточке клона"
          onClick={onClose}
        >
          <ArrowLeft size={16} />
        </Link>
        <CloneAvatar
          roleName={publicName}
          departmentId={departmentId ?? null}
          size={32}
        />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {publicName}
        </h2>
      </div>

      {/* + Новый диалог */}
      <div className="border-b border-border-subtle p-3">
        <Button
          type="button"
          size="sm"
          className="w-full"
          onClick={() => void onCreateConversation()}
          disabled={creating}
        >
          {creating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Новый диалог
        </Button>
      </div>

      {/* Список */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-fg-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-error">
            Не удалось загрузить список диалогов.
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-4 text-sm text-fg-tertiary">
            У вас пока нет диалогов с этим клоном.
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelectConversation(c.id);
                    onClose?.();
                  }}
                  className={cn(
                    'block w-full px-3 py-2.5 text-left text-sm hover:bg-bg-hover',
                    c.id === activeConversationId ? 'bg-accent/10' : '',
                  )}
                >
                  <div className="truncate font-medium text-fg-primary">
                    {c.title ?? 'Без названия'}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-xs text-fg-tertiary">
                    <span>{formatRelativeShort(c.lastMessageAt)}</span>
                    <span>{c.messageCount} сообщ.</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function formatRelativeShort(d: Date): string {
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
