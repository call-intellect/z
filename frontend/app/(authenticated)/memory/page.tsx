import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MessageCircle,
  Newspaper,
  ClipboardList,
  Lightbulb,
  AlertTriangle,
  Network,
  Sparkles,
  Table2,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Память',
};

/**
 * ПАМЯТЬ — `/memory` (ТЗ 2026-06-13 «Редизайн кабинета», Ф0/Ф5б).
 *
 * Хаб «3 входа вместо 8 пунктов»: Спросить · Лента Коры · Реестры. На Ф0 —
 * каркас-навигатор по существующим разделам памяти; полноценная «Лента Коры»
 * (переключатель типов + контроль вопросов) и UI поиска по памяти строятся в
 * Ф8.6 / Ф5б.
 */

interface Entry {
  href: string;
  label: string;
  desc: string;
  icon: typeof MessageCircle;
}

const ENTRIES: Entry[] = [
  { href: '/chat', label: 'Спросить', desc: 'Задайте вопрос — Кора ответит из памяти компании со ссылками на источники.', icon: MessageCircle },
  { href: '/feed', label: 'Лента Коры', desc: 'Новости компании с анализом: идеи, сигналы, блокеры, решения и вопросы.', icon: Newspaper },
];

const REGISTRIES: Entry[] = [
  { href: '/decisions', label: 'Решения', desc: 'Журнал ключевых решений', icon: ClipboardList },
  { href: '/regulations', label: 'Правила', desc: 'Регламенты и стандарты', icon: ClipboardList },
  { href: '/themes', label: 'Темы', desc: 'Кластеры обсуждений', icon: Sparkles },
  { href: '/entities', label: 'Сущности', desc: 'Реестр сущностей графа', icon: Network },
  { href: '/tables', label: 'Таблицы', desc: 'Извлечённые данные', icon: Table2 },
  { href: '/ideas', label: 'Идеи', desc: 'Копилка идей команды', icon: Lightbulb },
  { href: '/insights', label: 'Сигналы', desc: 'Закономерности и риски', icon: AlertTriangle },
];

export default function MemoryHubPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">Память</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Всё, что Кора извлекла из встреч и разговоров. Спросите, читайте ленту или откройте реестры.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {ENTRIES.map((e) => {
          const Icon = e.icon;
          return (
            <Link
              key={e.href}
              href={e.href}
              className="group flex flex-col gap-2 rounded-xl border border-border-subtle bg-bg-surface p-5 transition-colors hover:border-accent hover:bg-bg-overlay"
            >
              <span className="flex items-center gap-2 text-base font-medium text-fg-primary">
                <Icon size={18} className="text-accent" />
                {e.label}
              </span>
              <span className="text-sm text-fg-secondary">{e.desc}</span>
            </Link>
          );
        })}
      </div>

      <h2 className="mt-8 mb-3 text-xs font-semibold uppercase tracking-wider text-fg-secondary">
        Реестры
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {REGISTRIES.map((e) => {
          const Icon = e.icon;
          return (
            <Link
              key={e.href}
              href={e.href}
              className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-surface px-4 py-3 transition-colors hover:border-accent hover:bg-bg-overlay"
            >
              <Icon size={16} className="shrink-0 text-fg-tertiary" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-fg-primary">{e.label}</span>
                <span className="block truncate text-xs text-fg-tertiary">{e.desc}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
