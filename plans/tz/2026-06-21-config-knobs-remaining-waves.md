---
type: tz
status: ready-to-implement
feature: config-knobs-remaining-waves
date: 2026-06-21
owner: Сергей (владелец)
relates_to:
  - plans/tz/2026-06-20-config-knobs-to-admin-settings.md
  - plans/tz/2026-06-21-three-tz-tails-finalization.md
  - plans/analysis/2026-06-21-tz1-step9-10-config-knobs-blocker.md
  - plans/analysis/2026-06-20-config-env-vs-admin-settings-audit.md
---

# ТЗ — Перенос остатка крутилок ENV → AdminSetting (TZ1 Шаги 9-10, волны W1-W6)

> **Это остаток TZ1.** Гейт (Шаги 1-4) стоит, ~190 геттеров уже на `resolveSync`, 126 ключей получили UI (Ф2 сессии 2026-06-21). Остаётся **~240 ENV-ключей** (читаются через `this.get`, не admin-editable) + **60-90 хардкод-констант**. Этот файл — контракт-first план для `tz-orchestrator`.
>
> **КРИТИЧНО — почему нельзя механически:** наивная замена `this.get('ENV')`→`resolveSync('admin.key','ENV')` даёт **тихую регрессию прода**, потому что сид-дефолты рассинхронены (доказательства — `plans/analysis/2026-06-21-tz1-step9-10-config-knobs-blocker.md`). Поэтому **Фаза 0 (аудит расхождений + решение владельца) — обязательный гейт перед любой волной**. Без Фазы 0 волны НЕ начинать.

## Доказанные рассинхроны (входные факты)
- **Сид ≠ env.schema default:** `knowledge.distillMergeThreshold` сидится `0.85`, `env.schema` default `0.92` → live=0.92, после конверсии стало бы 0.85.
- **Дубль-сиды одного ключа с разными значениями:** `MAX_TAGS_PER_USER` = `200` в `seed-admin-settings.ts`, `50` в `seed-admin-setting-limits.ts` (побеждает последний прогон). Аналогично `MAX_CHAT_REQUESTS_PER_DAY` (500 vs 200), `MAX_RENDER_JOBS_PER_HOUR` (50 vs 10), `MAX_DESTINATIONS_PER_USER` (10 vs 20) и др. (201 сид-вызов с inline-дефолтом).
- **Мёртвые dotted-ключи в UI:** `KnowledgeCoreSettingsClient.tsx` правит 33 ключа вида `knowledge.distill.merge_threshold` (dotted), которых **нет нигде в backend** (код/реестр/сид — camelCase `knowledge.distillMergeThreshold`). Правки супер-админа там ни на что не влияют.

## Измерения (база, перепроверить перед стартом)
- `typed-config.service.ts`: **349** `this.get(...)` vs **190** `resolveSync`/`getDynamic`.
- `env-classification.ts`: `KEEP_ENV_KEYS` (110, остаются в ENV) + `ADMIN_FALLBACK_ENV_KEYS` (251, кандидаты).
- Реестр `admin-setting-schema-registry.ts`: 275 ключей.

---

## Сквозные правила (все фазы)
- **Ship-On / поведение не меняется:** после конверсии live-значение ключа = его текущее live-значение ДО конверсии (= env.schema default, если ENV не задан). Расхождения разрешает владелец в Фазе 0, НЕ кодер по своему усмотрению.
- **Крутилки в AdminSetting** (CLAUDE.md §9): `resolveSync('admin.camelKey','ENV', canon)` / `getDynamic('admin.key', undefined, codeFallback)` для хардкодов. Прямой `process.env.*` запрещён (гард).
- **CRON/concurrency — остаются в ENV** (Р1/Р6): только классификация в `KEEP_ENV_KEYS`/`ADMIN_FALLBACK_ENV_KEYS`, без переноса в реестр.
- **Без комментариев в коде; UI русский; парные токены.** Сиды — `createPrismaClient()`, идемпотентны, защита admin-edited (`updatedBy !== 'system'` не перетирать — см. образец `seed-admin-setting-retention-logging.ts`).
- **Гарды зелёные на каждом коммите:** `env-classification.guard.spec.ts` + `no-direct-process-env.guard.spec.ts`.
- Новые сиды → `apply-prod-deploy.ts` STEPS + `prod-deploy-log.md` Шаг 7.

