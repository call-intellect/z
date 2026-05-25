---
status: done
owner: frontend
created: 2026-05-25
completed: 2026-05-25
type: frontend-feature
priority: medium (бэкенд готов, не блокирует прод)
related-modules: frontend (app/(authenticated)/admin/llm-routes), backend admin/llm-routes (готов)
---

> **Итог 2026-05-25:** все 6 фаз выполнены. Страница реально лежит в `app/(authenticated)/admin/llm-routes/` (не `(admin)` — это были ранние черновики ТЗ). Дополнительно по факту: расширены `LLM_PROVIDERS` / `KNOWN_MODELS` / `providerLabel` на `'kie'`/`'grsai'` (см. ТЗ [2026-05-24-kie-grsai-llm-router-integration.md](2026-05-24-kie-grsai-llm-router-integration.md)). Поле `pinnedVersionNote` (фаза 6.5 clone-reliability-hardening) учтено в модалке с warning для критичных taskType (skill-trait-detect / clone-respond / block-ingest). DeepSeek-Pro warning в модалке тоже добавлен.

# Админка: страница управления моделями LLM по типам задач

## 0. Кратко

В проекте Z есть **~80 типов задач для языковых моделей** (taskType — например `chat-v2`, `dialog-classify`, `block-ingest`, `meeting-report-fast`). Для каждого настроена цепочка моделей: primary → secondary → tertiary fallback. Сейчас настройки задаются через seed-скрипты — это требует доступа к коду и БД.

Нужна страница в админке `/admin/llm-routes`, где супер-админ может видеть и менять модель для любого типа задачи. **Бэкенд уже полностью готов** — есть API `GET/PUT /api/v1/admin/llm-routes`, защита, аудит изменений. Не хватает только фронта.

## 1. Основание

Эксперимент 2026-05-25 показал, что **выбор модели на каждый агент критически влияет на качество и стоимость**. См. отчёты:
- [SUMMARY-ALL.md — встречи](../../backend/test/eval/sales-merge-experiment/reports/SUMMARY-ALL.md): объединённый агент на Pro в 4× дешевле и в 3.5× быстрее раздельных.
- [SUMMARY-ALL.md — диалог](../../backend/test/eval/dialog-experiment/reports/SUMMARY-ALL.md): простые шаги дёшево работают на Flash, отвечальщику лучше Pro.

Сейчас, чтобы переключить модель — нужно править seed-скрипт, запускать его на проде, плюс заботиться о флаге `editedByAdmin`. Это медленно и опасно. С UI — это операция в 5 секунд.

## 2. Цель

Страница `/admin/llm-routes` для супер-админа: таблица всех taskType → провайдеры/модели + редактирование одной кнопкой.

## 3. API контракт (готовый бэкенд)

Файл: [backend/src/modules/admin/llm-routes/llm-routes.controller.ts](../../backend/src/modules/admin/llm-routes/llm-routes.controller.ts).

### `GET /api/v1/admin/llm-routes`

**Защита:** `CookieAuthGuard` + `SuperAdminGuard`. Любой не-супер-админ получит 403.

**Ответ:**
```typescript
{
  items: Array<{
    id: string;
    taskType: string;             // например 'chat-v2'
    tenantId: string | null;       // null = глобальный дефолт
    tier: 'primary' | 'secondary' | 'tertiary' | null;
    providerName: string;          // 'deepseek' | 'openai-via-proxy' | 'ollama' | 'anthropic' | 'minimax'
    model: string;                 // 'deepseek-v4-pro' и т.д.
    priority: number;
    isActive: boolean;
    editedByAdmin: boolean;        // true = админ менял через эту админку
    requiredDataClass: string;
    providers?: Array<{provider, model}>; // legacy-формат, может приходить для старых записей
  }>
}
```

### `PUT /api/v1/admin/llm-routes/:taskType`

