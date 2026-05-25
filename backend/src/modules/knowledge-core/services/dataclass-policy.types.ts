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
 * Минимальная конфигурация outbound-канала / sink'а — для `canEmit`.
 * Полноценный SinkConfig (с per-канал hooks, retry-policy, secret rotation)
 * будет в W4.3; здесь оставлен только потолок dataClass, которого достаточно
 * для логики gating.
 */
export type SinkConfig = {
  /** Самый строгий dataClass, который sink имеет право принять. */
  maxDataClass: DataClass;
  /** Опционально: имя канала для логов/метрик. */
  channel?: string;
};
