/** Smoke-обёртка → smoke-all-agents-runner.ts skill-trait-concept-name. */
process.argv = [process.argv[0]!, process.argv[1]!, 'skill-trait-concept-name'];
await import('./smoke-all-agents-runner');
