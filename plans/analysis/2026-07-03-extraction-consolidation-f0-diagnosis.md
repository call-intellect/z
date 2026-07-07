---
type: analysis
feature: extraction-consolidation — Ф0 диагностика корня (Д1 сущности, Д2 блоки)
status: diagnosed
created: 2026-07-03
owner_gate: "фикс Ф1/Ф2 меняет прод-поведение мёржа → развилки ниже требуют решения владельца ДО кода"
method: read-only чтение кода (3 параллельных агента + состязательная верификация каждого path:line) + независимая ручная сверка
relates_to:
  - plans/tz/2026-07-03-extraction-consolidation-fixes.md
  - plans/analysis/2026-07-03-strela-extraction-fidelity-results.md
  - docs/methodology/synthetic-fidelity-eval-method.md
---

# Ф0 — Диагностика корня консолидации извлечения

> Read-only. Установлена ТОЧНАЯ причина Д1 (задвоение сущностей) и Д2 (дубли блоков) по коду.
> Каждый `path:line` подтверждён дословной цитатой + состязательным вторым проходом (verdict: confirmed, high) + ручной сверкой.

## Д1 — Задвоение сущностей: `type` — разделитель идентичности на 6 уровнях

**Корень:** ключ резолва/мёржа Entity **жёстко включает `EntityType` на каждом уровне** — одноимённая сущность с другим выведенным типом никогда не попадает в один пул кандидатов и не может консолидироваться. Гипотеза ТЗ («ключ = имя + тип») **подтверждена и с запасом** — барьер продублирован шесть раз:

