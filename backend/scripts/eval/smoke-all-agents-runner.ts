/**
 * Универсальный smoke-runner для 7 LLM-агентов knowledge-core.
 *
 * Запуск: cd backend && bun run scripts/eval/smoke-all-agents-runner.ts <taskType>
 *
 * Цель — проверить «работают ли промпты вообще»: один вызов DeepSeek-Pro на
 * фикстуру, без ассертов корректности. Падение с 400/500 = провал, осмысленный
 * непустой ответ = успех.
 *
 * DeepSeek-Pro thinking НЕ поддерживает json_schema strict и tool_choice: 'required'.
 * Используем tools + tool_choice: 'auto' + явное «верни через инструмент submit_*»
 * для структурного выхода, либо response_format: { type: 'json_object' } для
 * простых случаев.
 */
import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

import {
  IDEA_STATUS_SUMMARIZE_SYSTEM_PROMPT,
  IDEA_STATUS_SUMMARIZE_USER_TEMPLATE,
  IDEA_STATUS_SUMMARIZE_JSON_SCHEMA,
} from '../../src/modules/knowledge-core/prompts/idea-status-summarize.prompt';
import {
  REGULATION_DEDUPE_SYSTEM_PROMPT,
  REGULATION_DEDUPE_USER_TEMPLATE,
  REGULATION_DEDUPE_JSON_SCHEMA,
} from '../../src/modules/knowledge-core/prompts/regulation-dedupe.prompt';
import {
  PROCESS_STEPS_EXTRACT_SYSTEM_PROMPT,
  PROCESS_STEPS_EXTRACT_USER_TEMPLATE,
  PROCESS_STEPS_EXTRACT_JSON_SCHEMA,
} from '../../src/modules/knowledge-core/prompts/process-steps-extract.prompt';
import {
  PROCESS_TEMPLATE_EXTRACT_SYSTEM_PROMPT,
  PROCESS_TEMPLATE_EXTRACT_USER_TEMPLATE,
  PROCESS_TEMPLATE_EXTRACT_JSON_SCHEMA,
} from '../../src/modules/knowledge-core/prompts/process-template-extract.prompt';
import {
  KNOWLEDGE_CLONE_MERGE_SYSTEM_PROMPT,
  KNOWLEDGE_CLONE_MERGE_USER_TEMPLATE,
  KNOWLEDGE_CLONE_MERGE_JSON_SCHEMA,
} from '../../src/modules/knowledge-core/prompts/knowledge-clone-merge.prompt';
import {
  SKILL_TRAIT_CONCEPT_NAME_SYSTEM_PROMPT,
  SKILL_TRAIT_CONCEPT_NAME_USER_TEMPLATE,
  SKILL_TRAIT_CONCEPT_NAME_JSON_SCHEMA,
} from '../../src/modules/knowledge-core/prompts/skill-trait-concept-name.prompt';
import {
  SKILL_TRAIT_MERGE_SYSTEM_PROMPT,
  SKILL_TRAIT_MERGE_USER_TEMPLATE,
  SKILL_TRAIT_MERGE_JSON_SCHEMA,
} from '../../src/modules/knowledge-core/prompts/skill-trait-merge.prompt';

const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;
const MAX_TOKENS = 4_000;

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY not set');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

interface SmokeSpec {
  taskType: string;
  systemPrompt: string;
  userMessage: string;
  toolName: string;
  toolDescription: string;
  toolSchema: Record<string, unknown>;
}

