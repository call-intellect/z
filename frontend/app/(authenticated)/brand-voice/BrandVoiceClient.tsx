'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  brandVoiceApi,
  type BrandVoiceArtifactApi,
  type BrandVoiceTabooApi,
  type BrandVoiceValueApi,
  type UpdateBrandVoiceProfileRequest,
} from '@/api/brand-voice.api';
import { useAuth } from '@/contexts/auth-context';
import {
  brandVoiceArtifactStatusLabel,
  toBrandVoiceProfileDomain,
  type BrandVoiceProfileDomain,
} from '@/domain/brand-voice';
import { Button } from '@/ui/shadcn/button';
import { Card } from '@/ui/shadcn/card';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

/**
 * `/brand-voice` UI — read-only display + edit modal для admin.
 *
 * Структура:
 *   - заголовок + completeness + version;
 *   - tone (10 осей с прогресс-барами);
 *   - values (карточки с весами);
 *   - taboos (список с alternative и причинами);
 *   - example artifacts (документы brand_corpus + tagging UI для admin);
 *   - rebuild button.
 *
 * MVP: всё read-only кроме artifact tagging + rebuild (через POST). Полный
 * PATCH-flow для tone/values/taboos будет в δ-1; пока admin может только
 * перетегать документы.
 */
export function BrandVoiceClient(): JSX.Element {
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
  return <BrandVoiceContent orgId={currentOrgId} canEdit={canEdit} />;
}

