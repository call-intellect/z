---
type: tz
status: draft
feature: SBA α-2 — Layer 1 Marking Extension (расширение signalType + reasoning-extractor)
date: 2026-05-21
parent_tz: tz/2026-05-21-second-brain-agents-umbrella.md
phase: alpha
unblocks:
  - tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md (RouterService опирается на signalType)
  - tz/2026-05-21-sba-alpha-7-specialist-3-1-regulations.md (signalType='regulation'/'process_step')
  - tz/2026-05-21-sba-beta-3-specialist-3-3-decisions.md (signalType='decision'/'rationale')
  - tz/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md (signalType='reasoning' — главный источник)
covers_matrix_rows: [G1, G2, J10, J11, M1..M5 (через расширение routes для block-ingest), K4]
---

# ТЗ α-2: Layer 1 — Marking Extension

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](2026-05-21-second-brain-agents-umbrella.md). При расхождениях — приоритет у зонтичного.
>
> **Архитектурные решения этого sub-TZ:** [§3.1 двухслойная модель знания](2026-05-21-second-brain-agents-umbrella.md#31-%D0%B4%D0%B2%D1%83%D1%85%D1%81%D0%BB%D0%BE%D0%B9%D0%BD%D0%B0%D1%8F-%D0%BC%D0%BE%D0%B4%D0%B5%D0%BB%D1%8C-%D0%B7%D0%BD%D0%B0%D0%BD%D0%B8%D1%8F-%D1%8D%D0%B2%D0%BE%D0%BB%D1%8E%D1%86%D0%B8%D1%8F-%D0%BD%D0%B5-%D0%B7%D0%B0%D0%BC%D0%B5%D0%BD%D0%B0) (атомы остаются), [§3.4 источник skill](2026-05-21-second-brain-agents-umbrella.md#34-skill-%D0%BF%D1%80%D0%BE%D1%84%D0%B8%D0%BB%D1%8C--%D1%80%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9-%D0%B0%D1%80%D1%82%D0%B5%D1%84%D0%B0%D0%BA%D1%82-%D0%BA%D0%BE%D0%BC%D0%BF%D0%B0%D0%BD%D0%B8%D0%B8-%D0%BD%D0%B5-%D0%BF%D0%B5%D1%80%D1%81%D0%BE%D0%BD%D0%B0%D0%BB%D1%8C%D0%BD%D0%BE%D0%B5-%D0%B2%D0%BB%D0%B0%D0%B4%D0%B5%D0%BD%D0%B8%D0%B5).
>
> **Контекст для исполнителя:**
> - Текущая реализация Слоя 1: [knowledge-core.md §Pipeline](../../second-brain/02_architecture/knowledge-core.md).
> - Главный сервис — [block-extraction.service.ts](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts).
> - Воркер — [block-ingest.worker.ts](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts).
> - Промпт extraction — [block-ingest.prompt.ts](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts).

---

## 1. Цель

После α-2:
- `IdeaBlock.signalType` enum расширен 5 новыми значениями: `reasoning`, `rationale`, `decision_basis`, `regulation`, `process_step`.
- `BlockExtractionService` распознаёт новые типы (через обновлённый prompt + JSON Schema strict).
- Reasoning-блоки — главный источник для будущего SkillProfile (γ-1).
- Regulation/process_step-блоки — главный источник для α-7 (Regulations specialist).
- Существующие блоки **не пересоздаются** (опц. бэкфил — см. §11).

---

## 2. Зависимости

**Зависит от:** существующего knowledge-core (Фазы 1-2 уже в коде).

**Разблокирует:** α-3 (RouterService использует signalType для диспатчинга), α-7, β-3, γ-1.

---

## 3. Scope

### Входит

- Расширение enum `SignalType` в Prisma schema +5 значений.
- Обновление JSON Schema strict в `block-extraction.service.ts`.
- Обновление промпта `block-ingest.prompt.ts` (placeholder с TODO для согласования текста).
- Возможный второй проход `reasoning-detect` — отдельный LLM-вызов поверх существующих блоков (опционально — см. §11 открытый вопрос).
- Обновление seed `seed-llm-task-routes-knowledge-core.ts` — пересмотр цепочки provider'ов для `block-ingest` с учётом нового масштаба (placeholder с TODO согласовать с playbook).
- (Опц.) Новый `LlmTaskType` `reasoning-detect` + seed-script `seed-llm-task-routes-reasoning-detect.ts` с тремя provider'ами.
- Patch-script для бэкфила (опц.) — `backend/scripts/backfill-reasoning-signaltype.ts`.
- Обновление `delivery/13-glossary.md` — глоссарий signalType с русскими названиями.

### Не входит

- Создание новых таблиц.
- Изменение Layer 2 (это α-3).
- Создание специалистов Слоя 3.

---

## 4. Модели данных

Только enum-расширение, без новых таблиц.

```prisma
// До:
enum SignalType {
  decision
  problem
  risk
  idea
  fact
  // ... 14 значений всего сейчас
}

// После (добавить 5 значений):
enum SignalType {
  // ... существующие ...
  reasoning         // обоснование «почему я так решил» — главный источник для skill (γ-1)
  rationale         // подтип reasoning, более структурированный
  decision_basis    // подтип reasoning, привязан к decision
  regulation        // фрагмент регламента / правила
  process_step      // шаг процесса
}
```

После расширения — `bun run prisma:generate`.

---

## 5. Обновление BlockExtractionService

`BlockExtractionService.extractBlocks(segment)` — JSON Schema strict обновляется:
- Поле `signalType` в схеме ответа — добавлены 5 новых значений.
- Промпт расширяется секцией про reasoning-распознавание (см. §6).
- Поле `personSubjectId` в схеме — опционально, если LLM может определить, кто именно произнёс reasoning (паттерн «я учёл», «мы выбрали» → speaker).

Зависит от §6 (промпт).

---

## 6. Промпт `block-ingest` (placeholder)

```ts
// backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts
// TODO(owner-product): согласовать текст промпта (см. зонтичный §10)
//
// Что должно быть в промпте дополнительно к существующему:
// 1. Reasoning-распознавание:
//    - Фразы-маркеры: "потому что", "я учёл", "мы выбрали ... над ...", "trade-off",
//      "иначе бы", "я бы выбрал", "имеет смысл потому что"
//    - Возвращать signalType='reasoning' (или 'rationale' если есть структура,
//      или 'decision_basis' если привязано к конкретному решению)
//    - Заполнять `personSubjectId` (через speaker context)
// 2. Regulation-распознавание:
//    - Фразы-маркеры: "по регламенту", "правило X гласит", "обязательно",
//      "согласно стандарту", нумерованные шаги процесса
//    - signalType='regulation' для нормативного утверждения
//    - signalType='process_step' для шага процесса
```

**Сохранить:** все существующие signalType-распознавания.

---

## 7. (Опц.) Второй проход `reasoning-detect`

Если решено разделить (см. §11 открытый вопрос):
- Новый воркер `reasoning-detect.worker.ts` — consumer `core.reasoning-detect`.
- Дебаунс 30s.
- Читает свежие `IdeaBlock` со `signalType IN ('fact', 'decision', 'idea')` (где может скрываться reasoning), применяет LLM-вызов `reasoning-detect` — если YES, ставит дополнительный `subSignalType='reasoning'` (новое поле) или создаёт separate `IdeaBlock` с `signalType='reasoning'` и связкой к исходному через `IdeaBlockLink relationType='explains'` (новый тип, опц.).

Решение об этом — на старте sub-TZ.

---

## 8. ENV

```
# (опц., если делаем второй проход)
REASONING_DETECT_DEBOUNCE_MS=30000
REASONING_DETECT_CONFIDENCE_THRESHOLD=0.65
```

---

## 9. RBAC

Изменений нет (IdeaBlock уже под RBAC).

---

## 10. Метрики

- `core_blocks_total{signalType}` — расширяется автоматически за счёт enum.
- (Опц.) `core_reasoning_detected_total{source}` (counter) — если второй проход.

---

## 11. LLM

**Расширение `block-ingest` taskType.** Цепочка provider'ов пересматривается с учётом нового масштаба JSON Schema (5 новых значений → возможно увеличение токенов). Seed-script `seed-llm-task-routes-knowledge-core.ts` обновляется:

```ts
// Placeholder — согласовать с llm-models-playbook.md
// primary: DeepSeek V4-flash через proxy.agent-lia.ru
// secondary: gpt-5.4-mini через OpenAI proxy
// tertiary: Ollama qwen3:30b (local)
// Все три фильтруются по maxDataClass >= 'confidential'
```

**(Опц.) Новый taskType `reasoning-detect`** (если выбран второй проход):
- Узкий промпт «является ли этот блок обоснованием? если да — какова логика?»
- Цепочка: primary/secondary/tertiary по тому же принципу.

---

## 12. Фазы реализации

- [ ] **α-2.0** Решить открытый вопрос §13: один проход (расширенный block-ingest) vs два прохода (block-ingest + reasoning-detect).
- [ ] **α-2.1** Расширение enum `SignalType` +5 значений + `bun run prisma:push`.
- [ ] **α-2.2** Обновление JSON Schema strict в `block-extraction.service.ts`.
- [ ] **α-2.3** Обновление промпта `block-ingest.prompt.ts` (placeholder + TODO).
- [ ] **α-2.4** Обновление seed `seed-llm-task-routes-knowledge-core.ts` — пересмотр цепочки provider'ов с тремя уровнями.
- [ ] **α-2.5** (если выбран second pass) Новый воркер `reasoning-detect.worker.ts` + cron-инициатор + новый `LlmTaskType` + seed-script.
- [ ] **α-2.6** (опц.) Patch-script `backfill-reasoning-signaltype.ts` — пробег по существующим блокам, второй проход reasoning-detect.
- [ ] **α-2.7** Smoke-тест: одна реальная встреча → block-ingest → проверить наличие хотя бы 2 reasoning-блоков (если их в встрече было обсуждение «почему»).
- [ ] **α-2.8** Обновление [delivery/13-glossary.md](../../delivery/13-glossary.md) — добавить русские термины для 5 новых signalType.
- [ ] **α-2.9** Обновление [knowledge-core.md](../../second-brain/02_architecture/knowledge-core.md) — раздел про расширение Слоя 1.

---

## 13. Открытые вопросы

1. **Один проход или два?** (см. зонтичный §11.1)
   - Один: расширяем существующий `block-ingest` промпт, без отдельного воркера. Стоимость 1× LLM-вызов на сегмент, но риск переусложнить промпт.
   - Два: `block-ingest` остаётся как есть, отдельный `reasoning-detect` поверх. Стоимость 2× LLM, но чище и можно тюнить отдельно.
   - **Рекомендация:** на старте — один проход (расширенный промпт). Если в smoke качество reasoning-распознавания низкое (<70%) — переключаемся на второй проход.

2. **Бэкфил существующих блоков?** Если да — patch-script нужен. Если нет — reasoning-блоки появятся только из новых встреч.

3. **`personSubjectId` в `IdeaBlock`** — добавлять как новое поле или хранить в `IdeaBlockEntity.role='subject'`? Существующий механизм уже через `IdeaBlockEntity`, рекомендация — использовать его, не добавлять дубль.

---

## 14. DoD

- enum `SignalType` расширен, `bun run prisma:push` + `bun run prisma:generate` зелёные.
- `bun run typecheck && bun run lint && bun run build` зелёные.
- Промпт `block-ingest.prompt.ts` обновлён (placeholder с TODO для согласования текста).
- `seed-llm-task-routes-knowledge-core.ts` обновлён с цепочкой из 3 provider'ов + ссылка на playbook в комментарии.
- Smoke-тест на реальной встрече показывает извлечение reasoning-блоков (минимум один на 5 минут обсуждения, если есть обоснования).
- Глоссарий UI обновлён.
- second-brain обновлён.

---

## 15. Итог

**Реализовано целиком:** нет (draft).

**Что осталось:** вся реализация.

**Что меняет в продукте:** появляется типизированный сигнал «обоснование» в атомах, что становится фундаментом для γ-1 (Skill).
