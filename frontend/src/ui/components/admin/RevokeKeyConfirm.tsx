'use client';

import type { IntegrationKeyApi } from '@/api/admin.api';
import { Button } from '@/ui/components/shared/Button';
import { Modal } from '@/ui/components/shared/Modal';
import { t } from '@/lib/i18n';

type Props = {
  target: IntegrationKeyApi | null;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void> | void;
};

export function RevokeKeyConfirm({ target, onClose, onConfirm }: Props) {
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={t('admin.integration_keys.revoke_confirm_title')}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-secondary">
          {t('admin.integration_keys.revoke_confirm_description')}
        </p>
        {target ? (
          <div className="rounded-md bg-bg-subtle p-3 text-sm">
            <span className="font-medium">{target.partnerName}</span>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('admin.integration_keys.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => target && onConfirm(target.id)}
          >
            {t('admin.integration_keys.revoke_confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
