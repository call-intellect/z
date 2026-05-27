'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { useAuth } from '@/contexts/auth-context';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { useProjectIntegrationsStatus } from '@/hooks/tracker/useProjectOverview';

interface CardDef {
  key: string;
  title: string;
  description: string;
  status: string;
  ctaLabel: string;
  ctaHref: string;
  visible: boolean;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function IntegrationsClient({ slug }: { slug: string }) {
  const { currentOrgId } = useAuth();
  const { project } = useProjectBySlug(currentOrgId, slug);
  const projectId = project?.id ?? null;
  const { status, isLoading, error } = useProjectIntegrationsStatus(
    currentOrgId,
    projectId,
  );

  const cards = useMemo<CardDef[]>(() => {
    if (!status || !projectId) return [];
    return [
      {
        key: 'import',
        title: 'Импорт задач',
        description: status.lastImport
          ? `Последний импорт: ${status.lastImport.source}, ${fmtDate(status.lastImport.completedAt)}`
          : 'Перенесите задачи из Bitrix24, Trello или Яндекс.Трекера.',
        status: status.lastImport ? 'Был импорт' : 'Не настроено',
        ctaLabel: 'Импортировать',
        ctaHref: `/integrations/import-tracker?projectId=${encodeURIComponent(projectId)}`,
        visible: true,
      },
      {
        key: 'email',
        title: 'Email-to-task',
        description: status.emailToTask.alias
          ? `Адрес для приёма задач: ${status.emailToTask.alias}`
          : 'Создавайте задачи письмом на специальный адрес проекта.',
        status: status.emailToTask.enabled ? 'Активно' : 'Не настроено',
        ctaLabel: 'Настроить',
        ctaHref: `/projects/${encodeURIComponent(slug)}/settings`,
        // Скрываем карточку, если фича недоступна (alias=null AND enabled=false
        // означает, что либо feature не настроена для tenant'а, либо отключена).
        visible: status.emailToTask.enabled || status.emailToTask.alias !== null,
      },
      {
        key: 'telegram',
        title: 'Telegram-уведомления проекта',
        description: status.telegramSubscription.telegramLinked
          ? 'Включите, чтобы получать уведомления в личный Telegram.'
          : 'Привяжите Telegram-аккаунт, чтобы получать уведомления о задачах.',
        status: status.telegramSubscription.isActive ? 'Активно' : 'Не настроено',
        ctaLabel: status.telegramSubscription.telegramLinked
          ? 'Управлять'
          : 'Привязать Telegram',
        ctaHref: '/me/integrations',
        visible: true,
      },
      {
        key: 'webhooks',
        title: 'Webhooks',
        description:
          status.webhooksCount > 0
            ? `Активных webhook'ов: ${status.webhooksCount}.`
            : 'Уведомляйте другую систему о событиях проекта.',
        status: status.webhooksCount > 0 ? 'Активно' : 'Не настроено',
        ctaLabel: 'Добавить webhook',
        ctaHref: `/admin/webhooks?projectId=${encodeURIComponent(projectId)}`,
        visible: true,
      },
      {
        key: 'ai-assistant',
        title: 'AI-помощник проекта',
        description:
          'AI-чат, который знает всё про этот проект — задачи, документы, цели.',
        status: 'Доступно',
        ctaLabel: 'Открыть Concierge',
        ctaHref: `/concierge?scope=project&projectId=${encodeURIComponent(projectId)}`,
        visible: true,
      },
    ];
  }, [status, projectId, slug]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-lg bg-bg-overlay"
          />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-chip-danger-bg bg-chip-danger-bg/20 p-4 text-sm text-chip-danger-fg">
        Не удалось загрузить состояние интеграций.
      </div>
    );
  }
  if (!status) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4 text-sm text-fg-tertiary">
        Нет данных по интеграциям.
      </div>
    );
  }

  const visibleCards = cards.filter((c) => c.visible);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-fg-primary">Приложения</h1>
        <p className="text-sm text-fg-tertiary">
          Интеграции, доступные для этого проекта.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {visibleCards.map((c) => (
          <IntegrationCard key={c.key} card={c} />
        ))}
      </div>
    </div>
  );
}

function IntegrationCard({ card }: { card: CardDef }) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-bg-elevated p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-fg-primary">{card.title}</h3>
        <span className="ml-auto rounded bg-bg-overlay px-2 py-0.5 text-[11px] text-fg-tertiary">
          {card.status}
        </span>
      </div>
      <p className="flex-1 text-sm text-fg-secondary">{card.description}</p>
      <Link
        href={card.ctaHref}
        className="text-sm text-accent hover:underline"
      >
        {card.ctaLabel} →
      </Link>
    </article>
  );
}
