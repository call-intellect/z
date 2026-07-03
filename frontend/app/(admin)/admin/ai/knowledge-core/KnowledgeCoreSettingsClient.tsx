"use client";

import { useState } from "react";
import {
  Activity,
  Brain,
  Cpu,
  History as HistoryIcon,
  Layers,
  Link2,
  Loader2,
  Network,
  ScrollText,
  Sparkles,
  Target,
  UserSquare,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import { z, type ZodTypeAny } from "zod";

import { AdminSection } from "@/ui/components/admin/AdminSection";
import { AdminSettingField } from "@/ui/components/admin/AdminSettingField";
import { AdminSettingHistoryDrawer } from "@/ui/components/admin/AdminSettingHistoryDrawer";
import { AdminTabs, type AdminTabDef } from "@/ui/components/admin/AdminTabs";
import { ApiError } from "@/api/api-error";
import { useAdminSettingEditor } from "@/hooks/useAdminSettingEditor";
import { Button } from "@/ui/shadcn/button";
import { adminRootCrumb } from "@/ui/components/admin/brand";

type SettingSpec<T> = {
  key: string;
  label: string;
  description?: string;
  schema: ZodTypeAny;
  defaultValue: T;
};

type SettingGroup = {
  value: string;
  label: string;
  icon: LucideIcon;
  settings: SettingSpec<unknown>[];
};

const ratio01 = (def: number) => z.number().min(0).max(1).default(def);

const positiveInt = (def: number, max?: number) => {
  let s = z.number().int().min(1);
  if (typeof max === "number") s = s.max(max);
  return s.default(def);
};

const GROUPS: SettingGroup[] = [
  {
    value: "distill",
    label: "Distill",
    icon: Wand2,
    settings: [
      {
        key: "knowledge.distillMergeThreshold",
        label: "Порог слияния (cosine)",
        description:
          "Минимальная косинусная близость для слияния схожих distill-блоков.",
        schema: ratio01(0.85),
        defaultValue: 0.85,
      },
      {
        key: "knowledge.distillDebounceMs",
        label: "Debounce, мс",
        description: "Задержка между повторными ингестами одного источника.",
        schema: positiveInt(2000),
        defaultValue: 2000,
      },
      {
        key: "knowledge.distillKnnTopK",
        label: "kNN top-k",
        description:
          "Сколько ближайших соседей рассматривать при кандидате на слияние.",
        schema: positiveInt(20, 200),
        defaultValue: 20,
      },
    ],
  },
  {
    value: "entity",
    label: "Entity",
    icon: Network,
    settings: [
      {
        key: "knowledge.entityMergeThreshold",
        label: "Порог слияния сущностей",
        description: "Косинус для дедупа Entity (люди, компании, проекты).",
        schema: ratio01(0.86),
        defaultValue: 0.86,
      },
    ],
  },
  {
    value: "theme",
    label: "Theme",
    icon: Layers,
    settings: [
      {
        key: "knowledge.themeCosineThreshold",
        label: "Порог темы (cosine)",
        description:
          "Минимальная близость для отнесения блока к существующей теме.",
        schema: ratio01(0.78),
        defaultValue: 0.78,
      },
      {
        key: "knowledge.themeClusterMinSize",
        label: "Мин. размер кластера",
        description: "Минимум блоков для создания темы.",
        schema: positiveInt(3),
        defaultValue: 3,
      },
      {
        key: "knowledge.themeClusteringMinBlocks",
        label: "Мин. блоков для запуска кластеризатора",
        description: "Если в Org меньше блоков — кластеризация пропускается.",
        schema: positiveInt(20),
        defaultValue: 20,
      },
      {
        key: "theme.autofill.enabled",
        label: "Авто-наполнение тем (kill-switch)",
        description:
          "Пользовательские темы сами наполняются блоками ≥ порога. Выключение останавливает воркер.",
        schema: z.boolean().default(true),
        defaultValue: true,
      },
      {
        key: "theme.autofill.threshold",
        label: "Порог авто-добавления в тему",
        description:
          "Минимальная близость блока к теме для авто-привязки. По умолчанию 0.72.",
        schema: ratio01(0.72),
        defaultValue: 0.72,
      },
      {
        key: "theme.autofill.scanWindowDays",
        label: "Окно свежих блоков (дней)",
        description: "Сколько дней назад сканировать блоки для авто-наполнения.",
        schema: positiveInt(14),
        defaultValue: 14,
      },
      {
        key: "theme.autofill.maxPerScan",
        label: "Макс. авто-добавлений за проход",
        description: "Потолок авто-привязок на тему за один проход воркера.",
        schema: positiveInt(50),
        defaultValue: 50,
      },
      {
        key: "theme.autofill.dedupeSimilarity",
        label: "Порог near-дубля (не добавлять)",
        description:
          "Кандидат-дубль не добавляется, если косинус к уже выбранному ≥ этого.",
        schema: ratio01(0.97),
        defaultValue: 0.97,
      },
    ],
  },
  {
    value: "idea",
    label: "Idea",
    icon: Sparkles,
    settings: [
      {
        key: "knowledge.ideaClusterThreshold",
        label: "Порог кластера идей",
        schema: ratio01(0.82),
        defaultValue: 0.82,
      },
      {
        key: "knowledge.ideaMinSupportersForCluster",
        label: "Мин. сторонников идеи",
        description:
          "Минимум упоминаний разными участниками для группировки в Idea.",
        schema: positiveInt(2),
        defaultValue: 2,
      },
    ],
  },
  {
    value: "insight",
    label: "Insight",
    icon: Brain,
    settings: [
      {
        key: "knowledge.insightClusterThreshold",
        label: "Порог кластера инсайтов",
        schema: ratio01(0.84),
        defaultValue: 0.84,
      },
      {
        key: "knowledge.insightFrequencyWindowDays",
        label: "Окно частоты (дни)",
        description: "Окно, в котором считаем повторяемость инсайта.",
        schema: positiveInt(30),
        defaultValue: 30,
      },
      {
        key: "knowledge.insightSpikeRatio",
        label: "Коэффициент всплеска",
        description: "Во сколько раз частота должна превысить базовую линию.",
        schema: z.number().min(0).max(100).default(2),
        defaultValue: 2,
      },
    ],
  },
  {
    value: "skill",
    label: "Skill",
    icon: Cpu,
    settings: [
      {
        key: "knowledge.skillMinObservations",
        label: "Мин. наблюдений по скиллу",
        schema: positiveInt(3),
        defaultValue: 3,
      },
      {
        key: "knowledge.skillTraitSimilarityThreshold",
        label: "Порог схожести трейтов",
        schema: ratio01(0.8),
        defaultValue: 0.8,
      },
      {
        key: "knowledge.skillClusterSimilarityThreshold",
        label: "Порог склейки блоков в трейт",
        description:
          "Cosine-порог, при котором похожие reasoning-блоки склеиваются в один навык/принцип клона. Ниже — трейты собираются легче из перефразировок.",
        schema: ratio01(0.72),
        defaultValue: 0.72,
      },
      {
        key: "knowledge.skillLookbackMonths",
        label: "Глубина просмотра (мес.)",
        schema: positiveInt(6),
        defaultValue: 6,
      },
      {
        key: "knowledge.skillDecayMonths",
        label: "Месяцы затухания",
        description: "Через сколько месяцев скилл начинает «угасать».",
        schema: positiveInt(12),
        defaultValue: 12,
      },
      {
        key: "knowledge.skillArchiveMonths",
        label: "Месяцы до архивации",
        schema: positiveInt(24),
        defaultValue: 24,
      },
    ],
  },
  {
    value: "persona",
    label: "Persona",
    icon: UserSquare,
    settings: [
      {
        key: "knowledge.personaMinTraits",
        label: "Мин. трейтов для персоны",
        description:
          "Минимум черт метода (skill+value+motivation+process_marker), при котором собирается клон. Совпадает с код-дефолтом (3).",
        schema: positiveInt(3),
        defaultValue: 3,
      },
      {
        key: "knowledge.personaRoleAggMinPersons",
        label: "Мин. персон для роли",
        description:
          "Сколько носителей нужно для сборки клона роли. 1 — одиночная должность (типовой SMB) тоже получает клон.",
        schema: positiveInt(1),
        defaultValue: 1,
      },
      {
        key: "knowledge.executablePersonaThresholdTraitsCount",
        label: "Порог executable-персоны (трейтов)",
        description:
          "С какого количества трейтов персона считается executable.",
        schema: positiveInt(20),
        defaultValue: 20,
      },
    ],
  },
  {
    value: "block",
    label: "Block",
    icon: Layers,
    settings: [
      {
        key: "knowledge.blockIngestWindowSegments",
        label: "Размер окна сегментов",
        description:
          "Сколько сегментов транскрипта объединять в один кандидат-блок.",
        schema: positiveInt(8),
        defaultValue: 8,
      },
      {
        key: "knowledge.blockIngestMaxTokensPerSegment",
        label: "Макс. токенов на сегмент",
        schema: positiveInt(500),
        defaultValue: 500,
      },
      {
        key: "knowledge.blockDynamicScoreDecayDays",
        label: "Затухание динамики (дни)",
        description: "За сколько дней «свежесть» блока падает вдвое.",
        schema: positiveInt(14),
        defaultValue: 14,
      },
    ],
  },
  {
    value: "link",
    label: "Link",
    icon: Link2,
    settings: [
      {
        key: "knowledge.linkMinConfidence",
        label: "Мин. уверенность связи",
        schema: ratio01(0.55),
        defaultValue: 0.55,
      },
      {
        key: "knowledge.linkKnnTopK",
        label: "kNN top-k связей",
        schema: positiveInt(15, 100),
        defaultValue: 15,
      },
      {
        key: "knowledge.linkerMinBlocks",
        label: "Мин. блоков для линкера",
        schema: positiveInt(10),
        defaultValue: 10,
      },
    ],
  },
  {
    value: "curation",
    label: "Curation",
    icon: Target,
    settings: [
      {
        key: "knowledge.curationAutoThresholdDefault",
        label: "Порог автокурации",
        description:
          "С какой confidence факт идёт в curation-очередь без человеческой проверки.",
        schema: ratio01(0.9),
        defaultValue: 0.9,
      },
      {
        key: "knowledge.curationDeepReviewThresholdDefault",
        label: "Порог deep-review",
        description:
          "Ниже этой уверенности факт уходит на глубокую проверку владельцем.",
        schema: ratio01(0.65),
        defaultValue: 0.65,
      },
      {
        key: "knowledge.curationItemExpiryDays",
        label: "Срок жизни элемента очереди (дни)",
        schema: positiveInt(30),
        defaultValue: 30,
      },
    ],
  },
  {
    value: "clone_regulations",
    label: "Регламенты клона",
    icon: ScrollText,
    settings: [
      {
        key: "clone.regulations.retrieval.top_n",
        label: "Сколько правил подтягивать",
        description:
          "Сколько записанных правил должности подмешивать в ответ клона (топ по смысловой близости).",
        schema: positiveInt(6),
        defaultValue: 6,
      },
      {
        key: "clone.regulations.retrieval.min_similarity",
        label: "Порог близости (косинусная дистанция)",
        description:
          "Правила дальше этого порога в ответ клона не подмешиваются.",
        schema: ratio01(0.3),
        defaultValue: 0.3,
      },
      {
        key: "clone.regulations.snapshot.max_items",
        label: "Размер снимка правил",
        description:
          "Сколько заголовков правил держать в компактном указателе-снимке должности.",
        schema: positiveInt(20),
        defaultValue: 20,
      },
      {
        key: "clone.regulations.scope.include_org",
        label: "Включать правила уровня компании",
        description:
          "Подмешивать ли правила всей компании вдобавок к правилам самой должности.",
        schema: z.boolean().default(true),
        defaultValue: true,
      },
    ],
  },
];

const TABS: AdminTabDef[] = GROUPS.map((g) => ({
  value: g.value,
  label: g.label,
  icon: g.icon,
}));

export function KnowledgeCoreSettingsClient() {
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "AI и модели" },
        { label: "Knowledge-Core настройки" },
      ]}
      title="Knowledge-Core настройки"
      description="Пороги слияния, кластеризации, выжимок и связей. БД-override поверх ENV. Сохранение инвалидируется на всех процессах через Redis pub/sub."
    >
      <AdminTabs tabs={TABS} defaultTab="distill">
        {(active) => {
          const group = GROUPS.find((g) => g.value === active);
          if (!group) return null;
          return (
            <div className="grid gap-4 sm:grid-cols-2">
              {group.settings.map((s) => (
                <SettingRow
                  key={s.key}
                  spec={s}
                  onOpenHistory={() => setHistoryKey(s.key)}
                />
              ))}
            </div>
          );
        }}
      </AdminTabs>

      <AdminSettingHistoryDrawer
        settingKey={historyKey}
        open={Boolean(historyKey)}
        onOpenChange={(open) => {
          if (!open) setHistoryKey(null);
        }}
      />
    </AdminSection>
  );
}