**Body** ([dto](../../backend/src/modules/admin/llm-routes/dto/llm-routes.dto.ts)):
```typescript
{
  providers: Array<{
    provider: 'anthropic' | 'minimax' | 'openai-via-proxy' | 'deepseek' | 'ollama';
    model?: string;  // опц., если не задан — берётся дефолт провайдера
  }>;  // минимум 1, максимум 10
  isActive: boolean;
}
```

**Ответ:** обновлённая запись роута. После обновления автоматически выставляется `editedByAdmin=true` — повторные seed-скрипты её **НЕ перезатрут**.

## 4. UI требования

### Страница `/admin/llm-routes`

**Layout:** часть `(admin)` route-группы Next.js — следует существующим конвенциям админки (см. `frontend/app/(admin)/`).

**Защита:** редирект на `/login` если нет cookie, редирект на `/admin` если не super_admin (использовать существующий механизм роли — `entitlement` context или аналог из других admin-страниц).

### Содержимое страницы

#### Таблица всех taskType

| Колонка | Что показывать |
|---|---|
| Тип задачи (taskType) | Текстовый ID + опц. человекочитаемое описание (если знаем) |
| Primary | Провайдер + модель + бейдж активности |
| Secondary | Провайдер + модель |
| Tertiary | Провайдер + модель |
| Статус | Active / Inactive |
| Изменено админом | Бейдж «✓ ред.» если `editedByAdmin=true` |
| Действия | Кнопка «Изменить» |

#### Фильтры и поиск
- Поиск по taskType (substring, по части строки).
- Фильтр по провайдеру primary (deepseek / openai-via-proxy / ollama / другие).
- Фильтр «только отредактированные админом».

#### Модалка редактирования

При клике «Изменить» открывается модалка:
- Заголовок: имя taskType.
- Три блока: Primary / Secondary / Tertiary.
- Каждый блок: dropdown с провайдером + текстовое поле с моделью.
- Кнопки: «Сохранить» (PUT), «Отмена».
- Подсказка-warning: «После сохранения seed-скрипты не будут перезатирать эту настройку».

### Доступные модели (для подсказок в dropdown)

Сейчас фиксированный список — захардкодить в UiModel как enum или константы. После — можно подтягивать с бэкенда через отдельный endpoint (это вне scope этой задачи).

```typescript
const KNOWN_MODELS: Record<string, string[]> = {
  deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat'],
  'openai-via-proxy': ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'],
  ollama: ['qwen3.5:9b', 'qwen3:30b'],
  anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6'],  // через KIE
  minimax: ['MiniMax-M2.7'],
};
```

### Архитектура слоёв (по skill `frontend-rules`)

| Слой | Файл | Что |
|---|---|---|
| ApiDto | `src/api/admin/llm-routes.api.ts` | Zod-схемы для GET/PUT ответов, вызовы через `apiClient` |
| DomainModel | `src/domain/admin/llm-route.ts` | Тип `LlmRoute` с нормализованными полями + парсер из ApiDto |
| UiModel | `src/ui/admin/llm-routes/route-row.tsx` | Презентационный компонент строки таблицы |
| Page | `app/(admin)/admin/llm-routes/page.tsx` | Страница с таблицей |
| Hook | `src/hooks/use-llm-routes.ts` | SWR-хук для подгрузки + мутации |

## 5. Фазы реализации

### Фаза 1 — Слои данных (1 час)
- [x] `llm-routes.api.ts` — Zod-схемы и вызовы.
- [x] `llm-route.ts` (domain) — маппер.
- [x] `use-llm-routes.ts` — SWR-хук с `mutate()` для обновления.

