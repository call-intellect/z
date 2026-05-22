# MCP-инструменты для AI-агентов

Реестр инструментов, публикуемых через MCP (Model Context Protocol). Дублируется как REST API для агентов через LangGraph (один источник истины — `tools_registry.yaml` в коде).

## Группы

- `search.*` — все агенты.
- `read.*` — по доступу.
- `propose.*` — только agents с правом proposal.
- `analyze.*` — все агенты.
- `business.*` — agents с разрешением tenant'а.
- `system.*` — внутренние.

## Спецификация инструментов

### search.signals

Найти сигналы по запросу и фильтрам.

**Input schema:**
```json
{
  "query": "string",
  "signal_types": ["client_pain", "feature_request"],
  "theme_id": "uuid (optional)",
  "period": {"from": "date", "to": "date"},
  "limit": 50,
  "min_confidence": 0.7
}
```

**Output schema:**
```json
{
  "signals": [
    {
      "id": "uuid",
      "signal_type": "client_pain",
      "text": "...",
      "confidence": 0.85,
      "raw_event_id": "uuid",
      "occurred_at": "iso8601",
      "evidence_snippet": "..."
    }
  ],
  "total_found": 123,
  "more_available": true
}
```

### search.themes

```json
// input
{"query": "string", "branch_id": "uuid?", "min_weight": 0.3, "limit": 20}
// output
{"themes": [{"id":..., "title":..., "weight":..., "signals_count":...}]}
```

### search.find_related

Найти связанные узлы через граф.

```json
// input
{
  "node_id": "uuid",
  "depth": 2,
  "relation_types": ["подтверждает", "помогает"],
  "min_confidence": 0.7,
  "limit": 30
}
// output
{
  "subgraph": {
    "nodes": [...],
    "edges": [{"from":..., "to":..., "relation_type":..., "explanation":...}]
  }
}
```

### search.knowledge_articles, search.commitments, search.semantic

Аналогично — query + filters → результаты.

### read.theme

```json
// input
{"id": "uuid"}
// output
{"id": ..., "title": ..., "description": ..., "branch_id": ..., "weight": ...,
 "signals_count": ..., "related_count": ..., "confirmation": ...}
```

### read.* (signal, decision, goal, idea, risk, raw_event, client, person_imprint)

Все возвращают объект с проверкой M-20.

### propose.link

Предложить связь между двумя узлами.

```json
// input
{
  "from_id": "uuid",
  "to_id": "uuid",
  "relation_type": "помогает",
  "explanation": "1-3 фразы объяснения",
  "confidence": 0.85,
  "evidence_signals": ["uuid1", "uuid2"]
}
// output
{
  "link_id": "uuid",
  "status": "предложена_AI",
  "stored_at": "iso8601"
}
```

### propose.theme_merge, propose.theme_split

Предложение слияния/разделения тем.

### propose.decision, propose.idea, propose.risk, propose.commitment

Создать draft (status=`proposed` или `analyzed`). **Никогда** не повышают сами выше.

### propose.knowledge_article

Создать draft статьи в базе знаний.

### analyze.extract_signals

Извлечь сигналы из текста (вызывает M-05).

```json
// input
{"text": "...", "language_hint": "ru"}
// output
{
  "signals": [
    {"signal_type": "client_pain", "text": "...", "confidence": 0.85}
  ],
  "summary_short": "...",
  "topics_hint": ["..."]
}
```

### analyze.summarize, analyze.classify, analyze.compare_voices, analyze.extract_commitments, analyze.detect_drift

Аналогично — input + output по специфике.

### business.crm_query

Запрос к CRM коннектору.

```json
// input
{
  "connector_id": "uuid",
  "entity": "deal",
  "filter": {"status": "open", "amount_gte": 100000},
  "limit": 50
}
// output
{
  "items": [...],
  "total": 123
}
```

### business.metrics_get

```json
// input
{"metric_code": "conversion_rate", "from": "2026-04-01", "to": "2026-05-10"}
// output
{"timeseries": [{"date":..., "value":...}], "anomalies": [...]}
```

### business.task_tracker_query, business.csv_query

Аналогично.

### system.get_user_role, system.check_access, system.translate, system.format_currency

Внутренние утилиты.

## Авторизация инструментов

Каждый агент имеет whitelist в БД (`agent_tool_access`). Перед вызовом — проверка:

```python
def execute_tool(agent_id, tool_name, args, context):
    if not is_tool_allowed(agent_id, tool_name):
        raise ToolForbidden(f"Agent {agent_id} cannot use {tool_name}")
    # log
    audit_log(agent_id, tool_name, args)
    # exec
    return tool_registry[tool_name].execute(args, context)
```

## Защита от prompt injection

- Все user-supplied input — в выделенных XML-тегах в промпте.
- Запросы tool calls с подозрительными паттернами («ignore previous instructions», «pretend you are») — логируются и возвращают стандартный отказ.
- Глубина вложенности (agent → sub-agent → tool → ...) — максимум 3 уровня.

## Latency и cost

- Каждый tool call — timeout 30 сек.
- Параллельность: до 5 одновременных tool calls на агента.
- В audit-log пишется duration + cost.

## MCP server

MCP-server бэкенда публикуется на `/mcp` endpoint API Gateway. Поддерживается:
- `tools/list` — реестр всех доступных конкретному агенту.
- `tools/call` — вызов с arguments.
- `notifications/progress` — для длительных операций.