function BrandVoiceContent({
  orgId,
  canEdit,
}: {
  orgId: string;
  canEdit: boolean;
}): JSX.Element {
  const [profile, setProfile] = useState<BrandVoiceProfileDomain | null>(null);
  const [artifacts, setArtifacts] = useState<BrandVoiceArtifactApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMessage, setRebuildMessage] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, a] = await Promise.all([
        brandVoiceApi.get(orgId),
        brandVoiceApi.artifacts(orgId),
      ]);
      setProfile(toBrandVoiceProfileDomain(p));
      setArtifacts(a.items);
    } catch (err) {
      const msg =
        humanizeApiError(err, 'Не удалось загрузить голос бренда');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRebuild = useCallback(async () => {
    if (!canEdit) return;
    setRebuilding(true);
    setRebuildMessage(null);
    try {
      const r = await brandVoiceApi.rebuild(orgId);
      setRebuildMessage(r.reason);
      // Перезагрузим профиль, чтобы сразу увидеть новые tone/values/taboos.
      await load();
    } catch (err) {
      setRebuildMessage(
        humanizeApiError(err, 'Не удалось запустить пересборку'),
      );
    } finally {
      setRebuilding(false);
    }
  }, [canEdit, orgId, load]);

  const handleSaveEdit = useCallback(
    async (body: UpdateBrandVoiceProfileRequest) => {
      const updated = await brandVoiceApi.update(orgId, body);
      setProfile(toBrandVoiceProfileDomain(updated));
      setShowEdit(false);
    },
    [orgId],
  );

  if (loading) return <AdminLoading rows={6} />;
  if (error && !profile)
    return <AdminError message={error} onRetry={() => void load()} />;
  if (!profile) return <AdminError message="Профиль не найден" />;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-fg-primary">
            Голос бренда
          </h1>
          <p className="mt-1 text-sm text-fg-tertiary">
            Tone, values и табу-фразы компании. Автоматически собирается раз в
            сутки из документов, помеченных «корпус бренда», и принципов
            бренда (signalType=brand_principle).
          </p>
        </div>
        <div className="rounded-lg bg-bg-overlay px-4 py-2 text-right">
          <div className="text-xs text-fg-tertiary">Полнота</div>
          <div className="text-xl font-semibold text-accent">
            {profile.completenessPercent}%
          </div>
          <div className="mt-1 text-xs text-fg-tertiary">
            версия {profile.version}
          </div>
        </div>
      </header>

      {error && <AdminError message={error} />}

      {profile.belowCorpusThreshold && (
        <Card className="border-warning/40 bg-warning/5 p-4">
          <div className="text-sm font-medium text-fg-primary">
            Корпус бренда меньше порога
          </div>
          <p className="mt-1 text-sm text-fg-tertiary">
            Сейчас {profile.corpusSize} документ(а/ов) с пометкой «brand_corpus», нужно
            минимум {profile.minCorpusSize}. Пока порог не достигнут, экстрактор
            не собирает профиль. Пометьте больше документов через раздел
            «Артефакты» ниже.
          </p>
        </Card>
      )}

      <CorpusStatusCard
        corpusSize={profile.corpusSize}
        minCorpusSize={profile.minCorpusSize}
        lastBuiltAt={profile.lastBuiltAt}
        builderAgentVersion={profile.builderAgentVersion}
      />

      <ToneCard tone={profile.tone} />

      <ValuesCard values={profile.values} />

      <TaboosCard taboos={profile.taboos} />

      <ArtifactsCard
        artifacts={artifacts}
        exampleArtifactIds={profile.exampleArtifactIds}
        canEdit={canEdit}
        orgId={orgId}
        onChanged={() => void load()}
      />

      {canEdit && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <Button onClick={() => void handleRebuild()} disabled={rebuilding}>
            {rebuilding ? 'Запускаем…' : 'Пересобрать сейчас'}
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowEdit(true)}
            disabled={rebuilding}
          >
            Ручная правка
          </Button>
          {rebuildMessage && (
            <span className="text-sm text-fg-tertiary">{rebuildMessage}</span>
          )}
        </Card>
      )}

      {showEdit && profile && (
        <EditModal
          profile={profile}
          onCancel={() => setShowEdit(false)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}

function CorpusStatusCard({
  corpusSize,
  minCorpusSize,
  lastBuiltAt,
  builderAgentVersion,
}: {
  corpusSize: number;
  minCorpusSize: number;
  lastBuiltAt: Date | null;
  builderAgentVersion: string | null;
}): JSX.Element {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg-primary">Статус</h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-fg-tertiary">Корпус бренда</dt>
        <dd className="text-fg-primary">
          {corpusSize} / минимум {minCorpusSize}
        </dd>
        <dt className="text-fg-tertiary">Последняя сборка</dt>
        <dd className="text-fg-primary">
          {lastBuiltAt ? lastBuiltAt.toLocaleString('ru-RU') : '—'}
        </dd>
        <dt className="text-fg-tertiary">Версия экстрактора</dt>
        <dd className="text-fg-primary">{builderAgentVersion ?? '—'}</dd>
      </dl>
    </Card>
  );
}

function ToneCard({
  tone,
}: {
  tone: BrandVoiceProfileDomain['tone'];
}): JSX.Element {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg-primary">Тон (10 осей)</h2>
      {tone.length === 0 ? (
        <p className="mt-2 text-sm text-fg-tertiary">Тон ещё не извлечён.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {tone.map((axis) => (
            <li key={axis.key}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-fg-primary">{axis.label}</span>
                <span className="text-fg-tertiary">{axis.percent}%</span>
              </div>
              <div className="mt-1 h-2 w-full rounded-full bg-bg-overlay">
                <div
                  className="h-2 rounded-full bg-accent"
                  style={{ width: `${axis.percent}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ValuesCard({
  values,
}: {
  values: BrandVoiceValueApi[];
}): JSX.Element {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg-primary">Ценности</h2>
      {values.length === 0 ? (
        <p className="mt-2 text-sm text-fg-tertiary">
          Ценности ещё не извлечены.
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {values.map((v) => (
            <li
              key={v.value}
              className="rounded-md border border-border-subtle bg-bg-base p-3"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-fg-primary">{v.value}</span>
                <span className="text-fg-tertiary">
                  {Math.round(v.weight * 100)}%
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TaboosCard({
  taboos,
}: {
  taboos: BrandVoiceTabooApi[];
}): JSX.Element {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg-primary">Табу-фразы</h2>
      {taboos.length === 0 ? (
        <p className="mt-2 text-sm text-fg-tertiary">
          Табу ещё не извлечены.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {taboos.map((t) => (
            <li
              key={t.phrase}
              className="rounded-md border border-border-subtle bg-bg-base p-3"
            >
              <div className="text-sm font-medium text-fg-primary">
                «{t.phrase}»
              </div>
              {t.alternative && (
                <div className="mt-1 text-xs text-fg-tertiary">
                  Лучше: «{t.alternative}»
                </div>
              )}
              <div className="mt-1 text-xs text-fg-tertiary">{t.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ArtifactsCard({
  artifacts,
  exampleArtifactIds,
  canEdit,
  orgId,
  onChanged,
}: {
  artifacts: BrandVoiceArtifactApi[];
  exampleArtifactIds: string[];
  canEdit: boolean;
  orgId: string;
  onChanged: () => void;
}): JSX.Element {
  const exampleSet = useMemo(
    () => new Set(exampleArtifactIds),
    [exampleArtifactIds],
  );
  const [pendingId, setPendingId] = useState<string | null>(null);

  const toggleBrandCorpus = useCallback(
    async (artifact: BrandVoiceArtifactApi) => {
      if (!canEdit) return;
      setPendingId(artifact.id);
      try {
        const without = artifact.useCases.filter((u) => u !== 'brand_corpus');
        // Если документ уже tagged — снимаем; иначе добавляем + reference как дефолт.
        const has = artifact.useCases.includes('brand_corpus');
        const next = has
          ? without.length > 0
            ? without
            : ['reference']
          : [...without, 'brand_corpus'];
        await brandVoiceApi.patchDocumentUseCases(orgId, artifact.id, next);
        onChanged();
      } finally {
        setPendingId(null);
      }
    },
    [canEdit, orgId, onChanged],
  );

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg-primary">
        Артефакты (brand_corpus)
      </h2>
      {artifacts.length === 0 ? (
        <p className="mt-2 text-sm text-fg-tertiary">
          Нет документов, помеченных как brand_corpus. Пометьте подходящие
          документы в разделе «Документы» через «Метки → brand_corpus».
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {artifacts.map((a) => {
            const isUsed = exampleSet.has(a.id);
            return (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-base p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-fg-primary">
                    {a.name}
                  </div>
                  <div className="text-xs text-fg-tertiary">
                    {a.mimeType} · {brandVoiceArtifactStatusLabel(a.status)}
                    {isUsed && ' · использован в последней сборке'}
                  </div>
                </div>
                {canEdit && (
                  <Button
                    variant="outline"
                    onClick={() => void toggleBrandCorpus(a)}
                    disabled={pendingId === a.id}
                  >
                    Снять метку
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function EditModal({
  profile,
  onCancel,
  onSave,
}: {
  profile: BrandVoiceProfileDomain;
  onCancel: () => void;
  onSave: (body: UpdateBrandVoiceProfileRequest) => Promise<void>;
}): JSX.Element {
  const [valuesText, setValuesText] = useState(
    profile.values.map((v) => `${v.value}|${v.weight}`).join('\n'),
  );
  const [taboosText, setTaboosText] = useState(
    profile.taboos
      .map(
        (t) =>
          `${t.phrase}||${t.alternative ?? ''}||${t.reason}`,
      )
      .join('\n'),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setErr(null);
    setSaving(true);
    try {
      const values: BrandVoiceValueApi[] = valuesText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [value, weightRaw] = line.split('|').map((s) => s.trim());
          const weight = Number.parseFloat(weightRaw ?? '0.5');
          return {
            value: value ?? '',
            weight: Number.isFinite(weight)
              ? Math.max(0, Math.min(1, weight))
              : 0.5,
            exampleBlockIds: [],
          };
        })
        .filter((v) => v.value.length > 0);
      const taboos: BrandVoiceTabooApi[] = taboosText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split('||').map((s) => s.trim());
          const [phrase, alt, reason] = parts;
          const out: BrandVoiceTabooApi = {
            phrase: phrase ?? '',
            reason: reason ?? '',
          };
          if (alt) out.alternative = alt;
          return out;
        })
        .filter((t) => t.phrase.length > 0 && t.reason.length > 0);

      await onSave({
        values: values.length > 0 ? values : null,
        taboos: taboos.length > 0 ? taboos : null,
      });
    } catch (error) {
      setErr(
        humanizeApiError(error, 'Не удалось сохранить'),
      );
    } finally {
      setSaving(false);
    }
  }, [valuesText, taboosText, onSave]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-overlay p-4">
      <Card className="w-full max-w-2xl space-y-4 p-6">
        <h2 className="text-lg font-semibold text-fg-primary">
          Ручная правка голоса бренда
        </h2>
        <p className="text-sm text-fg-tertiary">
          Tone-аспекты редактируются только через пересборку (LLM-extraction).
          Здесь вы можете править ценности и табу.
        </p>

        <div>
          <label className="mb-1 block text-sm font-medium text-fg-primary">
            Ценности (по одной в строке: <code>название|вес</code>, вес 0..1)
          </label>
          <textarea
            value={valuesText}
            onChange={(e) => setValuesText(e.target.value)}
            rows={6}
            className="w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-sm font-mono"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-fg-primary">
            Табу (по одной в строке: <code>фраза||альтернатива||причина</code>)
          </label>
          <textarea
            value={taboosText}
            onChange={(e) => setTaboosText(e.target.value)}
            rows={6}
            className="w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-sm font-mono"
          />
        </div>

        {err && (
          <div className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
            {err}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Отмена
          </Button>
        </div>
      </Card>
    </div>
  );
}