### Фаза 2 — Таблица (2 часа)
- [x] `page.tsx` со списком + поисковая строка + фильтры.
- [x] Группировка по taskType (одна строка = один taskType, три tier'а в колонках).
- [x] Бейджи активности и `editedByAdmin`.

### Фаза 3 — Модалка редактирования (1.5 часа)
- [x] Компонент `EditRouteDialog`.
- [x] Использовать Radix Dialog или существующий wrapper в `src/ui/shadcn/`.
- [x] При сохранении — оптимистичное обновление через SWR `mutate`.
- [x] Toast об успехе/ошибке (контекст `useToast`).

### Фаза 4 — Защита роли (30 минут)
- [x] Middleware или серверная проверка super_admin (см. как сделано в существующих admin-страницах).
- [x] 403 → редирект на `/admin` (главная админка).

### Фаза 5 — Полировка (30 минут)
- [x] Loading state (skeleton).
- [x] Empty state (если 0 роутов).
- [x] Error state с retry.

### Фаза 6 — Обновить second-brain (15 минут)
- [x] Добавить заметку в [01_projects/admin.md](../../second-brain/01_projects/admin.md) — новая страница admin/llm-routes.

## 6. Acceptance criteria

- [x] Super_admin открывает `/admin/llm-routes` — видит таблицу всех ~80 taskType.
- [x] Не-супер-админ получает 403 / редирект.
- [x] Поиск работает по части строки taskType.
- [x] Клик «Изменить» → модалка с тремя tier'ами → меняю primary-модель → «Сохранить» → таблица обновляется без перезагрузки страницы.
- [x] Сохранённая запись получает `editedByAdmin=true` (виден бейдж в строке).
- [x] Бэкенд проверки: невалидный provider или невалидный taskType → user-friendly ошибка через toast.
- [x] Обновлён `second-brain/01_projects/admin.md`.

## 7. Что НЕ делать

- **НЕ** добавлять создание новых taskType — список фиксирован в коде (`ALL_LLM_TASK_TYPES`).
- **НЕ** добавлять per-tenant override — это отдельная задача (Фаза 7 admin). Сейчас работаем только с глобальными дефолтами (`tenantId=null`).
- **НЕ** добавлять историю изменений — она пишется в `LlmTaskRouteChange` (аудит), но просмотр истории — отдельная задача.
- **НЕ** добавлять метрики по taskType (запросы, latency, ошибки) — это другая страница `/admin/llm-usage`, отдельный модуль.
- **НЕ** трогать бэкенд — он готов, всё, что нужно — уже есть.

## 8. Риски и митигация

| Риск | Митигация |
|---|---|
| Pro у DeepSeek не поддерживает strict JSON Schema → если переключить агент с Flash на Pro через эту админку, он сломается | Ждать выполнения ТЗ [2026-05-25-deepseek-pro-output-format-fix.md](2026-05-25-deepseek-pro-output-format-fix.md) — без него Pro массово выберет тоже опасно. **Добавить warning в модалку**: «Внимание: для DeepSeek-Pro сначала нужно убедиться, что автоконвертация json_schema → tools работает (см. ТЗ deepseek-pro-output-format-fix)». |
| Список доступных моделей в UI устареет, если на бэке добавят новые | Захардкоженные константы — приемлемо для первой версии. В будущем — добавить `GET /api/v1/admin/llm-models` (отдельная задача). |
| Случайно сломать настройку дефолтного провайдера | Подтверждение в модалке «Точно сохранить?» + аудит через `SuperAdminAuditInterceptor` (уже работает). |

## 9. Передача агенту

Этот файл — самодостаточное ТЗ. Агент-исполнитель должен:

1. Прочитать этот файл целиком.
2. Прочитать бэкенд-контроллер [llm-routes.controller.ts](../../backend/src/modules/admin/llm-routes/llm-routes.controller.ts) и DTO [llm-routes.dto.ts](../../backend/src/modules/admin/llm-routes/dto/llm-routes.dto.ts) — это контракт.
3. Изучить существующую `(admin)` группу — особенно как реализованы другие admin-страницы (например `app/(admin)/admin/users/` если есть, или `app/(admin)/admin/prompts/`).
4. Вызвать скилы `frontend-rules` (обязательно) и `core-engineering-standards`.
5. Идти по фазам 1-6 в порядке. После каждой фазы — `bun run typecheck && bun run lint`.
6. На развилках — спрашивать у пользователя (особенно по UI/UX — нужна ли подсказка про deepseek-pro warning, какой компонент модалки использовать).
