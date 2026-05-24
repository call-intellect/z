---
type: tz
status: draft
feature: SBA α-5 — Layer 5 Chat-v2 Omnichannel (AI-чат компании поверх knowledge-core, доступный через все каналы)
date: 2026-05-21
parent_tz: tz/2026-05-21-second-brain-agents-umbrella.md
phase: alpha
depends_on:
  - tz/2026-05-21-sba-alpha-1-channels-foundation.md (ConversationalModule для inbound chat-query)
unblocks:
  - tz/2026-05-21-sba-beta-1-channels-telegram-max.md (Telegram/MAX автоматически получают chat — без правки α-5)
  - tz/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md (Clone-style ответ — расширение chat-v2)
covers_matrix_rows: [E10, H1, H2 (factual+synthetic; clone-style — γ-1), H3, H4, L2]
---

# ТЗ α-5: Layer 5 — Chat-v2 Omnichannel

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](2026-05-21-second-brain-agents-umbrella.md). При расхождениях — приоритет у зонтичного.
>
> **Архитектурное решение:** [§3.1 двухслойная модель](2026-05-21-second-brain-agents-umbrella.md#31-%D0%B4%D0%B2%D1%83%D1%85%D1%81%D0%BB%D0%BE%D0%B9%D0%BD%D0%B0%D1%8F-%D0%BC%D0%BE%D0%B4%D0%B5%D0%BB%D1%8C-%D0%B7%D0%BD%D0%B0%D0%BD%D0%B8%D1%8F-%D1%8D%D0%B2%D0%BE%D0%BB%D1%8E%D1%86%D0%B8%D1%8F-%D0%BD%D0%B5-%D0%B7%D0%B0%D0%BC%D0%B5%D0%BD%D0%B0) (поиск поверх блоков+карточек) + [§3.5 omnichannel](2026-05-21-second-brain-agents-umbrella.md#35-conversational-channels--%D0%B4%D0%B2%D1%83%D0%BD%D0%B0%D0%BF%D1%80%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%BD%D1%8B%D0%B5-pluggable-%D0%BE%D0%BC%D0%BD%D0%B8%D0%BA%D0%B0%D0%BD%D0%B0%D0%BB%D1%8C%D0%BD%D1%8B%D0%B5).
>
> **Контекст для исполнителя:**
> - Существующий chat-модуль — посмотреть в [knowledge-core.md §что вне Фазы 4](../../second-brain/02_architecture/knowledge-core.md), помечен `@deprecated`.
> - Существующий гибридный поиск — [search.service.ts](../../backend/src/modules/knowledge-core/api/search.service.ts).
> - Гибридная схема: cosine 0.7 + BM25 0.3 — переиспользуется.

---

## 1. Цель

После α-5:
- Новый модуль `chat-v2/` — AI-чат компании поверх единого индекса knowledge-core.
- Три уровня ответа: `factual` (с цитатой), `synthetic` (свод), `clone-style` (заготовка для γ-1).
- Provenance через `IdeaBlockEvidence` — обязательно в каждом ответе.
- Omnichannel: chat-v2 регистрируется как inbound-handler типа `chat_query` в `ConversationalModule`. Любое сообщение `/ask <вопрос>` через любой канал → ответ через тот же канал.
- Старый chat помечен `@deprecated`, миграция UI/API запланирована на β/γ.

---

## 2. Зависимости

**Зависит от:** α-1 (ConversationalModule).

**Соработает с:** α-3 (новые типы Entity), α-4 (CardVersion — chat-v2 читает current), α-6/α-7 и далее (новые карточки специалистов индексируются).

**Разблокирует:** β-1 (Telegram/MAX автоматически получают chat без правки α-5), γ-1 (clone-style — расширение).

---

## 3. Scope

### Входит

- Новый модуль `backend/src/modules/chat-v2/`.
- `ChatV2Service` — публичный API: `ask(input)` → `ChatAnswer`.
- `RetrievalService` — гибридный поиск (cosine + BM25) + графовый обход + чтение карточек специалистов (через registry).
- `SynthesisService` — LLM-вызов для синтеза ответа с цитированием.
- `CitationService` — формирование citation-снипетов из `IdeaBlockEvidence` с timestamp'ами и ссылками на источник (meeting, document).
- `ConversationsService` — хранение conversation history.
- 2 Prisma-модели: `ChatConversation`, `ChatMessage`.
- API: `POST /api/v1/chat-v2/messages`, `GET /api/v1/chat-v2/conversations/:id`, `GET /api/v1/chat-v2/conversations`.
- UI: `/chat` (master-detail conversations), компонент `<ChatPanel>` для встраивания в другие страницы.
- Регистрация в `ConversationalModule.subscribeInbound('chat_query')`.
- 2 новых `LlmTaskType`: `chat-v2-synthesize`, `chat-v2-cite-select`.
- Цепочка из 3 provider'ов для каждого через seed.
- Уровень `clone-style` — задел в API (поле `mode: 'factual' | 'synthetic' | 'clone-style'`), реализация — в γ-1.
- Метрики `chat_v2_*`.
- RBAC: `chat_v2_conversation` ResourceType.
- Deprecation план существующего chat (помечаем `@deprecated`, не удаляем; миграция UI — отдельный sub-TZ позже).

### Не входит

- `clone-style` режим (γ-1 — там подключаются Persona).
- Voice-input/output (γ+).
- Удаление старого chat (отдельный sub-TZ позже, не блокирующий).
- Temporal queries «что мы знали в марте» — задел в API через `asOf` параметр, реальная реализация — после α-4 `evolving` resolution.

---

## 4. Модели данных

```prisma
model ChatV2Conversation {
  id              String   @id @default(uuid())
  tenantId        String
  userId          String   // создатель
  title           String?  // авто-генерация после первого сообщения
  scope           ChatScope  // 'org' | 'personal' | 'card' (личный клон — γ)
  scopeRefId      String?  // если scope='card' — id карточки
  channelKindOrigin String?  // 'web' | 'telegram_bot' | 'max_bot' | 'email'
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([tenantId, userId, updatedAt])
}

model ChatV2Message {
  id              String   @id @default(uuid())
  conversationId  String
  role            ChatMessageRole  // 'user' | 'assistant'
  mode            ChatMode?  // 'factual' | 'synthetic' | 'clone-style' (только для assistant)
  text            Text
  citations       Json?    // [{ blockId, evidenceId, quote, sourceType, sourceUrl }, ...]
  retrievalMeta   Json?    // { searchedBlocks: N, fromGraph: N, fromCards: { type: N } }
  llmMeta         Json?    // { model, tokens, tier, fallbackUsed }
  createdAt       DateTime @default(now())
  @@index([conversationId, createdAt])
}
```

---

## 5. ChatV2Service API

```ts
export interface AskInput {
  tenantId: string;
  userId: string;
  question: string;
  conversationId?: string;
  mode?: ChatMode;  // default 'synthetic'
  scope?: ChatScope; // default 'org'
  scopeRefId?: string;
  asOf?: Date;       // temporal — отложен, см. §3 не входит
}

export interface ChatAnswer {
  conversationId: string;
  messageId: string;
  text: string;
  citations: Citation[];
  uncertaintyNote?: string;  // если synthetic с противоречиями — явное предупреждение
}

@Injectable()
export class ChatV2Service {
  async ask(input: AskInput): Promise<ChatAnswer>
  async getConversation(id: string, userId: string): Promise<ChatV2Conversation & { messages: ChatV2Message[] }>
  async listConversations(userId: string, filter): Promise<ChatV2Conversation[]>
}
```

---

## 6. Retrieval pipeline

1. **Query embedding** — через `EmbeddingService.embedQuery`.
2. **Hybrid search** — переиспользуем существующий [search.service.ts](../../backend/src/modules/knowledge-core/api/search.service.ts) (`cosine 0.7 + BM25 0.3`), фильтр `tenantId` обязателен.
3. **Card retrieval** — `CardSpecialistRegistry` — реестр специалистов с `getCardsForQuery(query, blockIds)`. Каждый специалист может вернуть свои карточки (Regulation, Decision, …), отфильтрованные по релевантности (overlap с найденными blockIds или собственный embedding на карточке).
4. **Graph expansion** — для top-N блоков получить 1-hop соседей через `IdeaBlockLink` + `IdeaBlockEntity` → для дополнительного контекста.
5. **Provenance assembly** — для каждого блока в выдаче подтянуть `IdeaBlockEvidence` (top-1 evidence с quote + timestamp + sourceType).
6. **Context construction** — собрать payload для LLM: top-K блоков + top-M карточек + опц. graph neighbors + цитаты.

`CardSpecialistRegistry` — заполняется по мере появления специалистов (α-6 регистрирует Card, α-7 — Regulation, β-3 — Decision, и т.д.).

---

## 7. Synthesis

`chat-v2-synthesize` LLM-вызов:
- Input: question, context (top-K блоков + карточки + цитаты), mode (factual/synthetic/clone-style)
- Output: text + structured citations (какие именно цитаты использованы) + uncertaintyNote если есть противоречия

**Mode behavior:**
- `factual` — отвечает только тем, что есть в источниках; при отсутствии данных — «не нашёл в памяти компании»; цитаты обязательны.
- `synthetic` — синтезирует свод, маркирует уверенность («по нескольким источникам», «однажды было сказано», «возможно устарело»).
- `clone-style` — заглушка в α-5, реальная реализация в γ-1 (подключается Persona).

---

## 8. Omnichannel inbound

В `OnModuleInit` ChatV2Module регистрирует:
```ts
this.conversationalService.subscribeInbound(async (msg) => {
  if (msg.type === 'chat_query') {
    const answer = await this.chatV2Service.ask({
      tenantId: ..., userId: msg.userId, question: msg.question,
      conversationId: msg.conversationId
    });
    // Отправить ответ обратно через тот же канал (через ConversationalService.sendNotification с eventType='chat.answer')
    await this.conversationalService.sendChatReply(msg.userId, answer, msg.originChannelBindingId);
  }
});
```

В `ConversationalService` добавляется метод `sendChatReply` (специальный outbound, не требует `Notification`-обёртки — это conversation message).

---

## 9. ENV

```
CHAT_V2_RETRIEVAL_TOP_K_BLOCKS=20
CHAT_V2_RETRIEVAL_TOP_M_CARDS=10
CHAT_V2_GRAPH_EXPANSION_DEPTH=1
CHAT_V2_CONTEXT_MAX_TOKENS=12000
CHAT_V2_DEFAULT_MODE=synthetic
```

---

## 10. RBAC

- `chat_v2_conversation` — read/write: owner-user (свои conversations); admin может видеть всё для отладки.
- Сама команда `ask` — `tenantId`-scoped через `TenantGuard`.
- `scope='card'` — проверка прав на карточку (если нет read на карточку → отказ).

---

## 11. Метрики

- `chat_v2_queries_total{mode, channel_origin}` (counter)
- `chat_v2_retrieval_blocks{mode}` (histogram)
- `chat_v2_synthesis_duration_seconds{mode}` (histogram)
- `chat_v2_tokens_total{tier, fallbackUsed}` (counter)
- `chat_v2_no_evidence_total{mode}` (counter — когда ответ без цитат, что bad)
- `chat_v2_uncertainty_marked_total{mode}` (counter)

---

## 12. LLM (3 уровня обязательны — §3.7 зонтичного)

**Новые `LlmTaskType`:**

1. `chat-v2-synthesize` — основная синтез-задача. Сложная (длинный контекст, citation-следование, нюансы языка).
   - Primary: (placeholder, согласовать через [llm-models-playbook.md](../../llm-models-playbook.md)) — кандидаты: Claude Sonnet (через proxy.agent-lia.ru), gpt-5.4 (через OpenAI proxy)
   - Secondary: альтернативная модель того же класса
   - Tertiary: Ollama qwen3:30b (local, на confidential данных гарантировано работает)
   - Все три фильтруются по `maxDataClass >= 'top_secret'` (chat должен работать с любыми данными).

2. `chat-v2-cite-select` — пост-обработка, выбор лучших цитат для ответа. Узкая задача.
   - Можно использовать тот же провайдер, что и для synthesize, или дешевле.

**Seed-script:** `seed-llm-task-routes-chat-v2.ts` с тремя provider'ами + ссылка на playbook в комментарии.

---

## 13. Фазы реализации

- [ ] **α-5.0** Ревью существующего `chat/` модуля. Решение: новый модуль или переписать? Рекомендация — новый (см. §11.8 зонтичного открытый вопрос).
- [ ] **α-5.1** Prisma-модели `ChatV2Conversation`, `ChatV2Message` + enum'ы + `bun run prisma:push`.
- [ ] **α-5.2** `RetrievalService` — переиспользует существующий `SearchService` + графовый обход + чтение карточек через registry (заготовка registry, регистрации придут от других специалистов).
- [ ] **α-5.3** `CardSpecialistRegistry` — pluggable интерфейс.
- [ ] **α-5.4** `CitationService` — сборка citations из `IdeaBlockEvidence`.
- [ ] **α-5.5** `SynthesisService` — LLM-вызов с тремя provider'ами в цепочке (seed-script `seed-llm-task-routes-chat-v2.ts`).
- [ ] **α-5.6** Промпт `chat-v2-synthesize.prompt.ts` (placeholder + TODO согласовать).
- [ ] **α-5.7** Промпт `chat-v2-cite-select.prompt.ts` (placeholder + TODO согласовать).
- [ ] **α-5.8** `ConversationsService` + хранение history (заголовок генерируется LLM из первого сообщения).
- [ ] **α-5.9** API + DTO + Swagger.
- [ ] **α-5.10** UI `/chat` (master-detail conversations) + компонент `<ChatPanel>`.
- [ ] **α-5.11** Регистрация в `ConversationalService.subscribeInbound('chat_query')`.
- [ ] **α-5.12** Расширение `ConversationalService.sendChatReply` (или новый метод).
- [ ] **α-5.13** Метрики, RBAC, glossary, second-brain.
- [ ] **α-5.14** Пометка старого `chat/` модуля `@deprecated` в README; план миграции — отдельный sub-TZ позже.

---

## 14. Открытые вопросы

1. **Новый модуль vs переписать существующий?** (см. зонтичный §11.8) Рекомендация — новый.
2. **`CardSpecialistRegistry` — push (специалист сам регистрирует при init) или pull (chat-v2 знает список)?** Push — масштабируется лучше.
3. **Conversation TTL?** Хранить вечно или auto-archive после N дней без активности? Решение — TTL 90 дней с возможностью pin в UI.
4. **Streaming response?** Через SSE — позже, в α-5 синхронный ответ.
5. **Temporal queries (asOf)** — параметр API заводим, но реальное использование — после α-4 (evolving). В α-5 параметр игнорируется или возвращает 501.

---

## 15. DoD

- 2 модели в схеме, `bun run prisma:push` зелёный.
- Smoke-тест: вопрос «Что мы решили по проекту X?» через POST API → ответ с минимум 1 цитатой.
- Integration-тест: `/ask <вопрос>` через mock-inbound `ConversationalModule` → ответ возвращается через тот же канал.
- UI `/chat` работает, conversation history сохраняется.
- Seed-script `seed-llm-task-routes-chat-v2.ts` с 3 provider'ами + ссылка на playbook.
- Старый chat помечен `@deprecated` (README + JSDoc).
- Метрики, RBAC, glossary, second-brain.

---

## 16. Итог

**Реализовано целиком:** нет (draft).

**Что осталось:** вся реализация.

**Что меняет в продукте:** появляется AI-чат компании, доступный через любой канал, с честным цитированием и заделом под clone-style ответы в γ.
