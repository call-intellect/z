---
type: analysis
status: blocker-documented
feature: tz1-step9-10-config-knobs-remaining
date: 2026-06-21
relates_to:
  - plans/tz/2026-06-20-config-knobs-to-admin-settings.md
  - plans/tz/2026-06-21-three-tz-tails-finalization.md
---

# Ф3 (TZ1 Шаги 9-10) — почему массовый перенос остатка крутилок небезопасен «как есть»

> Контекст: ТЗ `2026-06-21-three-tz-tails-finalization.md` Ф3 = доперенести ~240 ENV-крутилок + 60-90 хардкодов с `this.get`/константы на `resolveSync`/`getDynamic` (admin-editable). При попытке начать с волны W1 (KnowledgeCore) вскрылись два системных рассинхрона, делающих **наивный bulk-перенос источником тихих регрессий**. Зафиксировано здесь, чтобы Ф3 делалась пер-ключевой сверкой, а не механически.

## Что измерено (факты по коду 2026-06-21)

- `typed-config.service.ts`: **349** чтений через `this.get(...)` против **190** уже на `resolveSync`/`getDynamic`. Из 349 значимая часть — секреты/строки подключения/cron (KEEP_ENV — переносить НЕ нужно), но ~24 knowledge-core knob-ключа (`DISTILL_*`, `ENTITY_*`, `THEME_*`, `BLOCK_INGEST_*`, `CHAT_V2_*`, `BITEMPORAL_*`, `FACT_SUPERSEDE_*`) читаются через `this.get` и являются кандидатами W1.

## Блокер 1 — сид ≠ env.schema default (тихая регрессия при конверсии)

Пример (`knowledge.distillMergeThreshold`):
- `backend/scripts/seed-admin-settings.ts:395` сидит значение `envFloat('DISTILL_MERGE_THRESHOLD', 0.85)` → при отсутствии ENV в БД ложится **0.85**.
- `backend/src/common/config/env.schema.ts:304` — `DISTILL_MERGE_THRESHOLD ... .default(0.92)` → текущее live-значение (getter `this.get`) при отсутствии ENV = **0.92**.

Сейчас getter читает env.schema → live = **0.92**. Если механически заменить на `resolveSync('knowledge.distillMergeThreshold','DISTILL_MERGE_THRESHOLD')`, чтение пойдёт admin→env→default, admin-значение засеяно **0.85** → порог слияния distill молча меняется **0.92 → 0.85** в проде. Это прямое нарушение Ship-On «дефолт = текущее поведение» и риск качества графа.

**Вывод:** для каждого ключа W1-W6 перед конверсией нужно сверить seed value ↔ env.schema default ↔ code-fallback и привести к одному. Где они расходятся — это **решение владельца** (какое значение каноническое; для distill: 0.85 или 0.92?), т.е. exception 15b, а не механика.

## Блокер 2 — существующая admin-страница knowledge-core правит «мёртвые» ключи

- `frontend/app/(admin)/admin/ai/knowledge-core/KnowledgeCoreSettingsClient.tsx` использует **33 dotted-ключа** (`knowledge.distill.merge_threshold`, `knowledge.theme.cosine_threshold`, …), **0 camelCase**.
- Реестр (`admin-setting-schema-registry.ts`), сид (`seed-admin-settings.ts`) и код (`typed-config`, воркеры) используют **camelCase** (`knowledge.distillMergeThreshold`).
- Греп backend: dotted-форма (`knowledge.distill.merge_threshold`) **не встречается нигде** — нет нормализации dotted↔camel, ключ не сидится и не читается.

**Следствие:** правки super-admin на этой странице сохраняются в БД под dotted-ключами, которые **никто не читает** → 33 «крутилки» страницы фактически не управляют поведением (pre-existing баг, не относится к этой сессии, но Ф3 обязана его закрыть, иначе «admin-editable» не достигается даже после конверсии getter'ов).

## Что нужно для корректной Ф3 (пер-ключевой runbook, не bulk)

На каждый knob-ключ волны:
1. Сверить три источника: `env.schema` default · seed `value` · code-fallback в getter. Расходятся → решение владельца по каноническому значению.
2. Реестр: убедиться, что admin.key (camelCase) есть с корректным Zod.
3. Сид: значение = согласованный канон (НЕ старое расходящееся).
4. Getter: `this.get('ENV')` → `resolveSync('admin.camelKey','ENV', canon)`.
5. Существующую admin-страницу (knowledge-core и т.п.) перевести с dotted на camelCase, иначе UI правит мёртвые ключи.
6. CRON/concurrency — оставить в ENV (Р1/Р6), только классификация.
7. Гарды `env-classification` + `no-direct-process-env` зелёные; поведение не меняется.

## Рекомендация

Ф3 — это **не механический sweep**, а пер-ключевая сверка с решениями владельца по расходящимся дефолтам и починкой dotted-страниц. Объём ТЗ (3-5 дней) подтверждён. Делать доменными волнами W1→W6 отдельными ТЗ/сессиями, начав с **решения владельца по каноническим значениям** расходящихся ключей (минимум distill 0.85 vs 0.92). До этого решения механическую конверсию НЕ выполнять — она ломает прод тихо.

Статус в `2026-06-21-three-tz-tails-finalization.md`: Ф3 **не реализована в сессии 2026-06-21** (обоснование — этот документ); Ф1/Ф2/Ф4 реализованы и в ветке `feature/three-tz-tails-finalization`.