---

## Фаза 0 — Аудит расхождений + решение владельца (ГЕЙТ, без неё волны не начинать)

**Цель.** Свести ВСЕ расхождения в один машинный отчёт, чтобы владелец принял канон одним проходом, а не пер-ключом вслепую.

**Что входит:**
1. Скрипт-аудит `backend/scripts/diag-config-knobs-divergence.ts` (read-only, `createPrismaClient`), который для каждого `ADMIN_FALLBACK_ENV_KEYS`-ключа печатает таблицу: `ENV-имя · env.schema default · seed value(ы) (с указанием файла) · текущее значение в БД · code-fallback в getter · читается как (this.get / resolveSync) · admin.camelKey (если в реестре)`. Помечает: 🔴 seed≠env.schema, 🔴 дубль-сиды с разными значениями, 🟡 в реестре нет, 🟡 dotted-ключ на UI без backend.
2. Аналогичный под-отчёт «мёртвые dotted-ключи UI»: грепом сверить ключи всех admin-страниц (`frontend/app/(admin)/**`) с реестром backend; вывести ключи, которых нет в backend.
3. Отчёт в `plans/analysis/2026-06-21-config-knobs-divergence-report.md`.
4. **Решение владельца — ОДНО правило, не пер-ключ** (рекомендация, обоснование — `plans/analysis/2026-06-21-config-knobs-divergence-PLAIN.md`): **канон = текущее живое значение** (то, что код резолвит сегодня = прод-ENV если задан, иначе `env.schema` default). Перенос сохраняет поведение идентично, сид приводится к живому значению, дубль-сиды устраняются. Владелец одобряет это правило один раз. **Опционально** — отдельный список крутилок, которые владелец ХОЧЕТ поменять на новое значение; их меняем ПОСЛЕ переноса отдельным осознанным шагом с наблюдением (не во время миграции). Мёртвые dotted-ключи — решения не требуют (баг, чинится в Фазе 1).

**Acceptance Фазы 0:**
- Скрипт прогнан, отчёт сгенерирован, все 🔴 перечислены с колонкой «текущее живое значение».
- Владелец одобрил правило «канон = живое» (+ опц. список на изменение).
- Канон каждого ключа = его текущее живое значение (если ключа нет в опц.-списке).

---

## Фаза 1 — Починка мёртвых dotted-ключей на admin-страницах

**Цель.** Существующие admin-страницы крутилок должны править РЕАЛЬНЫЕ (camelCase) ключи реестра, иначе «admin-editable» недостижим даже после конверсии геттеров.

**Что входит:**
- По под-отчёту Фазы 0: в `KnowledgeCoreSettingsClient.tsx` (и любых других страницах с dotted-ключами) заменить `knowledge.distill.merge_threshold` → `knowledge.distillMergeThreshold` и т.д. — на канонические camelCase-ключи из реестра. Сверить каждый со списком реестра (0 сирот, как в Ф2).
- Если на странице ключ, которого нет в реестре — добавить в реестр + сид (канон из Фазы 0) либо удалить поле (если ключ мёртвый и не нужен).

**Acceptance:** typecheck/lint/build зелёные; машинная сверка ключей всех admin-страниц с реестром = **0 сирот**; qa: правка значения на странице реально меняется в БД под camelCase-ключом.

---

## Фазы W1-W6 — конверсия геттеров (по одной волне = один коммит/сид)

**Рунбук на каждый knob-ключ волны (строго):**
1. Канон из Фазы 0 (env.schema default или решение владельца).
2. Реестр `['<admin.camelKey>', <Zod>]` — если ещё нет.
3. Сид (единый источник; **устранить дубль-сиды** — значение = канон, в ОДНОМ файле).
4. Геттер `typed-config`/сервис: `this.get('ENV')` → `resolveSync<T>('<admin.camelKey>','ENV', canon)`.
5. UI-поле на профильной странице (или новой по образцу `DomainSettings`-scaffold из Ф2).
6. Док-триггеры (`prod-deploy-log` Шаг 7, профильная `01_projects/*`).

