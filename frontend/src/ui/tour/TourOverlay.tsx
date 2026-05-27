'use client';

/**
 * TourOverlay — связка Backdrop + Tooltip. Рендерится из TourProvider.
 * Виден только когда есть `active` тур.
 *
 * Обработчики:
 *   - ESC → skip (по ТЗ §"Доступность").
 *   - primaryAction.kind === 'next' → next() (на последнем шаге complete).
 *   - primaryAction.kind === 'complete' → complete().
 *   - secondaryAction.kind === 'skip' → skip().
 *   - primaryAction.kind === 'prev' → prev() (не используется в стандартных турах,
 *     но поддерживаем для расширений).
 */

import { useEffect } from 'react';

import { useTourContext } from './TourProvider';
import { TourBackdrop } from './TourBackdrop';
import { TourTooltip } from './TourTooltip';
import type { TourStepAction } from './types';

export function TourOverlay() {
  const { active, next, prev, skip, complete } = useTourContext();

  useEffect(() => {
    if (!active) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void skip();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [active, skip]);

  if (!active) return null;

  const step = active.definition.steps[active.stepIndex];
  if (!step) return null;

  const onAction = (action: TourStepAction) => {
    switch (action.kind) {
      case 'next':
        next();
        break;
      case 'prev':
        prev();
        break;
      case 'skip':
        void skip();
        break;
      case 'complete':
        void complete();
        break;
    }
  };

  return (
    <>
      <TourBackdrop />
      <TourTooltip
        step={step}
        stepIndex={active.stepIndex}
        totalSteps={active.definition.steps.length}
        onActionClick={onAction}
      />
    </>
  );
}
