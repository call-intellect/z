'use client';

/**
 * Фаза 3 редизайна — клиентская обёртка `/admin/ai/routing`.
 *
 * Реиспользует существующий `AiModelsClient` из `/admin/ai-models` —
 * там вся бизнес-логика списка task-route-ов. Здесь только добавляем
 * шапку с хлебными крошками через `AdminSection`.
 *
 * URL списка остаётся под `/admin/ai/routing`; детальная страница —
 * `/admin/ai/routing/[taskType]`. Старый `/admin/ai-models/*` ведёт
 * redirect-ами на новый путь.
 */

import { AdminSection } from '@/ui/components/admin/AdminSection';

import { AiModelsClient } from '../../ai-models/AiModelsClient';

export function RoutingClient() {
  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'AI и модели' },
        { label: 'Роутинг моделей' },
      ]}
      title="Роутинг моделей"
      description="Цепочка primary → secondary → tertiary для каждого taskType. Источник дефолтов — playbook §2.1."
    >
      <AiModelsClient />
    </AdminSection>
  );
}
