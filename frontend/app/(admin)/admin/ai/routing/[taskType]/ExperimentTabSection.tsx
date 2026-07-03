"use client";

import { useCallback, useState } from "react";
import { FlaskConical, Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import {
  AI_MODELS_PROVIDERS,
  adminAiModelsApi,
  type AiModelProvider,
  type ExperimentMetricsApi,
  type ModelExperimentApi,
} from "@/api/admin-ai-models.api";
import { providerLabel } from "@/domain/admin-ai-model";
import { formatDurationMs, formatUsd } from "@/domain/admin-usage";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { Textarea } from "@/ui/shadcn/textarea";

import { AdminEmpty, AdminError, AdminLoading } from "../../../AdminStateViews";
import { useAdminQuery } from "../../../useAdminQuery";

export function ExperimentTabSection({ taskType }: { taskType: string }) {
  const [showCreate, setShowCreate] = useState(false);

  const detailQ = useAdminQuery(
    `ai-models-detail-for-experiment:${taskType}`,
    () => adminAiModelsApi.detail(taskType),
    [taskType],
  );

  const expQ = useAdminQuery(
    `experiments:${taskType}`,
    async () => (await adminAiModelsApi.experimentsList({ taskType })).items,
    [taskType],
  );

  const latest = expQ.data?.[0] ?? null;
  const isEmpty = !latest || latest.status === "stopped" || latest.status === "completed";

  return (
    <div className="space-y-4">
      {expQ.isLoading && <AdminLoading rows={3} />}
      {!expQ.isLoading && expQ.error && (
        <AdminError message={expQ.error} onRetry={() => expQ.refetch()} />
      )}

      {!expQ.isLoading && !expQ.error && isEmpty && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <AdminEmpty
              title="A/B-тест не запущен"
              description="Сейчас на этой задаче нет активного теста моделей. Можно запустить новый — трафик задачи реально разделится между текущей моделью и вариантом."
            />
            <div className="flex justify-center">
              <Button onClick={() => setShowCreate(true)}>
                <FlaskConical size={14} /> Запустить A/B
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!expQ.isLoading && !expQ.error && latest && latest.status === "draft" && (
        <DraftExperimentPanel
          experiment={latest}
          onStarted={() => void expQ.refetch()}
        />
      )}

      {!expQ.isLoading && !expQ.error && latest && latest.status === "running" && (
        <RunningExperimentPanel
          experiment={latest}
          onStopped={() => void expQ.refetch()}
        />
      )}

      {showCreate && (
        <CreateExperimentDialog
          taskType={taskType}
          defaultControlProvider={
            (detailQ.data?.primary?.providerName as AiModelProvider | undefined) ??
            AI_MODELS_PROVIDERS[0]
          }
          defaultControlModel={detailQ.data?.primary?.model ?? ""}
          onClose={() => setShowCreate(false)}
          onStarted={() => {
            setShowCreate(false);
            void expQ.refetch();
          }}
        />
      )}
    </div>
  );
}

function ExperimentConfigGrid({ experiment }: { experiment: ModelExperimentApi }) {
  const started = experiment.startedAt ? new Date(experiment.startedAt) : null;
  const ends = experiment.endsAt ? new Date(experiment.endsAt) : null;
  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <div className="text-xs text-fg-tertiary">Текущая модель</div>
        <code className="font-mono">
          {providerLabel(experiment.controlProvider)} / {experiment.controlModel}
        </code>
      </div>
      <div>
        <div className="text-xs text-fg-tertiary">Модель-вариант</div>
        <code className="font-mono">
          {providerLabel(experiment.variantProvider)} / {experiment.variantModel}
        </code>
      </div>
      <div>
        <div className="text-xs text-fg-tertiary">Доля трафика</div>
        {experiment.splitPercent}% вариант / {100 - experiment.splitPercent}% текущая
      </div>
      <div>
        <div className="text-xs text-fg-tertiary">Период</div>
        {started ? started.toLocaleDateString("ru-RU") : "не запущен"} —{" "}
        {ends ? ends.toLocaleDateString("ru-RU") : "—"}
      </div>
      {experiment.notes && (
        <div className="col-span-2">
          <div className="text-xs text-fg-tertiary">Заметка</div>
          <p className="text-sm text-fg-secondary">{experiment.notes}</p>
        </div>
      )}
    </div>
  );
}

function DraftExperimentPanel({
  experiment,
  onStarted,
}: {
  experiment: ModelExperimentApi;
  onStarted: () => void;
}) {
  const [starting, setStarting] = useState(false);

  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      await adminAiModelsApi.experimentStart(experiment.id);
      toast.success("Эксперимент запущен");
      onStarted();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось запустить эксперимент");
    } finally {
      setStarting(false);
    }
  }, [experiment.id, onStarted]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical size={16} className="text-accent" />
          Эксперимент создан, но ещё не запущен
        </CardTitle>
        <Button size="sm" onClick={() => void handleStart()} disabled={starting}>
          {starting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Play size={12} />
          )}
          Запустить
        </Button>
      </CardHeader>
      <CardContent>
        <ExperimentConfigGrid experiment={experiment} />
      </CardContent>
    </Card>
  );
}

