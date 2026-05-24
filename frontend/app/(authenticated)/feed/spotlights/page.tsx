'use client';

import { TeamSpotlightWidget } from '@/ui/components/gamification';
import { SpotlightsTodayWidget } from '@/ui/components/helpfulness/SpotlightsTodayWidget';
import { useAuth } from '@/contexts/auth-context';

export default function SpotlightsPage() {
  const { currentOrgId } = useAuth();

  return (
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
        Спотлайты
      </h1>
      <p className="mt-1 text-sm text-fg-tertiary">
        Публичные «спасибо» коллегам — кого AI-агент и руководители особо
        отметили на этой неделе.
      </p>

      {!currentOrgId ? (
        <div className="mt-4 rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-12 text-center text-sm text-fg-tertiary">
          Сначала выберите организацию.
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <TeamSpotlightWidget orgId={currentOrgId} />
          <SpotlightsTodayWidget orgId={currentOrgId} />
        </div>
      )}
    </div>
  );
}
