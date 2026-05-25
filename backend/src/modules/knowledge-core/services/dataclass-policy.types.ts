/**
 * W4.1 — типы DataClassPolicyService.
 *
 * Источник: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md
 * §4 «Глобальные определения волны» + §W4.1 «DataClassPolicyService + shadow mode».
 *
 * Намеренно держим типы отдельно от сервиса — чтобы DTO-слои и сторонние
 * консюмеры (admin-инструменты, отладочные дампы аудита в logs) могли
 * импортировать без вытаскивания всего DI-графа NestJS.
 */

import type { DataClass } from '@prisma/client';

/**
 * Производный «kind» — что именно собираемся записать в БД (либо отправить
 * в outbound-канал). Маппится на floor-уровень DataClass из §4 ТЗ.
 *
 * Список покрывает все 9 специалистов + chat-v2 + дополнительные побочные
 * потоки (ai_usage_log пишется ПОСЛЕ derive — важно: log нельзя писать ДО
 * расчёта класса, иначе утечёт сырой sensitive в общую таблицу).
 */
export type DerivedKind =
  | 'idea_block'
  | 'insight'
  | 'decision'
  | 'card_rollup'
  | 'executable_persona'
  | 'skill_profile'
  | 'skill_trait'
  // Дополнительные категории — для специалистов 3.1 (регламенты/процессы/политики)
  // и 3.6 (idea). Floor у них = `internal` (см. §4 ТЗ — приравнены к idea_block).
  | 'idea'
  | 'regulation'
  | 'process'
  | 'policy'
  | 'chat_context'
  | 'ai_usage_log'
  | 'conflict_item'
  | 'probe_event';

/**
 * «Откуда» пришло значение dataClass в derive — нужно для аудита и для
 * специального правила private-aggregation (агрегация ≥2 разных Person'ов
 * в private-источниках анонимизирует результат до sensitive).
 *
 * `sourceKind` — широкое поле (string union extended на будущее), потому что
 * источники могут быть разными: IdeaBlock, Decision, Insight, Card, Entity,
 * SkillTrait, ChatMessage и т.п.
 */
export type DataClassSource = {
  dataClass: DataClass;
  subjectPersonId?: string | null;
  sourceId: string;
  sourceKind:
    | 'idea_block'
    | 'decision'
    | 'insight'
    | 'card'
    | 'entity'
    | 'skill_trait'
    | 'idea'
    | 'regulation'
    | 'process'
    | 'chat_message'
    | 'other';
};

/**
 * Полный audit-trail вычисления dataClass. Сохраняется в Json-поле
 * `<Projection>.dataClassAudit` на W4.2 (в W4.1 — только в логах и метриках).
 *
 * Поля:
 *   - `sourceIds` — id всех учтённых источников (для трассировки в случае
 *     инцидента «откуда взялся sensitive»).
 *   - `sourceKind` — тип источника (для read-friendly отчётов).
 *   - `inputClasses` — массив исходных DataClass'ов (для воспроизведения).
 *   - `floorApplied` — floor, который был применён по правилу для `kind`.
 *   - `rule` — какое именно правило сработало. Свободная строка из набора:
 *     `max-and-floor` | `private-aggregation-to-sensitive`
 *     | `explicit-floor` | `single-source-passthrough`.
 *   - `result` — итоговый DataClass.
 *   - `resultSubjectPersonId` — id Person'а для `private`-результата либо
 *     null (агрегация анонимизировала).
 *   - `derivedAt` — ISO-timestamp вычисления (UTC).
 *   - `policyVersion` — версия правил из ENV `DATACLASS_POLICY_VERSION`.
 */
export type DataClassAudit = {
  sourceIds: string[];
  sourceKind: string;
  inputClasses: DataClass[];
  floorApplied: DataClass;
  rule:
    | 'max-and-floor'
    | 'private-aggregation-to-sensitive'
    | 'explicit-floor'
    | 'single-source-passthrough';
  result: DataClass;
  resultSubjectPersonId: string | null;
  derivedAt: string;
  policyVersion: string;
};

/**
 * Конфигурация outbound-канала / sink'а — для `canEmit` (W4.3).
 *
 * Поддерживается четыре формы:
 *   - `kind='channel_binding'` — ChannelBinding (in_app / telegram / email).
 *     Используется `maxDataClass` lattice (payload <= max).
 *   - `kind='issue_webhook'` — IssueWebhook (outbound webhook tracker'а).
 *     Используется `allowedDataClasses[]` (set membership). Пустой массив
 *     трактуется как `['public', 'internal']` (default по ТЗ §W4.3).
 *   - `kind='export'` — административный export endpoint
 *     (`/admin/llm/preference-dataset` и аналогичные). Используется
 *     `ownerOnly` + reject `private` всегда.
 *   - `kind='public_api'` — публичный share/API. Принимает только `public`.
 *
 * Legacy short-hand `{ maxDataClass }` без явного `kind` сохраняется как
 * `channel_binding` (упрощает существующие W4.1-call-sites и тесты).
 */
export type SinkConfig =
  | {
      kind: 'channel_binding';
      /** Самый строгий dataClass, который binding имеет право принять. */
      maxDataClass: DataClass;
      /** Имя канала / kind для логов и метрик. */
      channel?: string;
      /** Получатель — нужен для проверки private+subjectPersonId. */
      recipientUserId?: string;
      /** Person у получателя — для private gating (= subjectPersonId payload'а). */
      recipientPersonId?: string | null;
      /** True если получатель — owner или super_admin (override private). */
      recipientIsOwnerOrSuper?: boolean;
    }
  | {
      kind: 'issue_webhook';
      /**
       * Allow-list классов данных. Пустой массив = `['public', 'internal']`
       * (см. ТЗ §W4.3 и `IssueWebhook.allowedDataClasses` default).
       */
      allowedDataClasses: DataClass[];
      /** ID webhook'а / имя — для логов и метрик. */
      channel?: string;
    }
  | {
      kind: 'export';
      /** True если запрашивающий — owner. Для `private` обязательно. */
      ownerOnly: boolean;
      channel?: string;
    }
  | {
      kind: 'public_api';
      channel?: string;
    }
  // Legacy short-hand для W4.1 call-sites: `{ maxDataClass: ... }` без kind.
  // Трактуется как `channel_binding` без recipient-checks.
  | {
      maxDataClass: DataClass;
      channel?: string;
      kind?: undefined;
    };
