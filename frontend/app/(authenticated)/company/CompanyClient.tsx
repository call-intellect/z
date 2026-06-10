'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import Link from 'next/link';

import { ApiError } from '@/api/api-error';
import {
  companyApi,
  type CompanyProfileApi,
  type CompanyStageApi,
  type UpdateCompanyProfileRequest,
} from '@/api/company.api';
import { useAuth } from '@/contexts/auth-context';
import {
  COMPANY_STAGE_LABEL,
  toCompanyProfileDomain,
  type CompanyProfileDomain,
} from '@/domain/company-profile';
import { Button } from '@/ui/shadcn/button';
import { Card } from '@/ui/shadcn/card';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

/**
 * `/company` UI — простой single-page редактор профиля.
 * 4 текстовых блока (миссия / видение / стратегия / стадия).
 *
 * MVP-уровень: textarea-редактирование без markdown-preview. Расширение —
 * следующая итерация (δ-1 виджеты + AI-fill действий).
 */
export function CompanyClient(): JSX.Element {
  const { currentOrgId, currentOrgRole, isLoading: authLoading } = useAuth();
  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной организации."
      />
    );
  }
  const canEdit = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  return <CompanyContent orgId={currentOrgId} canEdit={canEdit} />;
}

function CompanyContent({
  orgId,
  canEdit,
}: {
  orgId: string;
  canEdit: boolean;
}): JSX.Element {
  const [profile, setProfile] = useState<CompanyProfileDomain | null>(null);
  const [raw, setRaw] = useState<CompanyProfileApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Локальные поля формы (отделяем от serverState).
  const [displayName, setDisplayName] = useState('');
  const [mission, setMission] = useState('');
  const [vision, setVision] = useState('');
  const [strategy, setStrategy] = useState('');
  const [stage, setStage] = useState<CompanyStageApi | ''>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await companyApi.get(orgId);
      setRaw(r);
      const d = toCompanyProfileDomain(r);
      setProfile(d);
      setDisplayName(d.displayName ?? '');
      setMission(d.missionContentMd ?? '');
      setVision(d.visionContentMd ?? '');
      setStrategy(d.strategyContentMd ?? '');
      setStage(d.stage ?? '');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Не удалось загрузить профиль';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const body: UpdateCompanyProfileRequest = {
        displayName: displayName.trim() || undefined,
        mission: mission.trim()
          ? { contentMd: mission.trim() }
          : null,
        vision: vision.trim() ? { contentMd: vision.trim() } : null,
        strategy: strategy.trim() ? { contentMd: strategy.trim() } : null,
        stage: stage === '' ? null : (stage as CompanyStageApi),
      };
      const r = await companyApi.update(orgId, body);
      setRaw(r);
      setProfile(toCompanyProfileDomain(r));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Не удалось сохранить профиль';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }, [canEdit, displayName, mission, vision, strategy, stage, orgId]);

  if (loading) return <AdminLoading rows={6} />;
  if (error && !profile) return <AdminError message={error} onRetry={() => void load()} />;
  if (!profile) return <AdminError message="Профиль не найден" />;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg-primary">Компания</h1>
          <p className="mt-1 text-sm text-fg-tertiary">
            Идентичность компании: миссия, видение, стратегия. Связано со{' '}
            <Link href="/structure" className="underline">
              Структурой
            </Link>
            ,{' '}
            <Link href="/domains" className="underline">
              Доменами
            </Link>
            ,{' '}
            <Link href="/maturity" className="underline">
              Зрелостью
            </Link>
            .
          </p>
        </div>
        {profile.maturityPercent !== null && (
          <div className="rounded-lg bg-bg-overlay px-4 py-2 text-right">
            <div className="text-xs text-fg-tertiary">Зрелость</div>
            <div className="text-xl font-semibold text-accent">
              {profile.maturityPercent}%
            </div>
          </div>
        )}
      </header>

      {error && <AdminError message={error} />}

      <Card className="space-y-4 p-5">
        <Field
          label="Краткое имя компании"
          value={displayName}
          onChange={setDisplayName}
          readOnly={!canEdit}
          placeholder="Например: «ABC Технологии»"
        />
        <Field
          label="Миссия (зачем существует компания)"
          value={mission}
          onChange={setMission}
          readOnly={!canEdit}
          multiline
          placeholder="Делаем X для Y, чтобы Z…"
        />
        <Field
          label="Видение (картина будущего через 3–5 лет)"
          value={vision}
          onChange={setVision}
          readOnly={!canEdit}
          multiline
          placeholder="Через 5 лет мы будем…"
        />
        <Field
          label="Стратегия (как мы туда придём)"
          value={strategy}
          onChange={setStrategy}
          readOnly={!canEdit}
          multiline
          placeholder="Сегмент рынка, ставки, ключевые инициативы"
        />

        <div>
          <label className="mb-1 block text-sm font-medium text-fg-primary">
            Стадия развития
          </label>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as CompanyStageApi | '')}
            disabled={!canEdit}
            className="w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-sm"
          >
            <option value="">Не указана</option>
            {(['early_stage', 'growth', 'scale', 'enterprise'] as const).map((s) => (
              <option key={s} value={s}>
                {COMPANY_STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>

        {canEdit && (
          <div className="flex gap-2 pt-2">
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            <Button
              variant="outline"
              onClick={() => void load()}
              disabled={saving}
            >
              Сбросить
            </Button>
          </div>
        )}
      </Card>

      {profile.lastMaturityCalcAt && (
        <div className="text-xs text-fg-tertiary">
          Зрелость пересчитана: {profile.lastMaturityCalcAt.toLocaleString('ru-RU')}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  readOnly,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  multiline?: boolean;
  placeholder?: string;
}): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-fg-primary">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          rows={5}
          placeholder={placeholder}
          className="w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-sm"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          placeholder={placeholder}
          className="w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}
