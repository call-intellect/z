'use client';

import { Users } from 'lucide-react';

import { formatRubles } from '@/domain/billing';
import {
  clientStatusLabel,
  type ReferralClientMaskedDomain,
  type ReferralClientStatus,
} from '@/domain/referral';
import { Badge } from '@/ui/shadcn/badge';
import { Card } from '@/ui/shadcn/card';

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
 * Пустое состояние — отдельный текстовый блок с подсказкой.
 */
export function ClientsTableMasked({ clients }: Props) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border-subtle px-6 py-4">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-muted text-accent"
          aria-hidden="true"
        >
          <Users className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-fg-primary">
            Приведённые клиенты
          </h2>
          <p className="text-xs text-fg-tertiary">
            Названия и реквизиты клиентов не показываем — это защита их
            приватности и твоего доверия.
          </p>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="px-6 py-8 text-sm text-fg-secondary">
          Пока никого не привёл. Как только первый клиент оплатит подписку,
          здесь появится строка с кодом, датой и начислением.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Код клиента</th>
                <th className="px-6 py-3 text-left font-medium">
                  Привязан
                </th>
                <th className="px-6 py-3 text-left font-medium">
                  Первая оплата
                </th>
                <th className="px-6 py-3 text-left font-medium">Статус</th>
                <th className="px-6 py-3 text-left font-medium">
                  В этом месяце
                </th>
                <th className="px-6 py-3 text-left font-medium">Всего</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.clientCode} className="border-t border-border-subtle">
                  <td className="px-6 py-3 font-mono text-fg-primary">
                    {c.clientCode}
                  </td>
                  <td className="px-6 py-3 text-fg-secondary">
                    {c.attachedAt.toLocaleDateString('ru-RU')}
                  </td>
                  <td className="px-6 py-3 text-fg-secondary">
                    {c.firstPaidAt
                      ? c.firstPaidAt.toLocaleDateString('ru-RU')
                      : '—'}
                  </td>
                  <td className="px-6 py-3">
                    <Badge variant={badgeVariant(c.status)}>
                      {clientStatusLabel(c.status)}
                    </Badge>
                  </td>
                  <td className="px-6 py-3 text-fg-primary">
                    {formatRubles(c.monthlyEarningsKopecks)}
                  </td>
                  <td className="px-6 py-3 text-fg-primary">
                    {formatRubles(c.totalEarnedKopecks)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function badgeVariant(
  s: ReferralClientStatus,
): 'success' | 'warning' | 'secondary' {
  if (s === 'active') return 'success';
  if (s === 'churned') return 'warning';
  return 'secondary';
}
