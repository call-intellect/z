import type { Metadata } from 'next';

import { TierGate } from '@/ui/components/TierGate';
import { MobileShell } from '@/ui/mobile/MobileShell';
import { MobileGoalsClient } from '@/ui/mobile/exec/MobileGoalsClient';

import { GoalsClient } from './GoalsClient';

export const metadata: Metadata = {
  title: 'Цели',
};

/**
 * Мобайл (ТЗ B2/Ф3): внутри `TierGate` ниже md рендерим «Цели»
 * (`MobileGoalsClient`) на том же роуте/том же источнике (`goalsApi.list`,
 * status='active'). Инвариант №1: десктоп-ветка дословно `<GoalsClient />`.
 */
export default function GoalsPage() {
  return (
    <TierGate feature="feature.goals_strategy">
      <MobileShell
        mobile={<MobileGoalsClient />}
        desktop={<GoalsClient />}
      />
    </TierGate>
  );
}