**Волны (ключи перепроверить грепом `this.get` в typed-config — строки дрейфуют):**
- **W1 KnowledgeCore (~24 knob + ~4 cron):** `DISTILL_*`, `ENTITY_*`, `THEME_*`, `BLOCK_INGEST_*`, `CHAT_V2_*`, `BITEMPORAL_*`, `FACT_SUPERSEDE_*`, `ENTITY_INGEST_RESOLVE_*`, `EXTRACTION_TYPED_ENTITY_MIN_CONFIDENCE`. CRON (`*_CRON`) — оставить в ENV. **Включает Фазу-1-фикс knowledge-core страницы.**
- **W2 Skill/clone/persona (~34):** `SKILL_*`, `CLONE_*`, `PERSONA_REBUILD_*`, `EXECUTABLE_PERSONA_*`, `DOMAIN_EXPANDER_*`, `BRAND_VOICE_*` (перепроверить ложноположительные «не читается»).
- **W3 BetaOps остаток (~20):** `PROACTIVE_RULE_*`, `INVITE_*`, `MAGIC_LINK_*`, `COMMITMENT_*` (кроме часов из TZ1 Шага 8, уже перенесены).
- **W4 Tracker/governance (~31):** `AUTORULE_*`, `PRACTICE_SKILLS_*`, `GEPA_*` (кроме моделей `gepa.reflectionLm`/`taskLm`, уже в реестре), `TEMPORAL_PROBE_*`, `SIGNAL_TYPE_*`.
- **W5 Остаток доменов:** DialogLayer / Insights / Ideas / Budget / Recording / Conversational / MaxBot — все `this.get`-крутилки, не вошедшие в W1-W4.
- **W6 Хардкод-крутилки (60-90):** магия в коде/SQL по образцу `probe.service.ts` (`getDynamic(key, undefined, codeFallback)`): пороги knowledge-core (`similarity>=0.78`/`cosine>=0.92` в SQL `entity-resolution.service.ts`; `dynamicScore>0.1`), dashboard-пороги настроения/выгорания/окна, ai (`MONOLOGUE_THRESHOLD_MS`/`TURN_GAP_MS`/scrub-дни), billing/tracker.

**Acceptance на каждую волну:**
- typecheck (вкл `.spec`)/lint/build зелёные; гарды `env-classification` + `no-direct-process-env` зелёные.
- Ключи волны: реестр + ЕДИНЫЙ сид (дубли устранены) + STEPS; геттер через `resolveSync`/`getDynamic`.
- **Поведенческий тест на сохранность дефолта:** для 2-3 репрезентативных ключей волны — тест, что `resolveSync` без admin-значения и без ENV возвращает канон (= текущее live). Это машинная защита от регрессии Ship-On.
- Сид прогнан дважды (идемпотентность; admin-edited не перетёрт).
- К концу W1-W6: в `env.schema.ts` остаются только `KEEP_ENV_KEYS` + cron/concurrency-fallback; магия из hot-path/SQL вынесена.

---

## Prod-deploy
- Каждая волна: новый/обновлённый сид `seed-admin-setting-*` → `apply-prod-deploy.ts` STEPS (phase `update`) + `prod-deploy-log.md` Шаг 7. Прогон на проде: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- Миграций БД нет (только AdminSetting-строки через сиды). ENV в проде можно чистить от перенесённых ключей ПОСЛЕ выката волны (необязательно — code-fallback держит).

## DoD (на каждую фазу/волну)
- typecheck/lint/build + гарды конфигурации зелёные; vitest по затронутому.
- `second-brain/02_architecture/*` (где менялись пороги логики) + профильные `01_projects/*` + `prod-deploy-log` обновлены; рефлексия.
- Ревью `strict-production-review-gate`: главный фокус — **нет регрессий поведения** (дефолт = текущее live).

## Порядок
Фаза 0 (гейт, решение владельца) → Фаза 1 (фикс dotted-страниц) → W1 → W2 → … → W6. Волны серийны (делят `typed-config` + реестр + сиды). Можно резать каждую волну на под-коммиты по поддомену против overload.

## Итог
_(заполняет tz-orchestrator: какие волны закрыты, коммиты, что осталось.)_
