process.argv = [process.argv[0]!, process.argv[1]!, 'skill-trait-merge'];
await import('./smoke-all-agents-runner');
