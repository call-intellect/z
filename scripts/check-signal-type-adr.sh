#!/usr/bin/env bash
# check-signal-type-adr.sh
#
# Проверяет, что при изменении enum'ов knowledge-core
# (SIGNAL_TYPE_VALUES / EntityType / IdeaBlockLinkRelationType / EntityLinkType)
# в PR присутствует новый или изменённый ADR в docs/adr/.
#
# Использование:
#   bash scripts/check-signal-type-adr.sh                 # сравнить HEAD с origin/main
#   BASE_REF=main bash scripts/check-signal-type-adr.sh   # явно задать base
#
# Подробнее про процесс ADR — docs/adr/README.md.

set -euo pipefail

BASE_REF="${BASE_REF:-origin/main}"

# Файлы, изменение которых требует ADR.
ENUM_FILES=(
  "backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts"
  "backend/prisma/schema.prisma"
)

# Файл schema.prisma большой, и не каждое изменение касается enum'ов
# knowledge-core. Для него дополнительно проверим, что в diff упоминается
# один из четырёх enum'ов по имени.
SCHEMA_ENUM_PATTERNS=(
  "enum SignalType"
  "enum EntityType"
  "enum IdeaBlockLinkRelationType"
  "enum EntityLinkType"
)

# 1. Получаем список изменённых файлов между BASE_REF и HEAD.
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "[check-signal-type-adr] base ref '$BASE_REF' не найден — пропускаю проверку."
  echo "[check-signal-type-adr] (вероятно, локальный first run или shallow clone)"
  exit 0
fi

CHANGED=$(git diff --name-only "$BASE_REF" HEAD)

# 2. Определяем, затронут ли хоть один enum-файл.
NEEDS_ADR=false
TOUCHED_ENUM_FILES=()

for f in "${ENUM_FILES[@]}"; do
  if echo "$CHANGED" | grep -qx "$f"; then
    if [ "$f" = "backend/prisma/schema.prisma" ]; then
      # Для schema.prisma — проверяем, что diff реально содержит
      # одно из enum-имён knowledge-core.
      DIFF_BODY=$(git diff "$BASE_REF" HEAD -- "$f" || true)
      for pat in "${SCHEMA_ENUM_PATTERNS[@]}"; do
        if echo "$DIFF_BODY" | grep -q "$pat"; then
          NEEDS_ADR=true
          TOUCHED_ENUM_FILES+=("$f (matched: $pat)")
          break
        fi
      done
    else
      NEEDS_ADR=true
      TOUCHED_ENUM_FILES+=("$f")
    fi
  fi
done

if [ "$NEEDS_ADR" = false ]; then
  echo "[check-signal-type-adr] enum-файлы knowledge-core не затронуты — OK."
  exit 0
fi

echo "[check-signal-type-adr] обнаружено изменение enum-файла(ов):"
for f in "${TOUCHED_ENUM_FILES[@]}"; do
  echo "  - $f"
done

# 3. Проверяем, что в PR есть новый или изменённый ADR в docs/adr/.
ADR_HITS=$(echo "$CHANGED" | grep -E '^docs/adr/.*\.md$' || true)

if [ -z "$ADR_HITS" ]; then
  cat >&2 <<'EOF'

[check-signal-type-adr] FAIL: новые/изменённые enum'ы knowledge-core требуют ADR.

В этом PR изменён один из следующих файлов:
  - backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts (SIGNAL_TYPE_VALUES)
  - backend/prisma/schema.prisma (enum SignalType / EntityType / IdeaBlockLinkRelationType / EntityLinkType)

...но в docs/adr/ нет ни одного нового или изменённого .md.

Что делать:
  1. Прочитай docs/adr/README.md — там процесс и нумерация.
  2. Скопируй docs/adr/template-signal-type.md → docs/adr/NNNN-<enum-kind>-<value-name>.md.
  3. Заполни (минимум 5 примеров обязательно).
  4. Добавь файл в commit и пересоберись.

Если правка enum'а тривиальная (типо в комментарии, переименование без
семантических последствий) — добавь короткий ADR со status: accepted и
явным указанием «семантика не меняется», иначе классификатор будет
деградировать незаметно.

EOF
  exit 1
fi

echo "[check-signal-type-adr] найдены изменения в ADR:"
echo "$ADR_HITS" | sed 's/^/  - /'
echo "[check-signal-type-adr] OK."
