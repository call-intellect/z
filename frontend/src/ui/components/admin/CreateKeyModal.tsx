"use client";

import { useState } from "react";

import { adminApi } from "@/api/admin.api";
import { ApiError } from "@/api/api-error";
import { toast } from "sonner";
import { Button } from "@/ui/components/shared/Button";
import { Modal } from "@/ui/components/shared/Modal";
import { t } from "@/lib/i18n";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function CreateKeyModal({ open, onClose }: Props) {
  const [partnerName, setPartnerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdKey, setCreatedKey] = useState<{
    id: string;
    key: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setPartnerName("");
    setCreatedKey(null);
    setCopied(false);
    setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partnerName.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await adminApi.createKey(partnerName.trim());
      setCreatedKey({ id: res.id, key: res.key });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("errors.unknown"));
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.key);
      setCopied(true);
    } catch {}
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={
        createdKey
          ? t("admin.integration_keys.created_title")
          : t("admin.integration_keys.create")
      }
    >
      {!createdKey ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-secondary">
              {t("admin.integration_keys.partner_name_label")}
            </span>
            <input
              type="text"
              value={partnerName}
              onChange={(e) => setPartnerName(e.target.value)}
              placeholder={t("admin.integration_keys.partner_name_placeholder")}
              className="rounded-md border border-border px-3 py-2 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              required
              maxLength={100}
              autoFocus
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={handleClose}>
              {t("admin.integration_keys.cancel")}
            </Button>
            <Button type="submit" loading={submitting}>
              {t("admin.integration_keys.submit")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="rounded-md bg-chip-warning-bg p-3 text-sm text-chip-warning-fg">
            {t("admin.integration_keys.created_warning")}
          </p>
          <div className="flex flex-col gap-1">
            <code className="block break-all rounded-md bg-bg-subtle p-3 font-mono text-sm">
              {createdKey.key}
            </code>
            <Button size="sm" variant="secondary" onClick={handleCopy}>
              {copied
                ? t("admin.integration_keys.copied")
                : t("admin.integration_keys.copy")}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleClose}>
              {t("admin.integration_keys.done")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