function SettingRow<T>({
  spec,
  onOpenHistory,
}: {
  spec: SettingSpec<T>;
  onOpenHistory: () => void;
}) {
  const editor = useAdminSettingEditor<T>(spec.key, {
    schema: spec.schema,
    defaultValue: spec.defaultValue,
  });

  const handleSave = async () => {
    try {
      await editor.save();
      toast.success(`Настройка ${spec.key} сохранена`);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Не удалось сохранить";
      toast.error(msg);
    }
  };

  return (
    <div className="rounded-md border border-border-subtle bg-bg-card p-3">
      <AdminSettingField<T>
        schema={spec.schema}
        value={editor.value}
        onChange={editor.setValue}
        label={spec.label}
        description={spec.description}
        disabled={editor.isLoading || editor.isSaving}
        error={editor.error ?? undefined}
        rightSlot={
          <button
            type="button"
            onClick={onOpenHistory}
            className="inline-flex items-center gap-1 text-[10px] text-fg-tertiary hover:text-fg-primary"
            aria-label="История изменений"
          >
            <HistoryIcon size={11} aria-hidden />
            История
          </button>
        }
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-[10px] text-fg-tertiary">
          <span className="font-mono">{spec.key}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={editor.reset}
            disabled={!editor.isDirty || editor.isSaving}
          >
            Сбросить
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={!editor.isDirty || editor.isSaving}
          >
            {editor.isSaving ? (
              <Loader2 size={12} className="mr-1 animate-spin" />
            ) : null}
            Сохранить
          </Button>
        </div>
      </div>
    </div>
  );
}
