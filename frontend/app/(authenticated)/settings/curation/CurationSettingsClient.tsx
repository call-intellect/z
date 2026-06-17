"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { curationApi } from "@/api/curation.api";
import { useAuth } from "@/contexts/auth-context";
import { mapCurationSettings, type CurationSettings } from "@/domain/curation";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "@app/(admin)/admin/AdminStateViews";

export function CurationSettingsClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();

  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной организации."
      />
    );
  }
  return <SettingsContent />;
}

function SettingsContent() {
  const [settings, setSettings] = useState<CurationSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [autoThreshold, setAutoThreshold] = useState(0.85);
  const [deepReviewThreshold, setDeepReviewThreshold] = useState(0.6);
  const [criticalTypesInput, setCriticalTypesInput] = useState("");
  const [itemExpiryDays, setItemExpiryDays] = useState(30);

  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const dto = await curationApi.getSettings();
      const mapped = mapCurationSettings(dto);
      setSettings(mapped);
      setAutoThreshold(mapped.autoThreshold);
      setDeepReviewThreshold(mapped.deepReviewThreshold);
      setCriticalTypesInput(mapped.criticalTypes.join(", "));
      setItemExpiryDays(mapped.itemExpiryDays);
    } catch (e) {
      if (e instanceof ApiError && e.code === "forbidden") {
        setForbidden(true);
      } else {
        setError(humanizeApiError(e, "Не удалось загрузить настройки"));
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setSaveError(null);
    setSaved(false);
    try {
      const criticalTypes = criticalTypesInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const updated = await curationApi.updateSettings({
        autoThreshold,
        deepReviewThreshold,
        criticalTypes,
        itemExpiryDays,
      });
      setSettings(mapCurationSettings(updated));
      setSaved(true);
    } catch (e) {
      setSaveError(humanizeApiError(e, "Не удалось сохранить настройки"));
    } finally {
      setSubmitting(false);
    }
  }, [autoThreshold, criticalTypesInput, deepReviewThreshold, itemExpiryDays]);

  if (isLoading) return <AdminLoading rows={4} />;
  if (forbidden)
    return (
      <AdminForbidden
        title="Доступ только владельцу"
        description="Менять настройки проверки может только владелец или администратор организации."
      />
    );
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!settings) return null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Настройки проверки</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Пороги уверенности triage'а и список «критических» типов карточек,
          которые всегда уходят на подробную проверку.
        </p>
      </header>

      <section className="space-y-4 rounded-lg border border-border-subtle bg-bg-card p-6">
        <ThresholdSlider
          label="Авто-канонизация (>=)"
          description="При уверенности выше этого порога карточка канонизируется без проверки (если нет конфликта и тип не критический)."
          value={autoThreshold}
          onChange={setAutoThreshold}
        />
        <ThresholdSlider
          label="Подробная проверка (<)"
          description="При уверенности ниже этого порога карточка уходит на подробную проверку (deep)."
          value={deepReviewThreshold}
          onChange={setDeepReviewThreshold}
        />

        <div>
          <label className="mb-1 block text-sm font-medium">
            Критические типы карточек (через запятую)
          </label>
          <p className="mb-1 text-xs text-fg-tertiary">
            Эти типы всегда уходят на подробную проверку, независимо от
            уверенности.
          </p>
          <Input
            value={criticalTypesInput}
            onChange={(e) => setCriticalTypesInput(e.target.value)}
            placeholder="regulation, process, decision"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Срок жизни pending-карточки (дни)
          </label>
          <Input
            type="number"
            min={1}
            max={365}
            value={itemExpiryDays}
            onChange={(e) => setItemExpiryDays(Number(e.target.value))}
            className="max-w-[120px]"
          />
        </div>

        {saveError && <p className="text-sm text-danger">{saveError}</p>}
        {saved && <p className="text-sm text-success">Настройки сохранены.</p>}

        <div className="flex justify-end">
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Сохраняем…" : "Сохранить настройки"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ThresholdSlider({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label}:{" "}
        <span className="tabular-nums">{(value * 100).toFixed(0)}%</span>
      </label>
      {description && (
        <p className="mb-1 text-xs text-fg-tertiary">{description}</p>
      )}
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}
