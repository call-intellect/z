async function main(): Promise<void> {
  console.log('backfill-task-source-type: no-op (legacy Task model dropped)');
}

main().catch((err) => {
  console.error('backfill-task-source-type FAILED:', err);
  process.exit(1);
});