async function buildSpec(taskType: string, fixturePath: string): Promise<SmokeSpec> {
  const raw = JSON.parse(await fs.readFile(fixturePath, 'utf-8'));

  switch (taskType) {
    case 'idea-status-summarize': {
      return {
        taskType,
        systemPrompt: IDEA_STATUS_SUMMARIZE_SYSTEM_PROMPT,
        userMessage:
          IDEA_STATUS_SUMMARIZE_USER_TEMPLATE({
            ideaStatement: raw.ideaStatement,
            oldStatus: raw.oldStatus,
            newStatus: raw.newStatus,
            reason: raw.reason ?? null,
          }) +
          '\n\nВажно: верни ответ через вызов инструмента submit_idea_status_summary.',
        toolName: 'submit_idea_status_summary',
        toolDescription:
          'Отправить итоговый title + body нотификации supporter\'у идеи.',
        toolSchema: IDEA_STATUS_SUMMARIZE_JSON_SCHEMA,
      };
    }
    case 'regulation-dedupe': {
      return {
        taskType,
        systemPrompt: REGULATION_DEDUPE_SYSTEM_PROMPT,
        userMessage:
          REGULATION_DEDUPE_USER_TEMPLATE({
            draft: raw.draft,
            candidates: raw.candidates,
          }) +
          '\n\nВажно: верни ответ через вызов инструмента submit_regulation_dedupe.',
        toolName: 'submit_regulation_dedupe',
        toolDescription:
          'Отправить вердикт о черновике регламента: new / merge / extension / contradicts.',
        toolSchema: REGULATION_DEDUPE_JSON_SCHEMA,
      };
    }
    case 'process-steps-extract': {
      return {
        taskType,
        systemPrompt: PROCESS_STEPS_EXTRACT_SYSTEM_PROMPT,
        userMessage:
          PROCESS_STEPS_EXTRACT_USER_TEMPLATE({
            processName: raw.processName,
            blocks: raw.blocks,
          }) +
          '\n\nВажно: верни ответ через вызов инструмента submit_process_steps.',
        toolName: 'submit_process_steps',
        toolDescription: 'Отправить упорядоченный список шагов процесса.',
        toolSchema: PROCESS_STEPS_EXTRACT_JSON_SCHEMA,
      };
    }
    case 'process-template-extract': {
      return {
        taskType,
        systemPrompt: PROCESS_TEMPLATE_EXTRACT_SYSTEM_PROMPT,
        userMessage:
          PROCESS_TEMPLATE_EXTRACT_USER_TEMPLATE({
            blocks: raw.blocks,
            existingTemplates: raw.existingTemplates ?? [],
          }) +
          '\n\nВажно: верни ответ через вызов инструмента submit_process_templates.',
        toolName: 'submit_process_templates',
        toolDescription: 'Отправить кандидатов на шаблоны процессов.',
        toolSchema: PROCESS_TEMPLATE_EXTRACT_JSON_SCHEMA,
      };
    }
    case 'knowledge-clone-merge': {
      return {
        taskType,
        systemPrompt: KNOWLEDGE_CLONE_MERGE_SYSTEM_PROMPT,
        userMessage:
          KNOWLEDGE_CLONE_MERGE_USER_TEMPLATE({
            personName: raw.personName,
            nowIso: raw.nowIso,
            oldProfileJson: JSON.stringify(raw.oldProfile, null, 2),
            newDraftJson: JSON.stringify(raw.newDraft, null, 2),
          }) +
          '\n\nВажно: верни итоговый профиль через вызов инструмента submit_knowledge_clone_profile.',
        toolName: 'submit_knowledge_clone_profile',
        toolDescription:
          'Отправить объединённый профиль знаний сотрудника по схеме knowledge_clone_extract_v1.',
        toolSchema: KNOWLEDGE_CLONE_MERGE_JSON_SCHEMA,
      };
    }
    case 'skill-trait-concept-name': {
      return {
        taskType,
        systemPrompt: SKILL_TRAIT_CONCEPT_NAME_SYSTEM_PROMPT,
        userMessage:
          SKILL_TRAIT_CONCEPT_NAME_USER_TEMPLATE({ variants: raw.variants }) +
          '\n\nВажно: верни ответ через вызов инструмента submit_concept_name.',
        toolName: 'submit_concept_name',
        toolDescription: 'Отправить каноническое имя смыслового блока навыка.',
        toolSchema: SKILL_TRAIT_CONCEPT_NAME_JSON_SCHEMA,
      };
    }
    case 'skill-trait-merge': {
      return {
        taskType,
        systemPrompt: SKILL_TRAIT_MERGE_SYSTEM_PROMPT,
        userMessage:
          SKILL_TRAIT_MERGE_USER_TEMPLATE({
            draft: raw.draft,
            candidates: raw.candidates,
          }) +
          '\n\nВажно: верни ответ через вызов инструмента submit_skill_trait_merge.',
        toolName: 'submit_skill_trait_merge',
        toolDescription:
          'Отправить вердикт по слиянию черты: merge / supersedes / new.',
        toolSchema: SKILL_TRAIT_MERGE_JSON_SCHEMA,
      };
    }
    default:
      throw new Error(`Unknown taskType: ${taskType}`);
  }
}

