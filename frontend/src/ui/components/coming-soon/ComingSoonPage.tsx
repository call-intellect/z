'use client';

/**
 * `ComingSoonPage` — единый компонент для disabled-γ-разделов (Фаза 0c §6.7).
 *
 * Используется на preview-страницах четырёх будущих разделов:
 *   - `/processes` — Процессы
 *   - `/regulations` — Регламенты
 *   - `/policies` — Политики
 *   - `/metrics` — Метрики
 *
 * Поведение (см. §6.7 и §7.7 аналитики):
 *   - Title + description — всегда.
 *   - Счётчик «N собрано» — только для admin/owner/super_admin И только
 *     если N > 0. На ошибке (403 / 404 / 500) счётчик молча скрывается.
 *
 * Запрос счётчика выполняется через единый `apiClient`. Если backend
 * endpoint ещё не реализован — SWR словит ошибку, счётчик не отрисуется,
 * остальная страница рабочая.
 */

import { Clock4 } from 'lucide-react';
import useSWR from 'swr';

import { apiClient } from '@/api/api-client';
import { useAuth } from '@/contexts/auth-context';
import { Card, CardContent } from '@/ui/shadcn/card';

export type SectionKey = 'processes' | 'regulations' | 'policies' | 'metrics';

type SectionConfig = {
  title: string;
  description: string;
  countApi: string;
  /** Возвращает строку «N процессов» / «1 процесс» / «5 политик» и т.д. */
  countLabel: (n: number) => string;
};

/**
 * Русская плюрализация по 3 формам.
 *
 *   declension(1, ['процесс', 'процесса', 'процессов']) === 'процесс'
 *   declension(2, [...])                                === 'процесса'
 *   declension(5, [...])                                === 'процессов'
 *   declension(21, [...])                               === 'процесс'
 *
 * Алгоритм — стандартный для русского: смотрим на остатки от 100 и 10.
 */
export function declension(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

const SECTIONS: Record<SectionKey, SectionConfig> = {
  processes: {
    title: 'Процессы',
    description:
      'Сборка бизнес-процессов из встреч и документов появится в следующей фазе. Мы уже копим данные.',
    countApi: '/api/v1/processes/count',
    countLabel: (n) =>
      `${n} ${declension(n, ['процесс', 'процесса', 'процессов'])}`,
  },
  regulations: {
    title: 'Регламенты',
    description:
      'Регламенты и стандарты компании появятся в следующей фазе. Уже сейчас извлекаем их из загруженных документов.',
    countApi: '/api/v1/regulations/count',
    countLabel: (n) =>
      `${n} ${declension(n, ['регламент', 'регламента', 'регламентов'])}`,
  },
  policies: {
    title: 'Политики',
    description:
      'Политики и правила работы появятся в следующей фазе. Мы уже фиксируем их в графе знаний.',
    countApi: '/api/v1/policies/count',
    countLabel: (n) =>
      `${n} ${declension(n, ['политика', 'политики', 'политик'])}`,
  },
  metrics: {
    title: 'Метрики',
    description:
      'Метрики и пульс компании появятся в следующей фазе. Сейчас собираем сигналы для расчёта.',
    countApi: '/api/v1/metrics/count',
    countLabel: (n) =>
      `${n} ${declension(n, ['метрика', 'метрики', 'метрик'])}`,
  },
};

type CountResponse = { count: number };

function useSectionCount(
  countApi: string,
  enabled: boolean,
): number | null {
  const { data } = useSWR(
    enabled ? countApi : null,
    async (path: string) => {
      try {
        return await apiClient.get<CountResponse>(path);
      } catch {
        // 403/404/500 — счётчик молча скрываем (см. §6.7).
        return null;
      }
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
  if (!data || typeof data.count !== 'number') return null;
  return data.count;
}

export function ComingSoonPage({ section }: { section: SectionKey }) {
  const config = SECTIONS[section];
  const { currentOrgRole, isSuperAdmin } = useAuth();

  // Счётчик показываем только admin/owner/super_admin.
  const canSeeCount =
    isSuperAdmin ||
    currentOrgRole === 'owner' ||
    currentOrgRole === 'admin';

  const count = useSectionCount(config.countApi, canSeeCount);

  const showCount = canSeeCount && count !== null && count > 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-accent-muted text-accent">
          <Clock4 size={24} strokeWidth={1.75} />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-fg-primary">
            {config.title}
          </h1>
          <div className="text-sm text-fg-tertiary">Появится в Фазе γ</div>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 text-sm leading-6 text-fg-secondary">
          {config.description}
        </CardContent>
      </Card>

      {showCount && (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="text-xs uppercase tracking-wider text-fg-tertiary">
              Уже собрано
            </div>
            <div className="text-base font-medium text-fg-primary">
              {config.countLabel(count)}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
