import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPORT, RUNS_DIR } from './corpus';
import { matchAll } from './match';
import type { A5Match, A5Verdict, JudgedScenario } from './types';

interface MetricAgg {
  label: string;
  passed: number;
  total: number;
  na: number;
}

function pct(n: number, d: number): string {
  if (d === 0) return '—';
  return `${Math.round((n / d) * 100)}%`;
}

function tallyVerdicts(matches: A5Match[]): Record<A5Verdict, number> {
  const t: Record<A5Verdict, number> = { PASS: 0, PARTIAL: 0, FAIL: 0, 'N/A': 0 };
  for (const m of matches) t[m.verdict] += 1;
  return t;
}

function metricAggs(matches: A5Match[]): MetricAgg[] {
  const defs: Array<{ key: string; label: string }> = [
    { key: 'created', label: 'created_correctly (плодим только по делу)' },
    { key: 'owner', label: 'owner_is_solver (владелец = решавший)' },
    { key: 'mustNotOwn', label: 'no_cross_clone_leak (упомянувший ≠ владелец)' },
    { key: 'subjectPersons', label: 'subject_accuracy (рост к правильным клонам)' },
    { key: 'count', label: 'one_per_task (идемпотентность сборки)' },
    { key: 'sourceIssueLinked', label: 'source_issue_linked (привязка к задаче)' },
    { key: 'contentMustPreserve', label: 'preservation (старое не потеряно)' },
    { key: 'contentMustContain', label: 'extension_adds_new (новое добавлено)' },
    { key: 'repeatCandidateInstruction', label: 'repeat_candidate (повтор ×N → флаг)' },
    { key: 'cloneAlsoFed', label: 'dual_purpose (клон по-прежнему кормится)' },
  ];
  const out: MetricAgg[] = [];
  for (const d of defs) {
    let passed = 0;
    let total = 0;
    let na = 0;
    for (const m of matches) {
      const checks = m.checks.filter((c) => c.metric === d.key);
      if (checks.length === 0) continue;
      if (checks.every((c) => c.na)) {
        na += 1;
        continue;
      }
      total += 1;
      if (checks.every((c) => c.pass)) passed += 1;
    }
    if (total > 0 || na > 0) out.push({ label: d.label, passed, total, na });
  }
  return out;
}

function createdConfusion(matches: A5Match[]): string {
  let ty = 0;
  let tn = 0;
  let fy = 0;
  let fn = 0;
  for (const m of matches) {
    const c = m.checks.find((x) => x.metric === 'created');
    if (!c) continue;
    const expected = c.expected === true;
    const actual = c.actual === true;
    if (expected && actual) ty += 1;
    else if (!expected && !actual) tn += 1;
    else if (!expected && actual) fy += 1;
    else fn += 1;
  }
  return [
    '| ожид.\\факт | создано | НЕ создано |',
    '|---|---:|---:|',
    `| **надо создать** | ${ty} ✓ | ${fn} ✗ (пропуск) |`,
    `| **НЕ надо** | ${fy} ✗ (лишнее) | ${tn} ✓ |`,
  ].join('\n');
}

function judgeSection(judged: JudgedScenario[]): string {
  if (judged.length === 0) return '_Панель судей не запускалась (нет созданных решений или режим без judge)._';
  const tally: Record<string, number> = { good: 0, flawed: 0, wrong: 0, 'no-quorum': 0 };
  for (const j of judged) tally[j.consensus] += 1;
  const rows = judged.map(
    (j) =>
      `| ${j.scenarioId} | ${j.consensus} | ${j.majorityGist ? '✓' : '✗'} | ${j.majorityOwner ? '✓' : '✗'} |`,
  );
  const calls = judged.reduce((n, r) => n + r.votes.length, 0);
  const errs = judged.reduce((n, r) => n + r.votes.filter((v) => v.error).length, 0);
  return [
    `Консенсус: good ${tally.good} · flawed ${tally.flawed} · wrong ${tally.wrong} · no-quorum ${tally['no-quorum']}. LLM-вызовов ${calls} (ошибок ${errs}).`,
    '',
    '> Судья оценивает КАЧЕСТВО уже созданного решения (суть/владелец/полнота), а не факт «надо ли было создавать». Ложную материализацию (`a5-no-answer`) ловит детерминированный слой (match), поэтому у судьи она может быть «good».',
    '',
    '| сценарий | консенсус | суть (majority) | владелец (majority) |',
    '|---|---|:---:|:---:|',
    ...rows,
  ].join('\n');
}

