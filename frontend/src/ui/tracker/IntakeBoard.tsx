'use client';

/**
 * IntakeBoard — триаж входящих задач.
 * Phase 2: список карточек со статусом + action-кнопки accept/reject/snooze
 * (triage по интейку). Полноценный triage-flow с overrides — Sprint 4.
 */

import { useState } from 'react';
import { Check, X, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/ui/shadcn/button';
import { Badge } from '@/ui/shadcn/badge';
import { useIntake } from '@/hooks/tracker/useIntake';
import { intakeApi } from '@/api/tracker/intake.api';
import {
  INTAKE_SOURCE_LABELS,
  INTAKE_STATUS_LABELS,
  intakeDisplayTitle,
  type Intake,
} from '@/domain/tracker';

export function IntakeBoard({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId?: string;
}) {
  const { intake, isLoading, error, mutate } = useIntake(orgId, {
    status: 'pending',
    ...(projectId ? { projectId } : {}),
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleTriage = async (
    item: Intake,
    decision: 'accept' | 'reject' | 'snooze',
  ) => {
    setBusyId(item.id);
    try {
      await intakeApi.triage(orgId, item.id, {
        decision,
        ...(decision === 'snooze'
          ? {
              snoozedUntil: new Date(
                Date.now() + 24 * 60 * 60 * 1000,
              ).toISOString(),
            }
          : {}),
        // В проектном контексте targetProjectId всегда задан (id проекта);
        // в общем случае бэк сам зарезолвит intake.projectId/suggested.
        ...(decision === 'accept'
          ? { targetProjectId: projectId ?? item.projectId ?? null }
          : {}),
      });
      await mutate();
    } catch (e) {
      toast.error(
        `Не удалось выполнить: ${e instanceof Error ? e.message : 'неизвестная ошибка'}`,
        { duration: 5000 },
      );
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-danger">Не удалось загрузить входящие.</div>
    );
  }

  if (intake.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-10 text-center text-sm text-fg-tertiary">
        Входящих задач пока нет.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {intake.map((item) => (
        <div
          key={item.id}
          className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-3 md:flex-row md:items-center"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {INTAKE_SOURCE_LABELS[item.source]}
              </Badge>
              <Badge variant="secondary">
                {INTAKE_STATUS_LABELS[item.status]}
              </Badge>
            </div>
            <div className="mt-1 text-sm text-fg-primary line-clamp-2">
              {intakeDisplayTitle(item)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => void handleTriage(item, 'accept')}
              disabled={busyId === item.id}
              className="gap-1"
            >
              <Check size={12} /> Принять
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void handleTriage(item, 'snooze')}
              disabled={busyId === item.id}
              className="gap-1"
            >
              <Clock size={12} /> Отложить
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void handleTriage(item, 'reject')}
              disabled={busyId === item.id}
              className="gap-1 text-danger"
            >
              <X size={12} /> Отклонить
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
