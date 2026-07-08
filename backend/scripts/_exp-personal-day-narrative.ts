import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { LlmRouterService } from '../src/modules/ai/services/llm-router.service';
import {
  buildPersonDayUserMessage,
  PERSONAL_DAY_JSON_SCHEMA,
  PERSONAL_DAY_NARRATIVE_SYSTEM_PROMPT,
  PERSONAL_DAY_NARRATIVE_TASK_TYPE,
} from '../src/modules/operations/prompts/personal-day-narrative.prompt';
import { PersonalDayNarrativeService } from '../src/modules/operations/services/personal-day-narrative.service';

const TENANT = 'cmr1qbvpx0001pwbwxbgmh1jl';
const TARGET_NOW = new Date('2026-07-03T18:00:00.000Z');
const SENTIMENT_RE =
  /настроени|эмоци|конфликт|поругал|поссор|недоволь|раздраж|напряж|груст|радост|тревог|стресс|выгор|обид|злост|устал/i;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const svc = app.get(PersonalDayNarrativeService);
  const llm = app.get(LlmRouterService);

  const allEmployees = await prisma.person.findMany({
    where: { tenantId: TENANT, relationship: 'employee' },
    select: { id: true, userId: true, name: true, timezone: true },
  });
  const persons: typeof allEmployees = [];
  for (const e of allEmployees) {
    const hasCheckin = await prisma.dailyCheckIn.findFirst({
      where: { tenantId: TENANT, personId: e.id, dateLocal: '2026-07-03', kind: 'evening' },
      select: { id: true },
    });
    if (hasCheckin) persons.push(e);
    if (persons.length >= 6) break;
  }

  console.log(`\n=== ЭКСПЕРИМЕНТ: письмо «Твой день» · Стрела · ${persons.length} сотрудников · день 2026-07-03 ===\n`);

  const cacheRows: Array<{ name: string; input: number; cached: number; model: string }> = [];
  let leakCount = 0;

  for (let i = 0; i < persons.length; i++) {
    const p = persons[i]!;
    const pkg = await svc.buildPersonDayPackage({
      tenantId: TENANT,
      person: { id: p.id, userId: p.userId, name: p.name, timezone: p.timezone },
      now: TARGET_NOW,
    });
    const userMessage = buildPersonDayUserMessage(pkg);

    const result = await llm.call({
      taskType: PERSONAL_DAY_NARRATIVE_TASK_TYPE,
      tenantId: TENANT,
      systemPrompt: PERSONAL_DAY_NARRATIVE_SYSTEM_PROMPT,
      userMessage,
      responseFormat: { type: 'json_schema', name: 'PersonalDay', schema: PERSONAL_DAY_JSON_SCHEMA, strict: true },
      reasoningEffort: 'medium',
      sourceRef: { type: 'personal-day-narrative-exp', id: `${p.id}` },
    });

    let parsed: { verdict?: { overall?: { emoji?: string; title?: string; oneLiner?: string }; axes?: Array<{ key: string; state: string; why: string }> }; letter?: unknown; shortSummary?: string } | null =
      null;
    try {
      parsed = JSON.parse(result.text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim());
    } catch {
      parsed = null;
    }
    const axes = Array.isArray(parsed?.verdict?.axes) ? parsed!.verdict!.axes! : [];
    const letter = Array.isArray(parsed?.letter)
      ? (parsed!.letter as Array<{ title?: string; prose?: string }>)
      : [];

    console.log(`\n──────────── ${i + 1}. ${p.name} ────────────`);
    console.log(
      `ВХОД: закрыто=${pkg.tasksDoneToday.length} просроч=${pkg.tasksOverdue.length} зависл=${pkg.tasksStuck.length} | обещаний дано=${pkg.commitmentsGiven.length} просроч=${pkg.commitmentsOverdue.length} | встреч=${pkg.meetings.length} голос=${pkg.voice.length} блокеров=${pkg.blockers.length} | активных=${pkg.activeTasks} вклад=${pkg.goalNetScore ?? '—'}`,
    );
    if (!parsed) console.log(`  (парс не удался, raw ${result.text.length} симв)`);
    if (parsed?.verdict?.overall) {
      console.log(`ВЕРДИКТ: ${parsed.verdict.overall.emoji} ${parsed.verdict.overall.title} — ${parsed.verdict.overall.oneLiner}`);
      for (const ax of axes) {
        console.log(`  ось ${ax.key}: ${ax.state} — ${ax.why}`);
      }
    }
    for (const s of letter) {
      console.log(`\n  «${s.title}»\n  ${s.prose}`);
    }
    console.log(`\n  push: ${parsed?.shortSummary ?? '—'}`);

    const fullText = [
      parsed?.verdict?.overall?.title,
      parsed?.verdict?.overall?.oneLiner,
      ...axes.map((a) => a.why),
      ...letter.map((s) => `${s.title ?? ''} ${s.prose ?? ''}`),
      parsed?.shortSummary,
    ]
      .filter(Boolean)
      .join(' ');
    const leak = fullText.match(SENTIMENT_RE);
    if (leak) {
      leakCount++;
      console.log(`  ⚠️ ВОЗМОЖНАЯ УТЕЧКА СЕНТИМЕНТА: "${leak[0]}"`);
    } else {
      console.log('  ✅ сентимент/конфликты не упомянуты');
    }

    cacheRows.push({ name: p.name, input: result.inputTokens, cached: result.cachedTokens, model: result.modelUsed });
    console.log(`  токены: input=${result.inputTokens} cached=${result.cachedTokens} model=${result.modelUsed}`);
  }

  console.log('\n\n=== КЭШ (общий системный префикс) ===');
  for (let i = 0; i < cacheRows.length; i++) {
    const r = cacheRows[i]!;
    const share = r.input > 0 ? Math.round((r.cached / r.input) * 100) : 0;
    console.log(`  ${i + 1}. ${r.name}: input=${r.input} cached=${r.cached} (${share}%) [${i === 0 ? 'прогрев' : 'должен бить в кэш'}]`);
  }
  const warmed = cacheRows.slice(1);
  const hits = warmed.filter((r) => r.cached > 0).length;
  console.log(`\n  Кэш-хиты после прогрева: ${hits}/${warmed.length}`);

  console.log('\n=== СЕНТИМЕНТ ===');
  console.log(`  Писем с возможной утечкой: ${leakCount}/${persons.length}`);

  await app.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('EXPERIMENT FAILED:', err);
    process.exit(1);
  });
