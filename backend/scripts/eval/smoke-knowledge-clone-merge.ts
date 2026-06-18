process.argv = [process.argv[0]!, process.argv[1]!, 'knowledge-clone-merge'];
await import('./smoke-all-agents-runner');
