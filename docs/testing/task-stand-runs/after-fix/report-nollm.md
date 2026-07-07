# task-stand — no-LLM scorecard

Сценариев в прогоне: 13

## Вердикты по категориям A–K

| Кат | N | PASS | PARTIAL | PENDING_JUDGE | WRONG_OUTCOME | INVARIANT_FAIL |
|---|---|---|---|---|---|---|
| A | 1 | 0 | 0 | 1 | 0 | 0 |
| D | 2 | 0 | 0 | 0 | 2 | 0 |
| K | 10 | 1 | 0 | 3 | 6 | 0 |
| **Σ** | **13** | **1** | **0** | **4** | **8** | **0** |

## Распределение outcomeType

- nothing: 8
- issue: 5

## Инварианты

- INV-1 (R13, нет авто-закрытия/merge): FAIL 0
- INV-2 (кросс-тенант): FAIL 0
- INV-4 (идемпотентность, N/A в одиночном прогоне): FAIL 0

## WRONG_OUTCOME

- D-01: count=0 != expect 1
- D-07: count=0 != expect 1
- K-02: count=0 != expect 1
- K-05: count=0 != expect 1
- K-06: count=0 != expect 1
- K-07: count=0 != expect 1
- K-08: count=0 != expect 1
- K-09: count=0 != expect 1

## Т11 (K) — детерминированно (baseline до фикса = сырьё ожидаемо)

| Сценарий | descriptionClean | descriptionNotVerbatim | titleClean | provenanceKept |
|---|---|---|---|---|
| K-01 | true | true | true | true |
| K-02 | true | true | — | — |
| K-03 | true | — | — | — |
| K-04 | — | — | — | — |
| K-05 | true | true | — | — |
| K-06 | true | — | — | — |
| K-07 | true | — | — | — |
| K-08 | true | — | — | false |
| K-09 | true | — | — | — |
| K-10 | true | — | — | — |