function RunningExperimentPanel({
  experiment,
  onStopped,
}: {
  experiment: ModelExperimentApi;
  onStopped: () => void;
}) {
  const [stopping, setStopping] = useState(false);

  const analyticsQ = useAdminQuery(
    `experiment-analytics:${experiment.id}`,
    () => adminAiModelsApi.experimentAnalytics(experiment.id),
    [experiment.id],
  );

  const handleStop = useCallback(async () => {
    setStopping(true);
    try {
      await adminAiModelsApi.experimentStop(experiment.id);
      toast.success("Эксперимент остановлен");
      onStopped();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось остановить эксперимент");
    } finally {
      setStopping(false);
    }
  }, [experiment.id, onStopped]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical size={16} className="text-accent" />
            Активный A/B-тест
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleStop()}
            disabled={stopping}
          >
            {stopping ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Square size={12} />
            )}
            Остановить
          </Button>
        </CardHeader>
        <CardContent>
          <ExperimentConfigGrid experiment={experiment} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Метрики</CardTitle>
        </CardHeader>
        <CardContent>
          {analyticsQ.isLoading && <AdminLoading rows={2} />}
          {!analyticsQ.isLoading && analyticsQ.error && (
            <AdminError
              message={analyticsQ.error}
              onRetry={() => analyticsQ.refetch()}
            />
          )}
          {!analyticsQ.isLoading && analyticsQ.data && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <MetricsBlock
                groupLabel="Текущая"
                isVariant={false}
                metrics={analyticsQ.data.control}
              />
              <MetricsBlock
                groupLabel="Вариант"
                isVariant
                metrics={analyticsQ.data.variant}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function MetricsBlock({
  groupLabel,
  isVariant,
  metrics,
}: {
  groupLabel: string;
  isVariant: boolean;
  metrics: ExperimentMetricsApi;
}) {
  return (
    <div className="rounded-lg border border-border-subtle p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant={isVariant ? "default" : "secondary"}>{groupLabel}</Badge>
        <code className="font-mono text-xs">{metrics.model}</code>
      </div>
      <dl className="space-y-1 text-sm">
        <Row label="Вызовов" value={metrics.totalCalls.toLocaleString("ru-RU")} />
        <Row
          label="Ошибок"
          value={`${(metrics.failRate * 100).toFixed(1)}% (${metrics.failedCalls})`}
        />
        <Row label="Средняя стоимость" value={formatUsd(metrics.avgCostUsd)} />
        <Row
          label="Средняя задержка"
          value={formatDurationMs(metrics.avgDurationMs)}
        />
        <Row
          label="Токены вход/выход (сред.)"
          value={`${Math.round(metrics.avgInputTokens)} / ${Math.round(metrics.avgOutputTokens)}`}
        />
        <Row label="Итоговая стоимость" value={formatUsd(metrics.totalCostUsd)} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <dt className="text-fg-tertiary">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function CreateExperimentDialog({
  taskType,
  defaultControlProvider,
  defaultControlModel,
  onClose,
  onStarted,
}: {
  taskType: string;
  defaultControlProvider: AiModelProvider;
  defaultControlModel: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [controlProvider, setControlProvider] = useState<AiModelProvider>(
    defaultControlProvider,
  );
  const [controlModel, setControlModel] = useState(defaultControlModel);
  const [variantProvider, setVariantProvider] = useState<AiModelProvider>(
    defaultControlProvider,
  );
  const [variantModel, setVariantModel] = useState("");
  const [splitPercent, setSplitPercent] = useState(50);
  const [durationDays, setDurationDays] = useState(7);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (controlModel.trim().length === 0) {
      toast.error("Укажите текущую модель");
      return;
    }
    if (variantModel.trim().length === 0) {
      toast.error("Укажите модель-вариант");
      return;
    }
    if (splitPercent < 1 || splitPercent > 99) {
      toast.error("Доля трафика на вариант — от 1 до 99%");
      return;
    }
    if (durationDays < 1 || durationDays > 30) {
      toast.error("Длительность — от 1 до 30 дней");
      return;
    }
    setSubmitting(true);
    try {
      const created = await adminAiModelsApi.experimentCreate({
        taskType,
        controlModel: controlModel.trim(),
        controlProvider,
        variantModel: variantModel.trim(),
        variantProvider,
        splitPercent,
        durationDays,
        notes: notes.trim().length > 0 ? notes.trim() : undefined,
      });
      await adminAiModelsApi.experimentStart(created.id);
      toast.success("Эксперимент запущен");
      onStarted();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось запустить эксперимент");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Запуск A/B-теста на {taskType}</DialogTitle>
          <DialogDescription>
            Трафик задачи реально разделится между текущей моделью и вариантом
            по указанной доле.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Провайдер текущей модели</Label>
              <Select
                value={controlProvider}
                onValueChange={(v) => setControlProvider(v as AiModelProvider)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_MODELS_PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {providerLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Текущая модель</Label>
              <Input
                className="h-8 text-xs font-mono"
                value={controlModel}
                onChange={(e) => setControlModel(e.target.value)}
                placeholder="claude-sonnet-5-20260101"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Провайдер варианта</Label>
              <Select
                value={variantProvider}
                onValueChange={(v) => setVariantProvider(v as AiModelProvider)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_MODELS_PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {providerLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Модель-вариант</Label>
              <Input
                className="h-8 text-xs font-mono"
                value={variantModel}
                onChange={(e) => setVariantModel(e.target.value)}
                placeholder="deepseek-chat"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Доля трафика на вариант (%)</Label>
              <Input
                type="number"
                min={1}
                max={99}
                value={splitPercent}
                onChange={(e) => setSplitPercent(Number(e.target.value))}
              />
            </div>
            <div>
              <Label className="text-xs">Длительность (дней)</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Заметка (опционально)</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Например: проверяем DeepSeek вместо Claude на summary"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Отмена
          </Button>
          <Button size="sm" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "Запускаем…" : "Запустить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
