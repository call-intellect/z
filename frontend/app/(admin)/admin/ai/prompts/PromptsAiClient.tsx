'use client';

/**
 * Фаза 3 редизайна — `/admin/ai/prompts`.
 *
 * Обёртка над списком промптов с URL-driven вкладками:
 *   - list      — реиспользует `PromptsListClient` (старый `/admin/prompts`)
 *   - versions  — placeholder: версии доступны на странице конкретного промпта
 *   - ab        — реиспользует `PromptExperimentsListClient` (старый
 *                 `/admin/prompts/experiments`)
 *   - feedback  — placeholder под Фазу 9
 */

import { FlaskConical, History, ListTree, MessageSquareHeart } from 'lucide-react';

import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';

import { AdminEmpty } from '../../AdminStateViews';
import { PromptsListClient } from '../../prompts/PromptsListClient';
import { PromptExperimentsListClient } from '../../prompts/experiments/PromptExperimentsListClient';
import { adminRootCrumb } from '@/ui/components/admin/brand';

const TABS: AdminTabDef[] = [
  { value: 'list', label: 'Список', icon: ListTree },
  { value: 'versions', label: 'Версии', icon: History },
  { value: 'ab', label: 'A/B', icon: FlaskConical },
  { value: 'feedback', label: 'Feedback', icon: MessageSquareHeart },
];

export function PromptsAiClient() {
  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: 'AI и модели' },
        { label: 'Промпты' },
      ]}
      title="Промпты"
      description="Конструктор системных и пользовательских промптов, версионирование и A/B-эксперименты."
    >
      <AdminTabs tabs={TABS} defaultTab="list">
        {(active) => (
          <>
            {active === 'list' && <PromptsListClient />}
            {active === 'versions' && (
              <AdminEmpty
                title="Версии — на странице промпта"
                description="История версий и diff доступны при открытии конкретного шаблона из вкладки «Список»."
              />
            )}
            {active === 'ab' && <PromptExperimentsListClient />}
            {active === 'feedback' && (
              <AdminEmpty
                title="Feedback по промптам"
                description="Подключение фидбека и сводки оценок будет в Фазе 9."
              />
            )}
          </>
        )}
      </AdminTabs>
    </AdminSection>
  );
}
