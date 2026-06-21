"use client";

import type { JSX } from "react";
import { z } from "zod";

import {
  DomainSettingsClient,
  type SettingsGroup,
} from "@/ui/components/admin/DomainSettings";

const GROUPS: SettingsGroup[] = [
  {
    title: "Флаги и рубильники",
    description:
      "Включение и выключение механизмов уточняющих вопросов (probe). Все по умолчанию включены (Ship-On).",
    specs: [
      {
        key: "probe.digestEnabled",
        label: "Дайджест probe",
        description:
          "Рубильник ежедневного дайджеста уточняющих вопросов (probe). По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "probe.digestFormulateEnabled",
        label: "Формулировка дайджеста через LLM",
        description:
          "Рубильник LLM-формулировки текста дайджеста probe. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "probe.adaptiveFatigueEnabled",
        label: "Адаптивная усталость",
        description:
          "Рубильник адаптивного снижения частоты probe при признаках усталости пользователя. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "probe.qualityJudgeEnabled",
        label: "Судья качества формулировки",
        description:
          "Рубильник LLM-судьи качества формулировки probe-вопроса (один регенерат при браке). По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "probe.engagementRoutingEnabled",
        label: "Выбор получателя по отзывчивости",
        description:
          "Рубильник выбора получателя probe по engagement-снимку (самый отзывчивый из кандидатов). По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "probe.semanticDedupEnabled",
        label: "Семантический дедуп",
        description:
          "Рубильник семантической дедупликации близких по смыслу probe по эмбеддингу вопроса. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "probe.reaskEnabled",
        label: "Переспрос (re-ask)",
        description:
          "Рубильник одного переспроса при истечении неотвеченного probe (переформулировать и спросить ещё раз). По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "probe.valueGateEnabled",
        label: "Гейт ценности",
        description:
          "Рубильник гейта ценности probe (не задавать малополезные вопросы). По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "probe.responseClassifyEnabled",
        label: "Распознавание свободного ответа",
        description:
          "Распознавание свободного ответа на probe входным классификатором (без явного reply). По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "probe.subjectAddressingEnabled",
        label: "Адресация по субъекту",
        description:
          "Адресация probe про сотрудника самому сотруднику → главе отдела → владельцу (не владельцу напрямую). По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "probe.voiceInputEnabled",
        label: "Голосовой ввод ответа",
        description:
          "Голосовой ввод ответа на probe (микрофон → ASR). По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
    ],
  },
  {
    title: "Пороги и числа",
    description:
      "Числовые параметры доставки, дедупликации и лимитов уточняющих вопросов.",
    specs: [
      {
        key: "probe.digestHourUtc",
        label: "Час доставки дайджеста (UTC)",
        description:
          "Час доставки дайджеста probe в UTC (0–23). По умолчанию 9.",
        schema: z.number().int().min(0).max(23),
        defaultValue: 9,
      },
      {
        key: "probe.digestTouchCap",
        label: "Лимит вопросов в дайджесте",
        description:
          "Максимум уточняющих вопросов в одном дайджесте probe. По умолчанию 5.",
        schema: z.number().int().min(1),
        defaultValue: 5,
      },
      {
        key: "probe.topicCooldownHours",
        label: "Кулдаун темы (часы)",
        description:
          "Окно (часы), в течение которого не задаётся повторный probe по той же теме. По умолчанию 48.",
        schema: z.number().int().min(1),
        defaultValue: 48,
      },
      {
        key: "probe.replyClassifyMinConfidence",
        label: "Порог классификатора reply",
        description:
          "Порог уверенности входного классификатора для отнесения сообщения к ответу на probe (0..1). По умолчанию 0.6.",
        schema: z.number().min(0).max(1),
        defaultValue: 0.6,
      },
      {
        key: "probe.semanticDedupThreshold",
        label: "Порог семантического дедупа",
        description:
          "Cosine-порог семантической дедупликации probe (0..1): выше — вопрос считается дублем. По умолчанию 0.92.",
        schema: z.number().min(0).max(1),
        defaultValue: 0.92,
      },
      {
        key: "probe.semanticDedupWindowHours",
        label: "Окно семантического дедупа (часы)",
        description:
          "Окно поиска близких probe для семантической дедупликации (часы). По умолчанию 72.",
        schema: z.number().int().min(1),
        defaultValue: 72,
      },
      {
        key: "probe.dedupTtlHours",
        label: "TTL дедупа (часы)",
        description:
          "Окно дедупликации уточняющих вопросов (probe) в часах: повторный вопрос той же темы не задаётся раньше. По умолчанию 72.",
        schema: z.number().int().min(1),
        defaultValue: 72,
      },
      {
        key: "probe.rateLimitPerHour",
        label: "Лимит в час",
        description:
          "Лимит уточняющих вопросов (probe) одному пользователю в час. По умолчанию 5.",
        schema: z.number().int().min(1),
        defaultValue: 5,
      },
      {
        key: "probe.rateLimitPerDay",
        label: "Лимит в сутки",
        description:
          "Лимит уточняющих вопросов (probe) одному пользователю в сутки. По умолчанию 20.",
        schema: z.number().int().min(1),
        defaultValue: 20,
      },
      {
        key: "probe.expiryDays",
        label: "Срок жизни вопроса (дни)",
        description:
          "Срок жизни неотвеченного уточняющего вопроса (probe) в днях до истечения. По умолчанию 14.",
        schema: z.number().int().min(1),
        defaultValue: 14,
      },
      {
        key: "probe.quietHoursDefaultTzOffsetMin",
        label: "Смещение часового пояса для тихих часов (мин)",
        description:
          "Смещение часового пояса по умолчанию (минуты) для тихих часов probe, когда у пользователя нет своего. По умолчанию 180 (UTC+3).",
        schema: z.number().int(),
        defaultValue: 180,
      },
      {
        key: "probe.coldStartModeHours",
        label: "Холодный старт (часы)",
        description:
          "Длительность режима холодного старта probe (часы) для нового пользователя/орг. По умолчанию 24.",
        schema: z.number().int().min(0),
        defaultValue: 24,
      },
      {
        key: "probe.responseClassifyMinConfidence",
        label: "Порог распознавания ответа",
        description:
          "Порог уверенности входного классификатора для распознавания свободного ответа на probe (0..1). По умолчанию 0.5.",
        schema: z.number().min(0).max(1),
        defaultValue: 0.5,
      },
    ],
  },
  {
    title: "Триггеры",
    description:
      "Пороги срабатывания probe от детектора выгорания (burnout).",
    specs: [
      {
        key: "probe.reply_latency_rise.factor",
        label: "Рост задержки ответов (множитель)",
        description:
          "Множитель роста задержки ответов в чатах, при котором срабатывает probe-триггер. По умолчанию 2.",
        schema: z.number().positive(),
        defaultValue: 2,
      },
      {
        key: "probe.workload_overload.load_percent",
        label: "Перегрузка по нагрузке (%)",
        description:
          "Порог нагрузки (%), выше которого срабатывает probe-триггер перегрузки. По умолчанию 120.",
        schema: z.number().int().min(1),
        defaultValue: 120,
      },
      {
        key: "probe.meeting_noshows.count",
        label: "Пропуски встреч (количество)",
        description:
          "Количество пропущенных встреч, при котором срабатывает probe-триггер. По умолчанию 3.",
        schema: z.number().int().min(1),
        defaultValue: 3,
      },
    ],
  },
  {
    title: "Курация (сроки)",
    description:
      "Сроки жизни и пороги устаревания элементов очереди курации знаний.",
    specs: [
      {
        key: "knowledge.curationItemExpiryDays",
        label: "Срок жизни элемента очереди (дни)",
        description:
          "Срок жизни элемента очереди курации (дни) до истечения. По умолчанию 30.",
        schema: z.number().int().min(1),
        defaultValue: 30,
      },
      {
        key: "knowledge.curationStaleMonthsThreshold",
        label: "Порог устаревания (месяцы)",
        description:
          "Порог «устаревания» карточки (месяцы без обновления) для детектора устаревших карточек. По умолчанию 6.",
        schema: z.number().int().min(1),
        defaultValue: 6,
      },
      {
        key: "knowledge.curationStaleDynamicScoreThreshold",
        label: "Порог динамического балла устаревания",
        description:
          "Порог динамического балла (0..1), ниже которого карточка считается устаревшей. По умолчанию 0.3.",
        schema: z.number().min(0).max(1),
        defaultValue: 0.3,
      },
    ],
  },
];

export function ProbeSettingsClient(): JSX.Element {
  return (
    <DomainSettingsClient
      breadcrumbLabel="Probe и курация"
      title="Probe и курация"
      description="Рубильники, пороги и триггеры уточняющих вопросов (probe), а также сроки курации знаний."
      groups={GROUPS}
    />
  );
}