async function main(): Promise<void> {
  const taskType = process.argv[2];
  if (!taskType) {
    console.error('Usage: bun run scripts/eval/smoke-all-agents-runner.ts <taskType>');
    process.exit(1);
  }

  const fixtureDir = path.resolve('test/eval/smoke-all-agents/fixtures');
  const reportDir = path.resolve('test/eval/smoke-all-agents/reports');
  const fixturePath = path.join(fixtureDir, `${taskType}.json`);
  const reportPath = path.join(reportDir, `${taskType}.json`);

  console.log(`=== Smoke: ${taskType} ===`);
  let promptFound = true;
  let ranSuccessfully = false;
  let tokensIn = 0;
  let tokensOut = 0;
  let cachedTokens = 0;
  let costUsd = 0;
  let ms = 0;
  let modelResponse = '';
  let errorMsg: string | undefined;

  let spec: SmokeSpec;
  try {
    spec = await buildSpec(taskType, fixturePath);
  } catch (e) {
    promptFound = false;
    errorMsg = `buildSpec failed: ${(e as Error).message}`;
    await fs.writeFile(
      reportPath,
      JSON.stringify(
        {
          taskType,
          promptFound,
          ranSuccessfully,
          tokensIn,
          tokensOut,
          costUsd,
          ms,
          modelResponse,
          error: errorMsg,
        },
        null,
        2,
      ),
      'utf-8',
    );
    console.error(`  FAIL: ${errorMsg}`);
    return;
  }

  const tool = {
    type: 'function' as const,
    function: {
      name: spec.toolName,
      description: spec.toolDescription,
      parameters: spec.toolSchema,
    },
  };

  const start = Date.now();
  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: spec.systemPrompt },
        { role: 'user', content: spec.userMessage },
      ],
      max_tokens: MAX_TOKENS,
      tools: [tool],
      tool_choice: 'auto',
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_cache_hit_tokens?: number;
        cached_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const usage = resp.usage ?? {};
    tokensIn = usage.prompt_tokens ?? 0;
    tokensOut = usage.completion_tokens ?? 0;
    cachedTokens =
      usage.prompt_cache_hit_tokens ??
      usage.cached_tokens ??
      usage.prompt_tokens_details?.cached_tokens ??
      0;

    const msg = resp.choices[0]?.message;
    const call = msg?.tool_calls?.[0];
    if (call) {
      modelResponse = call.function.arguments.slice(0, 600);
      // Парсим JSON для подтверждения, что это валидный структурный выход.
      try {
        JSON.parse(call.function.arguments);
        ranSuccessfully = true;
      } catch (e) {
        errorMsg = `tool args not valid JSON: ${(e as Error).message}`;
      }
    } else {
      const txt = msg?.content ?? '';
      modelResponse = txt.slice(0, 600);
      // Попробуем распарсить как JSON — модель могла ответить текстом.
      try {
        JSON.parse(txt);
        ranSuccessfully = true;
        errorMsg = 'модель вернула JSON в content вместо tool_call (приемлемо для smoke)';
      } catch {
        // не JSON — но если есть осмысленный текст, считаем что «не упало»
        if (txt.trim().length >= 20) {
          ranSuccessfully = true;
          errorMsg = 'модель вернула свободный текст вместо tool_call (приемлемо для smoke)';
        } else {
          errorMsg = `пустой/слишком короткий ответ: ${txt.slice(0, 100)}`;
        }
      }
    }
  } catch (e) {
    errorMsg = (e as Error).message;
  }
  ms = Date.now() - start;

  const uncached = Math.max(0, tokensIn - cachedTokens);
  costUsd = uncached * PRICE_IN + cachedTokens * PRICE_CACHED_IN + tokensOut * PRICE_OUT;

  console.log(
    `  ${ranSuccessfully ? 'OK ' : 'FAIL'} | ${ms} ms | in=${tokensIn} (cache=${cachedTokens}) out=${tokensOut} | $${costUsd.toFixed(4)}${errorMsg ? ` | ${errorMsg}` : ''}`,
  );
  console.log(`  preview: ${modelResponse.slice(0, 200).replace(/\s+/g, ' ')}`);

  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        taskType,
        promptFound,
        ranSuccessfully,
        tokensIn,
        tokensOut,
        cachedTokens,
        costUsd,
        ms,
        modelResponse,
        error: errorMsg,
      },
      null,
      2,
    ),
    'utf-8',
  );
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
