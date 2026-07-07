# task-stand — no-LLM scorecard

Сценариев в прогоне: 11

## Вердикты по категориям A–K

| Кат | N | PASS | PARTIAL | PENDING_JUDGE | WRONG_OUTCOME | INVARIANT_FAIL |
|---|---|---|---|---|---|---|
| A | 2 | 0 | 0 | 1 | 1 | 0 |
| D | 2 | 0 | 0 | 0 | 2 | 0 |
| F | 1 | 1 | 0 | 0 | 0 | 0 |
| H | 1 | 0 | 0 | 0 | 1 | 0 |
| K | 5 | 0 | 0 | 2 | 3 | 0 |
| **Σ** | **11** | **1** | **0** | **3** | **7** | **0** |

## Распределение outcomeType

- nothing: 7
- issue: 3
- subtask: 1

## Инварианты

- INV-1 (R13, нет авто-закрытия/merge): FAIL 0
- INV-2 (кросс-тенант): FAIL 0
- INV-4 (идемпотентность, N/A в одиночном прогоне): FAIL 0

## WRONG_OUTCOME

- A-04: count=0 != expect 1
- D-01: count=0 != expect 1
- D-07: count=0 != expect 1
- H-01: count=0 != expect 1
- K-01: count=0 != expect 1
- K-02: count=0 != expect 1
- K-05: count=0 != expect 1

## Т11 (K) — детерминированно (baseline до фикса = сырьё ожидаемо)

| Сценарий | descriptionClean | descriptionNotVerbatim | titleClean | provenanceKept |
|---|---|---|---|---|
| K-01 | true | true | true | false |
| K-02 | true | true | — | — |
| K-03 | false | — | — | — |
| K-04 | — | — | — | — |
| K-05 | true | true | — | — |
