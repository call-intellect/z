---
status: draft
owner: TBA
created: 2026-05-25
type: optimization
priority: medium (буст экономики на MiniMax/Anthropic-формате)
related-modules: ai (LlmRouter, AnthropicService, MinimaxService)
---

# Расширить `cache_control: 'ephemeral'` на user-сообщение для MiniMax / Anthropic-формата

## 0. Кратко

Сейчас в `LlmRouterService.dispatch` ([backend/src/modules/ai/services/llm-router.service.ts:1149](../../backend/src/modules/ai/services/llm-router.service.ts#L1149)) мы автоматически выставляем `cacheControl: 'ephemeral'` **только на system-сообщение**:

```ts
const input: LlmCompleteInput = {
  system: { text: params.systemPrompt, cacheControl: 'ephemeral' },
  user: params.userMessage,  // ← cache_control НЕ выставлен
  ...
};
```

Это работает для типичного паттерна «короткий system + длинный user» только частично:
- ✅ Если system-промпт сам по себе длинный (≥1024 токенов на Anthropic-style провайдере) — он кэшируется.
- ❌ Если основной вес контекста — в user-сообщении (транскрипт встречи, набор IdeaBlock'ов и т.п.) — **кэш не работает**, потому что `cache_control` на user не выставляется.

Контрольный эксперимент 2026-05-25 (см. [`llm-cache-status.md`](../../second-brain/02_architecture/llm-cache-status.md)) подтвердил, что **MiniMax-M2.5 поддерживает `cache_control: 'ephemeral'`** на user-блоках, и на больших промптах даёт **hit 100%**. Сейчас на проде эта возможность упускается.

## 1. Цель

В цепочках, где user-сообщение содержит **большой общий контекст** (одна встреча, один набор блоков), автоматически кэшировать также и user.

## 2. Что менять

### 2.1 `LlmRouterService.dispatch` — выставлять cacheControl на user условно

В [llm-router.service.ts:1148-1163](../../backend/src/modules/ai/services/llm-router.service.ts#L1148-L1163):

```ts
const input: LlmCompleteInput = {
  system: { text: params.systemPrompt, cacheControl: 'ephemeral' },
  user: params.userMessage,
  ...
};
```

Заменить на:

```ts
// Если user-сообщение длинное (≥1024 токенов ≈ ~3000 символов русского), кэшируем
// и user тоже. Это даёт hit на Anthropic-style провайдерах (MiniMax) и нейтрально
// для OpenAI/DeepSeek (там cache_control игнорируется, кэширование автоматическое).
const USER_CACHE_MIN_CHARS = 3000;
const userPayload =
  typeof params.userMessage === 'string' && params.userMessage.length >= USER_CACHE_MIN_CHARS
    ? { text: params.userMessage, cacheControl: 'ephemeral' as const }
    : params.userMessage;

const input: LlmCompleteInput = {
  system: { text: params.systemPrompt, cacheControl: 'ephemeral' },
  user: userPayload,
  ...
};
```

Порог 3000 символов = ~1000 токенов русского — это минимум для попадания в кэш у Anthropic-style провайдеров (MiniMax). На меньших промптах cache_control бесполезен (Anthropic просто не закэширует) и может даже снизить производительность из-за overhead на cache-block.

### 2.2 То же самое в `LlmFallbackService.complete`

В [llm-fallback.service.ts](../../backend/src/modules/ai/services/llm-fallback.service.ts) уже есть выставление cacheControl на system — добавить такую же логику для user.

### 2.3 Проверить, что DeepSeek/OpenAI игнорируют cacheControl на user

В [deepseek.service.ts:108](../../backend/src/modules/ai/services/deepseek.service.ts#L108):
```ts
const userText = typeof input.user === 'string' ? input.user : input.user.text;
```
— `cacheControl` распаковывается в string, флаг отбрасывается. ✅ безопасно.

В [openai-proxy.service.ts:52](../../backend/src/modules/ai/services/openai-proxy.service.ts#L52):
```ts
const userText = typeof input.user === 'string' ? input.user : input.user.text;
```
— то же самое. ✅ безопасно.

В `anthropic.service.ts` и `minimax.service.ts` через `buildUserContent` ([anthropic.service.ts](../../backend/src/modules/ai/services/anthropic.service.ts)) — `cacheControl: 'ephemeral'` преобразуется в content-блок с `cache_control: { type: 'ephemeral' }`. ✅ работает как надо.

## 3. Ожидаемый эффект

- **MiniMax-M2.5** на больших промптах (транскрипт встречи в `user`): hit 95-100% → экономия ~50% от полной цены за input (cache hit cost ≈ 0.5× обычного на Anthropic-style).
- **DeepSeek / OpenAI** — никакого эффекта (они и так кэшируют автоматически по prefix-сравнению, `cache_control` им безразличен).
- **KIE/GRSAI** — нейтрально (кэш у них всё равно не работает, см. эксперимент).

## 4. Тесты

1. **Unit:** [`prompt-caching.spec.ts`](../../backend/src/modules/ai/services/prompt-caching.spec.ts) — добавить case: «caller передал длинный user-string (>3000 символов) → router выставляет `cacheControl: 'ephemeral'` на user в dispatch».
2. **Smoke:** прогон [`probe-llm-cache-matrix.ts`](../../backend/scripts/eval/probe-llm-cache-matrix.ts) на MiniMax-M2.5 — должен показать тот же hit 95-100% (как сейчас в синтетическом тесте), убедиться что fix не сломал поведение.
3. **Regression:** на одной dev-встрече запустить полный AI-pipeline в режиме «провайдер=minimax» (через `setRoute`) — проверить, что `AiUsageLog.cachedTokens` для длинных user-промптов > 0.

## 5. Acceptance criteria

- [ ] В коде `LlmRouterService.dispatch` и `LlmFallbackService.complete` cacheControl на user выставляется при `length ≥ 3000 chars`.
- [ ] Unit-тест зелёный.
- [ ] Smoke на MiniMax возвращает hit ≥ 95% для запросов с user ≥ 3000 chars.
- [ ] На dev-встрече с провайдером=minimax — `AiUsageLog.cachedTokens` > 0 на 2-м и последующих вызовах того же типа.

## 6. Что НЕ делать

- ❌ Не понижать порог ниже 3000 символов — может ухудшить экономику из-за overhead на cache-block.
- ❌ Не выставлять cacheControl на пустой user (`undefined`/`null`/`''`) — упадёт на Anthropic SDK.
- ❌ Не трогать `buildUserContent` в `anthropic.service.ts` — там логика уже корректная.

## 7. Связанные документы

- [llm-cache-status.md](../../second-brain/02_architecture/llm-cache-status.md) — фактическое состояние кэша по каналам.
- [§5 копилки ТЗ](2026-05-25-llm-architecture-changes-from-experiments.md) — почему 3000 chars / 1024 ток. — практический минимум.
- [cache-prefix-everywhere.md](2026-05-25-llm-cache-prefix-everywhere.md) — глобальная стратегия cache prefix.