| # | Место | `path:line` | Что делает |
|---|---|---|---|
| 1 | exact-name reuse | [entity-resolution.service.ts:418](backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L418) | `WHERE type::text=$2 AND LOWER(canonicalName)=$3` |
| 2 | KNN reuse | [entity-resolution.service.ts:470-484](backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L470) | векторный поиск reuse ограничен `type::text=$3` |
| 3 | strong-ID reuse | [entity-resolution.service.ts:580-587](backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L580) | поиск по ИНН/email/domain тоже `AND type::text=$2` |
| 4 | cache-key | [entity-resolution.service.ts:632](backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L632) | Redis-ключ `entity-resolve:${tenantId}:${type}:${hash}` |
| 5 | merge-кандидаты | [entity-merge.service.ts:201](backend/src/modules/knowledge-core/services/entity-merge.service.ts#L201) | `AND e.type = (SELECT type FROM Entity WHERE id=$2)` — same-name-different-type даже не доходит до арбитра |
| 6 | cron-пары | [entity-resolver.cron.ts:150-159](backend/src/modules/knowledge-core/workers/entity-resolver.cron.ts#L150) | LATERAL KNN требует `b.type = a.type` |
| + | hard-guard мёржа | [entity-merge.service.ts:310-312](backend/src/modules/knowledge-core/services/entity-merge.service.ts#L310) | `if (from.type !== into.type) throw` |
| + | LLM-арбитр, правило 2 | [entity-merge-arbiter.prompt.ts:46](backend/src/modules/knowledge-core/prompts/entity-merge-arbiter.prompt.ts#L46) | «Разный вид сущности — всегда distinct» |

**Точка рождения дубля:** [entity-resolution.service.ts:338-343](backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L338) — не найдя reuse в своей type-партиции, резолвер безусловно `entity.create`.

**Два усугубляющих драйвера сверху:**
- LLM-экстрактор присваивает одному реальному объекту **разный `EntityType` по контексту упоминания** ([block-ingest.worker.ts:1758-1763](backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L1758) — `type: args.mention.type` идёт в резолвер напрямую, без канонизации типа per-name в рамках Org).
- Deprecated enum `client` живёт рядом с `customer` ([schema.prisma:504-509](backend/prisma/schema.prisma#L504)) — резолв партиционирован по буквальному коду `type::text`, поэтому «Логистик Плюс» с `client` и с `customer` — разные партиции. Комментарий enum прямо предписывает patch-rename.

**Вывод по Д1:** корень — в дизайне ключа (тип как разделитель идентичности), а НЕ в embedding-пороге или ошибке арбитра. Даже идеальный арбитр и порог 0.0 не помогут — пара разных типов не формируется.

## Д2 — Дубли блоков: дедуп-вектор загрязнён контекст-хедером

**Гипотеза ТЗ (per-source/per-window scope) — опровергнута.** Выборка кандидатов KNN **глобальна по tenant** ([block-merge.service.ts:126-130](backend/src/modules/knowledge-core/services/block-merge.service.ts#L126) — только `tenantId + status='canonical' + mergedIntoId IS NULL`, без фильтра по источнику/окну/signalType). Кросс-канальный дедуп по замыслу работает.

**Настоящий корень:** дедуп-эмбеддинг блока **включает пер-источниковый контекст-хедер**:
- [embedding.service.ts:14-23](backend/src/modules/knowledge-core/services/embedding.service.ts#L14) кодирует текст `${header}\n${criticalQuestion} ${trustedAnswer}`.
- `header` собирается из **источника + участников + типа встречи + ДАТЫ (`event.occurredAt`) + недетерминированного LLM-предложения** ([block-ingest.worker.ts:284-305](backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L284), [chunk-context.service.ts:52-60,102-112](backend/src/modules/knowledge-core/services/chunk-context.service.ts#L52)).
- Этот вектор кладётся в **тот же** `IdeaBlock.embedding` ([block-ingest.worker.ts:327](backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L327)), который читает KNN дедупа ([block-merge.service.ts:122-124](backend/src/modules/knowledge-core/services/block-merge.service.ts#L122)). Второго «чистого» вектора для дедупа в схеме нет.

**Механизм:** один факт (Битрикс 429) из планёрки/стендапа/чата получает **разный префикс** → cosine между близнецами падает ниже порога `0.85` ([block-merge.service.ts:143-144](backend/src/modules/knowledge-core/services/block-merge.service.ts#L143), порог из [env.schema.ts:302](backend/src/common/config/env.schema.ts#L302)) → `candidates.length===0` → мгновенный `markCanonical` ([block-distill.worker.ts:137-140](backend/src/modules/knowledge-core/workers/block-distill.worker.ts#L137)). **LLM-арбитр `judgeMerge`, который как раз умеет «одна мысль другими словами», НИКОГДА не вызывается для этой пары** — потеря происходит на выборке кандидатов, ДО арбитра.

Оговорка (честность): «cosine регулярно падает ниже 0.85» — эмпирический факт из прогона «Стрелы»; код строго доказывает лишь, что хедер-загрязнённый вектор — единственный ключ дедупа и порог его отсекает. Направление эффекта (загрязнение снижает cosine одинаковых фактов) — неизбежно.

**Вывод по Д2:** чинить надо **источник вектора**, не порог. Снижение 0.85 — не корневой фикс (хедер смещает векторы непредсказуемо + over-merge на всём графе).

## Механика для развилок (что переиспользуется, что строить)

**Готово, переиспользовать как есть:**
- Транзакционный мёрж `mergeEntities` ([entity-merge.service.ts:284](backend/src/modules/knowledge-core/services/entity-merge.service.ts#L284)): полный перенос ссылок (`migrateEntityRefs` — IdeaBlockEntity/EntityLink/SourceEntity/ThemeEntity/Card/Person), объединение aliases/mentionsCount, tombstone `mergedIntoId`, гарды (already-merged race, tenant).
- LLM-арбитр `judgeMerge` + промпт «при сомнении distinct» — готовый фильтр против ложного мёржа.
- Negative-cache пар `markEntityPairDistinct`/`isEntityPairDistinct` ([entity-resolution.service.ts:701](backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L701)) — не даёт одноимённой-но-разной паре («Портал» в двух проектах) пересуживаться.
- `entity-resolver.worker` (findCandidates→judgeMerge→applyMerge) — готовый исполнитель; консолидатору достаточно enqueue по entityId.
- `graph-reconcile.cron` ([graph-reconcile.cron.ts:205-224](backend/src/modules/knowledge-core/workers/graph-reconcile.cron.ts#L205)) — сам вычистит merged-away узлы из графа после проставления `mergedIntoId`.

**Придётся строить:**
- **Выборка same-name кандидатов.** Существующий `entity-resolver.cron` (`findCandidatePairs`) ищет только по cosine И только в окне `updatedAt >= now-7дней` (LOOKBACK_DAYS=7) И `type <> 'person'` — **исторические дубли «Стрелы» за пределами окна он не пересматривает никогда**. Нужен новый запрос `GROUP BY (tenantId, LOWER(canonicalName)) HAVING count>1` без окна.
- **Разовый backfill** для расшивки текущего задвоения + опц. новый cron рядом.
- **Дедуп-вектор блока** (Д2) — см. развилку 3.
- Политика для `person` (сейчас fail-closed) — если консолидировать тёзок-сущностей.

## Owner-развилки по мёржу (ждут решения — на Ф1/Ф2 не заходим без «да»)

### Развилка 1 (Д1): как консолидировать одноимённые сущности разных типов
- **(A)** Тип — атрибут, не ключ идентичности: reuse по `(tenant, имя[, strong-ID])` без типа. Радикально, чинит корень; **риск over-merge** (проект «Портал» ≠ продукт «Портал») и требует миграции типизированных сабрекордов.
- **(B) [рекомендую]** Тип остаётся в идентичности, но добавляется отдельный **кросс-типовой merge-проход** (снять type-фильтр в выборке кандидатов) + арбитр решает «один объект под разными видами». Обратимо, арбитр + negative-cache защищают от over-merge, не ломает person-инвариант, откатывается порогом. + детерминированный маппинг очевидных пар (`client`→`customer`, patch-rename с прода).
- **Риск:** склейка реально разных одноимённых; смягчается консервативным арбитром.

### Развилка 2 (Д1): канонический тип при слиянии + типизированные сабрекорды
При слиянии `customer+vendor` («Логистик Плюс») — какой тип канонический, и что с 1:1-сабрекордами (Vendor-строка и Customer-строка)? Сейчас их миграция **вне scope** — [entity-merge.service.ts:349-355](backend/src/modules/knowledge-core/services/entity-merge.service.ts#L349) лишь логирует warn.
- **(A) [рекомендую]** Детерминированная матрица приоритетов (`customer > client`; domain-типы > generic `topic/metric`) для очевидных + арбитр возвращает `canonicalType` для спорных; **сабрекорды — дописать миграцию**, не игнорировать.
- **(B)** Только арбитр возвращает `canonicalType`.
- **(C)** Мульти-тип (набор ролей у одной Entity) — большое изменение схемы, отложить.
- **Риск:** неверный тип переклассифицирует сущность и ломает downstream-фильтры по `type` + типизированные сабрекорды.

### Развилка 3 (Д2): как чистить дедуп-вектор блока
- **(A)** Убрать хедер из `IdeaBlock.embedding` целиком. Просто, чинит дедуп; **но меняет и retrieval** (тот же вектор) — надо проверить, помогает ли хедер поиску блоков.
- **(B)** Снизить порог `0.85`. Дёшево (крутилка), но **не корневой фикс** + over-merge на всём графе. Не рекомендую.
- **(C)** Два вектора: чистый дедуп-вектор + контекстный retrieval-вектор. Чисто; но +колонка/миграция/backfill/двойная стоимость эмбеддинга.
- **[рекомендую]** (A) если хедер не критичен для retrieval-качества, иначе (C). НЕ (B). Over-merge защищён тем, что кандидаты проходят через `judgeMerge`, а не авто-сливаются по cosine.

## Решения владельца (2026-07-03) — owner-gate снят

- **Развилка 1 → (B).** Тип остаётся в идентичности; добавить отдельный **кросс-типовой merge-проход** (снять type-фильтр в выборке кандидатов) + арбитр решает «один объект под разными видами». + детерминированный маппинг `client`→`customer`.
- **Развилка 2 → матрица + арбитр + миграция сабрекордов.** Канонический тип: детерминированная матрица приоритетов (`customer>client`, domain-типы > generic `topic/metric`) для очевидных, арбитр возвращает `canonicalType` для спорных. Типизированные сабрекорды (Vendor/Customer/Goal/…) — **дописать миграцию между типами** (сейчас вне scope, warn-only на [entity-merge.service.ts:349-355](../../backend/src/modules/knowledge-core/services/entity-merge.service.ts#L349)).
- **Развилка 3 → (A).** Убрать контекст-хедер из дедуп-вектора блока ([embedding.service.ts:14-23](../../backend/src/modules/knowledge-core/services/embedding.service.ts#L14)). **Условие:** перед фиксацией проверить, не критичен ли хедер для retrieval-качества блоков; если критичен — эскалировать владельцу переход на (C) (два вектора). Порог 0.85 (B) — отклонён.

## Итог
Диагностика Ф0 завершена, оба корня установлены и подтверждены, **owner-gate снят** решениями выше. Реализация Ф1→Ф4 передаётся отдельному агенту — хэндофф-промпт: [2026-07-03-extraction-consolidation-fixes.orchestrator-prompt.md](../tz/2026-07-03-extraction-consolidation-fixes.orchestrator-prompt.md). Прогон стенда (destructive backfill на «Стрелу» + fidelity + recall) — **только владелец запускает**, агент останавливается перед ним.
