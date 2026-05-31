'use client';

import { useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';

import {
  canWithdraw,
  withdrawBlockReason,
  type ReferralDomain,
} from '@/domain/referral';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/ui/shadcn/tooltip';

interface Props {
  referral: ReferralDomain;
  totalPendingKopecks: number;
}

/**
 * WithdrawButton — кнопка «Вывести» с проверкой условий выплаты (ТЗ §6.5, §8.3).
 *
 * Логика:
 *   - Если все условия выполнены и баланс > 0 — кнопка активна, по клику
 *     открывает диалог «Когда придут деньги».
 *   - Иначе — серая (disabled) с тултипом, объясняющим первую нерешённую
 *     причину.
 *
 * На первом запуске (ТЗ §11 п.3) «Вывести» — это инструкция, а не запрос:
 * выплаты идут автоматически 10-го числа каждого месяца, для досрочного
 * вывода — обращение в поддержку. Никакой новой сущности WithdrawalRequest
 * не создаём.
 */
export function WithdrawButton({ referral, totalPendingKopecks }: Props) {
  const [open, setOpen] = useState(false);
  const enabled = canWithdraw(referral, totalPendingKopecks);
  const blockReason = withdrawBlockReason(referral, totalPendingKopecks);

  const button = (
    <Button
      type="button"
      variant="default"
      size="sm"
      disabled={!enabled}
      onClick={() => setOpen(true)}
      aria-label="Вывести начисления"
    >
      <ArrowDownToLine className="h-4 w-4" />
      Вывести
    </Button>
  );

  return (
    <>
      {enabled ? (
        button
      ) : (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* span обёртка нужна, потому что disabled button не ловит hover */}
              <span className="inline-flex">{button}</span>
            </TooltipTrigger>
            <TooltipContent>{blockReason ?? 'Недоступно'}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Когда придут деньги</DialogTitle>
            <DialogDescription>
              Выплаты идут автоматически 10-го числа каждого месяца. Сумма
              «К выводу» уйдёт в очередное начисление.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-fg-secondary">
            <p>
              Если нужно получить раньше — напиши в поддержку, финансовый
              отдел обработает запрос в течение 1–2 рабочих дней.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Понятно
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