export function runReport(stamp: string): string {
  const runDir = resolve(RUNS_DIR, stamp);
  const { raw, matches } = matchAll(stamp);
  const judgedPath = resolve(runDir, 'judged.json');
  const judged: JudgedScenario[] = existsSync(judgedPath)
    ? (JSON.parse(readFileSync(judgedPath, 'utf8')) as JudgedScenario[])
    : [];

  const verdicts = tallyVerdicts(matches);
  const passN = verdicts.PASS;
  const totalN = matches.length;
  const aggs = metricAggs(matches);

  const idem = raw.passStats.idempotency;
  const idemClean = idem.created === 0 && idem.updated === 0;

  const cellOrder = ['A5.1', 'A5.2', 'A5.3', 'A5.4', 'A5.5', 'A5.6', 'A5.7', 'A5.8'];
  const byCell = new Map<string, A5Match[]>();
  for (const m of matches) {
    const arr = byCell.get(m.cell) ?? [];
    arr.push(m);
    byCell.set(m.cell, arr);
  }

  const findings = matches.filter((m) => m.verdict === 'FAIL' || m.verdict === 'PARTIAL');

  const lines: string[] = [];
  lines.push('# regulation-stand — baseline scorecard (ось A5 · Решения задач / TaskSolution)');
  lines.push('');
  lines.push(
    `Прогон: \`${stamp}\` · сценариев: ${totalN} · PASS ${passN}/${totalN} (${pct(passN, totalN)}) · HEAD \`${raw.headCommit}\` · orgId \`${raw.orgId}\`.`,
  );
  lines.push('');
  lines.push('> Синтез-режим: блоки how-solved воссозданы из корпуса (ground truth входа), запускался реальный `TaskSolutionBuildService`. Классификация сигналов (ось A1) здесь НЕ проверяется — только билдер решений.');
  lines.push('');

  lines.push('## Итоговое распределение');
  lines.push('');
  lines.push('| Вердикт | n |');
  lines.push('|---|---:|');
  for (const v of ['PASS', 'PARTIAL', 'FAIL', 'N/A'] as A5Verdict[]) {
    lines.push(`| ${v} | ${verdicts[v]} |`);
  }
  lines.push('');

  lines.push('## Метрики A5 (ТЗ §6)');
  lines.push('');
  lines.push('| Метрика | pass | всего | % | N/A |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const a of aggs) {
    const pctCell = a.total === 0 ? 'N/A' : pct(a.passed, a.total);
    lines.push(`| ${a.label} | ${a.passed} | ${a.total} | ${pctCell} | ${a.na || ''} |`);
  }
  lines.push('');

  lines.push('## Confusion — материализация (created_correctly)');
  lines.push('');
  lines.push(createdConfusion(matches));
  lines.push('');

  lines.push('## Scorecard по ячейкам A5.1–A5.8');
  lines.push('');
  lines.push('| Ячейка | n | PASS | PARTIAL | FAIL | N/A |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const cell of cellOrder) {
    const arr = byCell.get(cell) ?? [];
    if (arr.length === 0) continue;
    const c = (v: A5Verdict): number => arr.filter((m) => m.verdict === v).length;
    lines.push(`| ${cell} | ${arr.length} | ${c('PASS')} | ${c('PARTIAL')} | ${c('FAIL')} | ${c('N/A')} |`);
  }
  lines.push('');

  lines.push('## Идемпотентность (2-й прогон Δ=0)');
  lines.push('');
  lines.push(`- create: ${JSON.stringify(raw.passStats.create)}`);
  lines.push(`- extend: ${JSON.stringify(raw.passStats.extend)}`);
  lines.push(`- idempotency (повтор): ${JSON.stringify(idem)} → ${idemClean ? '✅ Δ=0 (created=0, updated=0)' : '❌ повтор породил изменения'}`);
  lines.push('');

  lines.push('## Таблица диагнозов — атрибуция к агенту');
  lines.push('');
  if (findings.length === 0) {
    lines.push('_Провалов не зафиксировано._');
  } else {
    lines.push('| сценарий | ячейка | вердикт | ключевая метрика | что не так | агент/корень |');
    lines.push('|---|---|---|---|---|---|');
    for (const f of findings) {
      lines.push(`| ${f.scenarioId} | ${f.cell} | ${f.verdict} | ${f.keyMetric} | ${f.diagnosis} | ${f.attribution} |`);
    }
  }
  lines.push('');

  lines.push('## Панель судей (суть решения · владелец)');
  lines.push('');
  lines.push(judgeSection(judged));
  lines.push('');

  lines.push('## Конфигурация прогона');
  lines.push('');
  lines.push(`- HEAD-commit: \`${raw.headCommit}\``);
  lines.push(`- эмбеддингов записано: ${raw.embeddingsWritten} (репит-группа тестируема при >0)`);
  lines.push('');
  lines.push('| крутилка | значение |');
  lines.push('|---|---|');
  for (const [k, v] of Object.entries(raw.config)) {
    lines.push(`| ${k} | ${JSON.stringify(v)} |`);
  }
  lines.push('');

  lines.push('## Полная сверка по сценариям');
  lines.push('');
  lines.push('| сценарий | ячейка | trap | вердикт | ключ. метрика | диагноз |');
  lines.push('|---|---|:---:|---|---|---|');
  for (const m of matches) {
    lines.push(`| ${m.scenarioId} | ${m.cell} | ${m.trap ? '⚑' : ''} | ${m.verdict} | ${m.keyMetric} | ${m.diagnosis} |`);
  }
  lines.push('');

  const md = lines.join('\n');
  writeFileSync(resolve(runDir, 'report.md'), md, 'utf8');
  writeFileSync(REPORT, md, 'utf8');
  process.stdout.write(`✓ report ${stamp}: PASS ${passN}/${totalN} → ${REPORT}\n`);
  return md;
}

if (require.main === module) {
  const stamp = process.argv[2];
  if (!stamp) throw new Error('report: нужен stamp');
  runReport(stamp);
}
