let installed = false;

function isConnectionClosed(reason: unknown): boolean {
  const msg = reason instanceof Error ? reason.message : String(reason ?? '');
  return msg.includes('Connection is closed');
}

export function silenceRedisShutdownNoise(): void {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason) => {
    if (isConnectionClosed(reason)) return;
    // eslint-disable-next-line no-console
    console.error('Unhandled rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    if (isConnectionClosed(err)) return;
    // eslint-disable-next-line no-console
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
}
