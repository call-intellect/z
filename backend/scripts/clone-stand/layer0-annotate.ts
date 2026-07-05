import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { directLlmCall } from '../_lib/llm-direct';
import { assertNotProd, readConfig } from '../_lib/combat-harness';

import { CLONES, type CloneDef } from './clone-seed-data';

const ANNOTATOR_MODEL = 'deepseek-v4-pro';
const DOCS = resolve(process.cwd(), '../docs/testing');

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

interface Annotation {
  trait: string;
  evidence: string;
}

type Agreement = 'full' | 'partial' | 'conflict';

interface Review {
  derivedStatement: string;
  agreement: Agreement;
}

interface ExpectedTrait {
  methodId: string;
  derivedStatement: string;
  annotatorA: Annotation;
  annotatorB: Annotation;
  agreement: Agreement;
}

interface ManifestBearer {
  name: string;
  clone: CloneDef['key'];
  expectedTraits: ExpectedTrait[];
}

const ANNOTATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    trait: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['trait', 'evidence'],
} as const;

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    derivedStatement: { type: 'string' },
    agreement: { type: 'string', enum: ['full', 'partial', 'conflict'] },
  },
  required: ['derivedStatement', 'agreement'],
} as const;

function extractJson(raw: string): string {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return cleaned;
  return cleaned.slice(start, end + 1);
}

async function llmJson<T>(args: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  toolName: string;
  validate: (parsed: T) => boolean;
}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await directLlmCall({
        provider: 'deepseek',
        model: ANNOTATOR_MODEL,
        system: args.system,
        user: args.user,
        schema: args.schema,
        schemaName: args.toolName,
        toolName: args.toolName,
        maxTokens: 900,
      });
      if (res.error) throw new Error(`LLM error: ${res.error}`);
      const raw = res.toolCallArgs ?? res.text;
      if (!raw) throw new Error('пустой ответ LLM');
      const parsed = JSON.parse(extractJson(raw)) as T;
      if (!args.validate(parsed)) throw new Error('ответ не соответствует схеме');
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const ANNOTATOR_SYSTEM = [
  'Ты внимательный эксперт. Прочитай N высказываний одного человека о том, как он работает.',
  'Выведи ОДНУ черту его метода/подхода одним предложением — как он рассуждает/действует.',
  'Не цитируй дословно, а сформулируй поведенческий принцип.',
  'Поле trait — сама черта одним предложением. Поле evidence — короткое обоснование из высказываний (что навело).',
  'Верни результат ТОЛЬКО вызовом инструмента submit_trait. Если инструмент недоступен — верни чистый JSON по схеме, без markdown.',
].join('\n');

function annotatorUser(texts: string[]): string {
  return ['Высказывания:', ...texts.map((t, i) => `${i + 1}. ${t}`)].join('\n');
}

async function annotate(texts: string[]): Promise<Annotation> {
  return llmJson<Annotation>({
    system: ANNOTATOR_SYSTEM,
    user: annotatorUser(texts),
    schema: ANNOTATION_SCHEMA as unknown as Record<string, unknown>,
    toolName: 'submit_trait',
    validate: (p) => typeof p.trait === 'string' && p.trait.length > 0 && typeof p.evidence === 'string',
  });
}

const REVIEW_SYSTEM = [
  'Ты — ревизор слепой разметки. Даны две независимо выведенные формулировки ОДНОЙ черты ОДНОГО человека.',
  'Сведи их в консенсус-формулировку derivedStatement (одно предложение, поведенческий принцип, не дословная цитата).',
  'Оцени согласие двух разметчиков:',
  'full — совпадают по смыслу (та же черта);',
  'partial — та же тема, но разный акцент/охват/один упустил деталь;',
  'conflict — противоречат друг другу или про разное.',
  'Верни результат ТОЛЬКО вызовом инструмента submit_review. Если инструмент недоступен — верни чистый JSON по схеме.',
].join('\n');

async function review(a: Annotation, b: Annotation): Promise<Review> {
  const user = [
    `Формулировка разметчика А: ${a.trait}`,
    `Формулировка разметчика Б: ${b.trait}`,
  ].join('\n');
  return llmJson<Review>({
    system: REVIEW_SYSTEM,
    user,
    schema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
    toolName: 'submit_review',
    validate: (p) =>
      typeof p.derivedStatement === 'string' &&
      p.derivedStatement.length > 0 &&
      (p.agreement === 'full' || p.agreement === 'partial' || p.agreement === 'conflict'),
  });
}

async function main(): Promise<void> {
  assertNotProd(readConfig());

  const bearers: ManifestBearer[] = [];
  const agreementTally: Record<Agreement, number> = { full: 0, partial: 0, conflict: 0 };
  let methodTotal = 0;

  for (const clone of CLONES) {
    log(`=== клон ${clone.key} (${clone.roleName}) ===`);
    for (const bearer of clone.bearers) {
      log(`  носитель ${bearer.name}: ${bearer.methods.length} методов`);
      const expectedTraits: ExpectedTrait[] = [];
      for (const method of bearer.methods) {
        const texts = method.formulations.map((fm) => fm.text);
        const [annotatorA, annotatorB] = await Promise.all([annotate(texts), annotate(texts)]);
        const rev = await review(annotatorA, annotatorB);
        agreementTally[rev.agreement]++;
        methodTotal++;
        expectedTraits.push({
          methodId: method.id,
          derivedStatement: rev.derivedStatement,
          annotatorA,
          annotatorB,
          agreement: rev.agreement,
        });
        log(`    · ${method.id}: agreement=${rev.agreement} → «${rev.derivedStatement}»`);
      }
      bearers.push({ name: bearer.name, clone: clone.key, expectedTraits });
    }
  }

  const manifest = {
    _meta: {
      generatedFor: 'clone-stand Layer 0 — фиделити построения клона',
      method: 'blind double-annotation → reviewer consensus (docs/methodology/synthetic-fidelity-eval-method.md)',
      note: 'Черты ВЫВЕДЕНЫ слепо из formulations[].text (правило №1: НЕ из gist/question). Два разметчика независимы и не видят базу.',
      annotatorModel: ANNOTATOR_MODEL,
      methodsTotal: methodTotal,
      agreement: agreementTally,
      generatedAt: new Date().toISOString(),
    },
    bearers,
  };

  mkdirSync(DOCS, { recursive: true });
  const path = resolve(DOCS, 'clone-layer0-manifest.json');
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf8');
  log('');
  log(`✓ manifest → docs/testing/clone-layer0-manifest.json`);
  log(`  носителей: ${bearers.length} · методов: ${methodTotal} · agreement=${JSON.stringify(agreementTally)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
