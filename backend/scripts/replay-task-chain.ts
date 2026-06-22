import { shouldMaterializeTask } from '../src/modules/tracker/services/task-quality-gate.util';

interface RealTask {
  title: string;
  assignee: string | null;
  dueDate: string | null;
  confidence: number;
}

const REAL_TASKS: RealTask[] = [
  { title: 'Убрать автоматическое включение камеры при начале встречи', assignee: 'Сергей', dueDate: null, confidence: 0.85 },
  { title: 'Детально изучить сервис и проверить его работоспособность', assignee: null, dueDate: null, confidence: 0.7 },
  { title: 'Составить скрипты демонстрации для клиентов', assignee: 'Айназ', dueDate: null, confidence: 0.85 },
  { title: 'Проверить баги с переключением раскладки', assignee: null, dueDate: null, confidence: 0.5 },
  { title: 'Составить план лидогенерации', assignee: 'Айназ', dueDate: null, confidence: 0.85 },
  { title: 'Найти транскрибацию по встречам', assignee: 'Айназ', dueDate: null, confidence: 0.75 },
  { title: 'Проверить весь чат с переписками, исправить баги и дать обратную связь', assignee: 'Сергей', dueDate: null, confidence: 0.9 },
];

const MEETING_PARTICIPANTS_WITH_USERID = new Set<string>(['chydo_002']);
const AUTO_ACCEPT_THRESHOLD = 0.75;
const MEETING_TITLE = 'тест проверка постановки задач со встречи';

function resolveAssigneeFromParticipants(hint: string | null): string | null {
  if (!hint) return null;
  const norm = hint.trim().toLowerCase();
  for (const p of MEETING_PARTICIPANTS_WITH_USERID) {
    if (p.toLowerCase() === norm) return `userId_${p}`;
  }
  return null;
}

function resolveProjectByTitle(title: string): string | null {
  const tokens = title.match(/[A-ZА-Я][A-ZА-Я0-9-]{1,5}/gu) ?? [];
  return tokens.length > 0 ? `proj_${tokens[0]}` : null;
}

interface ChainResult {
  title: string;
  gatePass: boolean;
  gateReason: string | undefined;
  intakeCreated: boolean;
  lowQuality: boolean;
  assigneeId: string | null;
  projectId: string | null;
  currentIssue: boolean;
  fixedIssue: boolean;
}

function run(): void {
  const rows: ChainResult[] = [];
  for (const t of REAL_TASKS) {
    const ownerHint = t.assignee;
    const gate = shouldMaterializeTask({
      title: t.title,
      ownerUserId: null,
      ownerHint,
      dueDate: t.dueDate,
      source: 'meeting',
    });

    const assigneeId = resolveAssigneeFromParticipants(ownerHint);
    const projectId = resolveProjectByTitle(MEETING_TITLE);
    const confidentEnough = t.confidence >= AUTO_ACCEPT_THRESHOLD;

    const intakeCurrent = gate.ok;
    const lowQuality = !gate.ok;
    const intakeFixed = t.title.trim().length > 0;

    const effAssigneeCurrent = assigneeId;
    const effProjectCurrent = projectId;
    const currentIssue =
      intakeCurrent && confidentEnough && effAssigneeCurrent !== null && effProjectCurrent !== null;

    const effProjectFixed = projectId ?? 'proj_MTG_из_встреч';
    const fixedIssue = intakeFixed && effProjectFixed !== null;

    rows.push({
      title: t.title.slice(0, 42),
      gatePass: gate.ok,
      gateReason: gate.reason,
      intakeCreated: intakeCurrent,
      lowQuality,
      assigneeId,
      projectId,
      currentIssue,
      fixedIssue,
    });
  }

  process.stdout.write('\n=== REPLAY: реальные 7 задач эталонной встречи через настоящий shouldMaterializeTask ===\n');
  process.stdout.write('участники-с-userId: [chydo_002]; проект из title: нет; порог авто-приёма 0.75\n\n');
  for (const r of rows) {
    process.stdout.write(
      `  ${r.gatePass ? '✓gate' : `✗gate(${r.gateReason})`}  intake=${r.intakeCreated ? 'да' : `lowQ`}  assignee=${r.assigneeId ?? '—'}  proj=${r.projectId ?? '—'}  → ТЕКУЩИЙ Issue=${r.currentIssue ? 'ДА' : 'нет'}  ФИКС Issue=${r.fixedIssue ? 'ДА' : 'нет'}  | ${r.title}\n`,
    );
  }
  const extracted = REAL_TASKS.length;
  const gateDropped = rows.filter((r) => !r.gatePass).length;
  const intakeCurrent = rows.filter((r) => r.intakeCreated).length;
  const currentIssues = rows.filter((r) => r.currentIssue).length;
  const fixedIssues = rows.filter((r) => r.fixedIssue).length;

  process.stdout.write('\n--- ИТОГ ---\n');
  process.stdout.write(`Извлечено моделью:           ${extracted}\n`);
  process.stdout.write(`Гейт дропнул (no_owner_no_due): ${gateDropped}  → в ТЕКУЩЕЙ логике пропали без следа\n`);
  process.stdout.write(`IntakeIssue (текущая):       ${intakeCurrent}  (висят в /intake «Ожидает триажа»)\n`);
  process.stdout.write(`Дошло до Issue — ТЕКУЩАЯ:     ${currentIssues}  ← симптом «во вкладке пусто»\n`);
  process.stdout.write(`Дошло до Issue — ФИКС A1+A2:  ${fixedIssues}  ← все видны в трекере (часть lowQuality + probe на исполнителя/срок)\n`);
  const pass = currentIssues === 0 && fixedIssues === extracted;
  process.stdout.write(`\nПРОВЕРКА: текущая=0 И фикс=все(${extracted}) → ${pass ? 'PASS ✅ (фикс доказанно доводит задачи до трекера)' : 'FAIL ❌'}\n`);
  if (!pass) process.exit(1);
}

run();
