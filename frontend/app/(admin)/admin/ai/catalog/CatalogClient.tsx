'use client';

/**
 * Фаза 3 редизайна — `/admin/ai/catalog`.
 *
 * Сводит четыре существующих/новых клиента в URL-driven AdminTabs:
 *   - providers — `LlmProvidersClient` (из `/admin/llm/providers`)
 *   - models    — `LlmModelsClient` (из `/admin/llm/models`)
 *   - prices    — `LlmPricesClient` (из `/admin/llm-prices`)
 *   - smoke     — НОВЫЙ `SmokeTestClient`
 *
 * Старые URL редиректят сюда с `?tab=...`.
 */

import { Bot, CircleDollarSign, Plug, Zap } from 'lucide-react';

import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';

import { LlmModelsClient } from '../../llm/models/LlmModelsClient';
import { LlmProvidersClient } from '../../llm/providers/LlmProvidersClient';
import { LlmPricesClient } from '../../llm-prices/LlmPricesClient';
import { SmokeTestClient } from './SmokeTestClient';
import { adminRootCrumb } from '@/ui/components/admin/brand';

const TABS: AdminTabDef[] = [
  { value: 'providers', label: 'Провайдеры', icon: Plug },
  { value: 'models', label: 'Модели', icon: Bot },
  { value: 'prices', label: 'Цены', icon: CircleDollarSign },
  { value: 'smoke', label: 'Smoke-тесты', icon: Zap },
];

export function CatalogClient() {
  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: 'AI и модели' },
        { label: 'Каталог LLM' },
      ]}
      title="Каталог LLM"
      description="Провайдеры, реестр моделей, актуальный прайс и быстрые smoke-проверки."
    >
      <AdminTabs tabs={TABS} defaultTab="providers">
        {(active) => (
          <>
            {active === 'providers' && <LlmProvidersClient />}
            {active === 'models' && <LlmModelsClient />}
            {active === 'prices' && <LlmPricesClient />}
            {active === 'smoke' && <SmokeTestClient />}
          </>
        )}
      </AdminTabs>
    </AdminSection>
  );
}
