"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Hourglass,
  KeyRound,
  Loader2,
  Sparkles,
  Users,
} from "lucide-react";

import { ApiError } from "@/api/api-error";
import { importsApi } from "@/api/tracker/imports.api";
import { toast } from "sonner";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";
import { Textarea } from "@/ui/shadcn/textarea";

import {
  FreeTextMappingStep,
  MaskedWebhookDisplay,
  SummaryTile,
  WizardSteps,
  isLikelyBitrixWebhook,
  parseIdList,
  parseUserMappings,
  type WizardStepDef,
} from "./_shared";

type Step = "connect" | "groups" | "mapping" | "preview";

const STEPS: WizardStepDef[] = [
  { id: "connect", label: "Подключение" },
  { id: "groups", label: "Группы" },
  { id: "mapping", label: "Сопоставление" },
  { id: "preview", label: "Подтверждение" },
];

export function Bitrix24Wizard({
  orgId,
  onCancel,
}: {
  orgId: string;
  onCancel: () => void;
}) {
  const router = useRouter();

  const [step, setStep] = useState<Step>("connect");

  const [webhookUrl, setWebhookUrl] = useState("");
  const webhookValid = isLikelyBitrixWebhook(webhookUrl);

  const [groupsInput, setGroupsInput] = useState("");
  const selectedGroupIds = useMemo(
    () => parseIdList(groupsInput),
    [groupsInput],
  );
  const groupsValid =
    selectedGroupIds.length > 0 &&
    selectedGroupIds.every((id) => /^\d+$/.test(id));
  const invalidGroupIds = useMemo(
    () => selectedGroupIds.filter((id) => !/^\d+$/.test(id)),
    [selectedGroupIds],
  );

  const [mappingText, setMappingText] = useState("");
  const parsedMappings = useMemo(
    () => parseUserMappings(mappingText),
    [mappingText],
  );

  const [submitting, setSubmitting] = useState(false);

  const goNext = () => {
    if (step === "connect") setStep("groups");
    else if (step === "groups") setStep("mapping");
    else if (step === "mapping") setStep("preview");
  };
  const goBack = () => {
    if (step === "preview") setStep("mapping");
    else if (step === "mapping") setStep("groups");
    else if (step === "groups") setStep("connect");
    else onCancel();
  };

  const handleStart = async () => {
    setSubmitting(true);
    try {
      const res = await importsApi.startBitrix24(orgId, {
        webhookUrl: webhookUrl.trim(),
        selectedGroupIds,
        userMappings:
          Object.keys(parsedMappings.mappings).length > 0
            ? parsedMappings.mappings
            : undefined,
      });
      toast.success("Импорт из Битрикс24 запущен");
      router.push(`/integrations/import-tracker/${res.importLogId}`);
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Не удалось запустить импорт. Попробуйте ещё раз.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <WizardSteps steps={STEPS} current={step} />

      {step === "connect" && (
        <ConnectStep
          webhookUrl={webhookUrl}
          onChange={setWebhookUrl}
          valid={webhookValid}
          onBack={onCancel}
          onNext={goNext}
        />
      )}

      {step === "groups" && (
        <GroupsStep
          value={groupsInput}
          onChange={setGroupsInput}
          parsed={selectedGroupIds}
          invalidIds={invalidGroupIds}
          canNext={groupsValid}
          onBack={goBack}
          onNext={goNext}
        />
      )}

      {step === "mapping" && (
        <FreeTextMappingStep
          value={mappingText}
          onChange={setMappingText}
          parsed={parsedMappings}
          onBack={goBack}
          onNext={goNext}
          stepTitle="Шаг 3: Сопоставление пользователей Битрикс24"
        />
      )}

      {step === "preview" && (
        <PreviewStep
          webhookUrl={webhookUrl}
          groupsCount={selectedGroupIds.length}
          mappedCount={parsedMappings.mappedCount}
          skippedCount={parsedMappings.skippedCount}
          onBack={goBack}
          onStart={() => void handleStart()}
          submitting={submitting}
        />
      )}
    </div>
  );
}

function ConnectStep({
  webhookUrl,
  onChange,
  valid,
  onBack,
  onNext,
}: {
  webhookUrl: string;
  onChange: (v: string) => void;
  valid: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const touched = webhookUrl.trim().length > 0;
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
            <KeyRound size={18} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-fg-primary">
              Шаг 1: Подключите Битрикс24 по webhook
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Создайте «Входящий webhook» в вашем портале Битрикс24 с правами{" "}
              <code className="rounded bg-bg-overlay px-1 py-0.5 text-xs">
                task
              </code>{" "}
              и{" "}
              <code className="rounded bg-bg-overlay px-1 py-0.5 text-xs">
                sonet_group
              </code>
              , затем вставьте полученный URL ниже. Мы будем читать ваши задачи
              только в режиме чтения.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <Label htmlFor="webhook-url" className="text-sm">
            Webhook URL
          </Label>
          <Input
            id="webhook-url"
            type="url"
            value={webhookUrl}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://your-portal.bitrix24.ru/rest/12/AbCdEf123456/"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
          />
          {touched && !valid && (
            <p className="text-xs text-danger">
              URL не похож на webhook Битрикс24. Ожидаем формат:{" "}
              <code className="rounded bg-bg-overlay px-1 py-0.5">
                https://*.bitrix24.ru/rest/&lt;userId&gt;/&lt;token&gt;/
              </code>
            </p>
          )}
          {touched && valid && (
            <p className="flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 size={14} /> Формат корректный
            </p>
          )}
        </div>

        <div className="mt-5 rounded-md border border-border-subtle bg-bg-elevated p-4 text-xs text-fg-secondary">
          <div className="mb-2 flex items-center gap-1.5 font-medium text-fg-primary">
            <ClipboardList size={14} /> Как получить webhook URL
          </div>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              В Битрикс24 откройте «Разработчикам» → «Другое» → «Входящий
              вебхук».
            </li>
            <li>
              Установите права:{" "}
              <code className="rounded bg-bg-overlay px-1">task</code>,{" "}
              <code className="rounded bg-bg-overlay px-1">tasks</code>,{" "}
              <code className="rounded bg-bg-overlay px-1">sonet_group</code>,{" "}
              <code className="rounded bg-bg-overlay px-1">user</code>,{" "}
              <code className="rounded bg-bg-overlay px-1">disk</code>.
            </li>
            <li>Сохраните и скопируйте «URL вашего вебхука для вызова».</li>
          </ol>
          <a
            href="https://helpdesk.bitrix24.ru/open/8093693/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-accent hover:underline"
          >
            Полная инструкция Битрикс24 <ExternalLink size={12} />
          </a>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p>
            Webhook URL — это секрет. Мы шифруем его в БД (AES-256-GCM) и
            используем только для импорта. После завершения импорта вебхук можно
            отозвать в админке Битрикс24.
          </p>
        </div>

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={14} /> К выбору источника
          </Button>
          <Button onClick={onNext} disabled={!valid}>
            Дальше <ArrowRight size={14} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function GroupsStep({
  value,
  onChange,
  parsed,
  invalidIds,
  canNext,
  onBack,
  onNext,
}: {
  value: string;
  onChange: (v: string) => void;
  parsed: string[];
  invalidIds: string[];
  canNext: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
            <Users size={18} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-fg-primary">
              Шаг 2: Какие группы (проекты) импортировать
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              В Битрикс24 рабочие группы — это аналог проектов. Каждая группа
              станет отдельным проектом в Коре. ID группы — это число в URL
              группы (например, для{" "}
              <code className="rounded bg-bg-overlay px-1 py-0.5 text-xs">
                /workgroups/group/42/
              </code>{" "}
              ID = 42).
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <Label htmlFor="groups-input" className="text-sm">
            ID групп через запятую или пробел
          </Label>
          <Textarea
            id="groups-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="42, 17, 105"
            className="min-h-[100px] font-mono text-sm"
          />
          <p className="text-xs text-fg-tertiary">
            Распознано ID: <b>{parsed.length}</b>. Только числа — буквы и
            спецсимволы будут отброшены.
          </p>
        </div>

        {invalidIds.length > 0 && (
          <div className="mt-3 rounded-md border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
            <div className="flex items-center gap-1.5 font-medium">
              <AlertTriangle size={14} /> Не похоже на ID Битрикс24:
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {invalidIds.slice(0, 5).map((id) => (
                <li key={id}>
                  <code className="font-mono">{id}</code>
                </li>
              ))}
              {invalidIds.length > 5 && <li>… ещё {invalidIds.length - 5}</li>}
            </ul>
            <p className="mt-1">
              ID — только цифры. Уберите некорректные значения, чтобы
              продолжить.
            </p>
          </div>
        )}

        <div className="mt-4 flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 p-3 text-xs text-fg-secondary">
          <ClipboardList size={14} className="mt-0.5 shrink-0 text-accent-fg" />
          <p>
            Импортируем только указанные группы — задачи вне этих групп
            пропустим. Закрытые задачи и комментарии перенесём вместе с
            активными.
          </p>
        </div>

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={14} /> Назад
          </Button>
          <Button onClick={onNext} disabled={!canNext}>
            Дальше <ArrowRight size={14} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewStep({
  webhookUrl,
  groupsCount,
  mappedCount,
  skippedCount,
  onBack,
  onStart,
  submitting,
}: {
  webhookUrl: string;
  groupsCount: number;
  mappedCount: number;
  skippedCount: number;
  onBack: () => void;
  onStart: () => void;
  submitting: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-fg-primary">
              Шаг 4: Подтверждение запуска
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Проверьте параметры — после старта запрос пойдёт к вашему порталу
              Битрикс24. Импорт можно отменить, пока он идёт.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="text-xs uppercase tracking-wide text-fg-tertiary">
            Webhook (токен замаскирован)
          </div>
          <MaskedWebhookDisplay url={webhookUrl} />
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-4">
          <SummaryTile
            icon={<Users size={16} />}
            label="Групп → Проектов"
            value={groupsCount}
          />
          <SummaryTile label="Сопоставлено user" value={mappedCount} />
          <SummaryTile label="Пропущено (skip)" value={skippedCount} />
        </dl>

        <div className="mt-5 flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 p-3 text-xs text-fg-secondary">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-accent-fg" />
          <p>
            Импорт идемпотентен: повторный запуск не создаст дублей. Прогресс и
            журнал ошибок откроются на следующей странице.
          </p>
        </div>

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onBack} disabled={submitting}>
            <ArrowLeft size={14} /> Назад
          </Button>
          <Button onClick={onStart} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Запускаем…
              </>
            ) : (
              <>
                <Hourglass size={14} /> Начать импорт
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
