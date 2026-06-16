'use client';

import { Users } from 'lucide-react';

import { formatRubles } from '@/domain/billing';
import {
  clientStatusLabel,
  type ReferralClientMaskedDomain,
  type ReferralClientStatus,
} from '@/domain/referral';
import {
  GRAD,
  STATUS_TONE,
  ModernTable,
  glass,
  type ModernTableColumn,
} from '@/ui/components/dashboard/modern';

interface Props {
  clients: ReferralClientMaskedDomain[];
}

/**
 * ClientsTableMasked — таблица приведённых клиентов с маскировкой Org
 * (ТЗ §6.4 + §8.1 C).
 *
 * Защита приватности: ни одна колонка не идентифицирует Org — нет
 * `name`, `id`, `tenantId`, ИНН, email или телефона. Партнёр видит
 * только анонимный `clientCode` (`C` + 6 символов base36 от crc32),
 * дату привязки, дату первой оплаты, статус и суммы.
 *
 * Редизайн B10: переведена на `ModernTable`. МАСКИРОВАНИЕ СОХРАНЕНО
 * дословно — единственный идентификатор клиента это `clientCode`.
 */
export function ClientsTableMasked({ clients }: Props) {
  const header = (
    <div className="flex items-center gap-2.5">
      <span
        className="grid h-8 w-8 place-items-center rounded-xl"
        style={{ background: GRAD.teal, color: 'oklch(0.99 0.005 280)' }}
        aria-hidden="true"
      >
        <Users className="h-4 w-4" />
      </span>
      <div>
        <h3 className="text-[15px] font-semibold">Приведённые клиенты</h3>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Названия и реквизиты клиентов не показываем — это защита их
          приватности и твоего доверия.
        </p>
      </div>
    </div>
  );

  if (clients.length === 0) {
    return (
      <div style={glass()} className="p-6">
        {header}
        <p className="mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Пока никого не привёл. Как только первый клиент оплатит подписку,
          здесь появится строка с кодом, датой и начислением.
        </p>
      </div>
    );
  }

  const columns: ModernTableColumn<ReferralClientMaskedDomain>[] = [
    {
      header: 'Код клиента',
      cell: (c) => (
        <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
          {c.clientCode}
        </span>
      ),
    },
    {
      header: 'Привязан',
      cell: (c) => (
        <span style={{ color: 'var(--text-secondary)' }}>
          {c.attachedAt.toLocaleDateString('ru-RU')}
        </span>
      ),
    },
    {
      header: 'Первая оплата',
      cell: (c) => (
        <span style={{ color: 'var(--text-secondary)' }}>
          {c.firstPaidAt ? c.firstPaidAt.toLocaleDateString('ru-RU') : '—'}
        </span>
      ),
    },
    {
      header: 'Статус',
      cell: (c) => <ClientStatusPill status={c.status} />,
    },
    {
      header: 'В этом месяце',
      align: 'right',
      cell: (c) => (
        <span style={{ color: 'var(--text-primary)' }}>
          {formatRubles(c.monthlyEarningsKopecks)}
        </span>
      ),
    },
    {
      header: 'Всего',
      align: 'right',
      cell: (c) => (
        <span style={{ color: 'var(--text-primary)' }}>
          {formatRubles(c.totalEarnedKopecks)}
        </span>
      ),
    },
  ];

  return (
    <ModernTable<ReferralClientMaskedDomain>
      title="Приведённые клиенты"
      titleIcon={<Users className="h-4 w-4" />}
      titleGrad={GRAD.teal}
      columns={columns}
      rows={clients}
      getKey={(c) => c.clientCode}
    />
  );
}

/**
 * Плашка статуса клиента в стиле `StatusPill` (парные токены `STATUS_TONE`),
 * но с осмысленной русской подписью (Активен / Ушёл / Не оплатил).
 */
function ClientStatusPill({ status }: { status: ReferralClientStatus }) {
  const tone = STATUS_TONE[toneFromStatus(status)];
  return (
    <span
      className="rounded-full px-3 py-1 text-xs font-medium"
      style={{ color: tone.c, background: tone.bg }}
    >
      {clientStatusLabel(status)}
    </span>
  );
}

function toneFromStatus(s: ReferralClientStatus): 'ok' | 'warning' | 'risk' {
  if (s === 'active') return 'ok';
  if (s === 'churned') return 'warning';
  return 'warning';
}
