---
type: tz
status: done
feature: β-7 — Brand Voice Curator (Specialist 3.10)
phase: beta-7
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §β-7
  - plans/tz/2026-05-22-final-roadmap.md §β-7
---

# SBA β-7 — Brand Voice Curator

## 1. Цель и контекст

Корпус контент-артефактов компании + извлечённый «голос бренда». Используется в chat-v2 `clone_style scope=company` для генерации контента в фирменном стиле. Specialist 3.10 собирает brand_principle/content_artifact блоки (signalType из α-2 wave 2), строит BrandVoiceProfile derived из корпуса.

## 2. Scope

**Входит:**
- Расширение `Document` модели полем `useCases String[]` (multi-faceted: `use_in_process|use_for_generation|reference|brand_corpus`).
- Модель `BrandVoiceProfile` (1:1 с Org): toneJson, valuesJson, taboosJson, exampleArtifactIds[], lastBuiltAt, version, completeness.
- Cron `brand-voice-extractor.cron` (`@Cron('0 8 * * *')`) — daily пересборка BrandVoiceProfile из brand_principle блоков + content_artifact embedding-based характеризация.
- 1 LlmTaskType `brand-voice-extract`.
- REST `/api/v1/brand-voice/*`.
- UI `/brand-voice` (read-only + manual edit для admin).
- Интеграция с chat-v2: `clone_style scope=company` injects BrandVoiceProfile в systemPrompt.
- RBAC.
- Метрики.

## 3. Принятые решения

1. **Document.useCases[]** вместо отдельной таблицы — multi-faceted artifact (один pdf может быть и process-artifact, и brand-corpus example).
2. **BrandVoiceProfile derived from corpus** — admin может override через PATCH, но default — LLM-extracted.
3. **toneJson schema:** `{ formal: 0..1, technical: 0..1, casual: 0..1, energetic: 0..1, ... }` (10 dimensions).
4. **valuesJson** — array<{ value: string, weight: 0..1, exampleBlockIds: string[] }>.
5. **taboosJson** — array<{ phrase: string, alternative?: string, reason: string }> (из brand_principle с маркерами «никогда»/«запрещено»).
6. **Daily cron + manual trigger.** Не real-time (cost-prohibitive).
7. **scope=company в chat-v2** — новая клиентская опция, default — без brand voice. Когда явно запрошено — inject systemPrompt.

## 4. Зависимости

- α-2 wave 2 (готово) — brand_principle/content_artifact signalType.
- α-5 (параллельно) — chat-v2 mode-specific prompts (для интеграции).

## 5. Prisma-дельта

```prisma
model Document {
  // existing fields
  useCases  String[]  @default([])  // 'use_in_process'|'use_for_generation'|'reference'|'brand_corpus'
}

model BrandVoiceProfile {
  id                   String   @id @default(cuid())
  tenantId             String   @unique
  toneJson             Json?
  valuesJson           Json?
  taboosJson           Json?
  exampleArtifactIds   String[]
  version              Int      @default(1)
  lastBuiltAt          DateTime?
  builderAgentVersion  String?
  completeness         Decimal  @db.Decimal(4,3) @default(0)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  tenant               Org      @relation(fields: [tenantId], references: [id])
}
```

## 6. Patch / миграция данных

`backend/scripts/patch-document-use-cases-default.ts` — для всех существующих Document с useCases пусто → проставить `['reference']` (default neutral).

## 7. REST API

`/api/v1/brand-voice` (TenantGuard + `brand_voice.read|write`):
- `GET /` — current profile.
- `PATCH /` — manual override (admin).
- `POST /rebuild` — manual trigger.
- `GET /artifacts` — list documents с useCases includes 'brand_corpus'.

`/api/v1/documents/:id/use-cases` (PATCH) — admin tag document с brand_corpus и др.

## 8. BullMQ worker'ы и cron'ы

- `brand-voice-extractor.cron` — `@Cron('0 8 * * *')`.
- Idempotency: dedup по tenantId + lastBuiltAt < 6h ago.

## 9. LlmTaskType регистрация

```ts
{ taskType: 'brand-voice-extract', priority: 'primary',   provider: 'openai',   model: 'gpt-4o' }       // высокая точность нужна
{ taskType: 'brand-voice-extract', priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'brand-voice-extract', priority: 'tertiary',  provider: 'ollama',   model: 'qwen3.5:9b' }
```

## 10. RBAC ResourceType

- `brand_voice.read` (employee).
- `brand_voice.write` (admin, super_admin, marketing role).
- `brand_voice.rebuild` (admin).

## 11. Метрики Prometheus

- `brand_voice_profile_completeness{tenant_top}` gauge.
- `brand_voice_extractor_runs_total{tenant_top, result}` counter.
- `brand_voice_corpus_size{tenant_top}` gauge (count documents с brand_corpus useCase).

## 12. Frontend

- `frontend/app/(authenticated)/brand-voice/page.tsx` — read-only display + edit modal для admin.
- API client + Domain mapper.
- NAV link.
- Remove `.next\types`.

## 13. ENV переменные

- `BRAND_VOICE_EXTRACTOR_ENABLED: boolean (default true)`.
- `BRAND_VOICE_MIN_CORPUS_SIZE: number (default 5)` — минимум документов для извлечения.

## 14. Связь с существующим кодом

- `backend/src/modules/knowledge-core/specialists/` — паттерн.
- `backend/src/modules/documents/` — для useCases.
- `backend/src/modules/chat-v2/` — интеграция в clone-style systemPrompt.

## 15. DoD

- [x] 2 schema-изменения.
- [x] cron работает + corpus collection.
- [x] REST + UI.
- [x] chat-v2 `scope=company` инжектит BrandVoiceProfile.
- [x] typecheck/lint/tests.

## 16. Тесты

- **unit:** `brand-voice-extractor.cron.spec.ts`.
- **integration:** API + chat-v2 интеграция.

## 17. Риски и mitigation

- **Минимум корпуса** — если <5 brand_corpus документов — extractor skip, completeness=0.
- **Schema merge** — изменения в Document + новая BrandVoiceProfile; кодер проверяет, что параллельные coders Document не трогают.
- **`.next/types/` кэш** — Remove-Item.

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- Модель `BrandVoiceProfile` (schema.prisma:3623) + `Document.useCases` поле.
- `BrandVoiceModule` с `BrandVoiceService`, `BrandVoiceExtractorService`, `BrandVoiceExtractorCron` (daily 08:00).
- REST `/api/v1/brand-voice` + `/api/v1/documents/:id/use-cases` (2 контроллера).
- Frontend: `frontend/app/(authenticated)/brand-voice/page.tsx` + `BrandVoiceClient.tsx`, API client `frontend/src/api/brand-voice.api.ts`.
- LlmTaskType seed: `backend/scripts/seed-llm-task-routes-brand-voice.ts`.
- Patch script: `backend/scripts/patch-document-use-cases-default.ts`.
- Prompt: `backend/src/modules/brand-voice/prompts/brand-voice-extract.prompt.ts`.
- RBAC `brand_voice` ResourceType (policy.csv:552-562).
- chat-v2 интеграция через scope='org' (см. shipping-report §2.12).
