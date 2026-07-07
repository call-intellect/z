import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== patch-llm-provider-protocols START ===');
  let providersPatched = 0;
  let modelsDeactivated = 0;

  const kie = await prisma.llmProvider.findUnique({ where: { name: 'kie' } });
  if (kie && kie.protocolKind === 'custom-http') {
    await prisma.llmProvider.update({
      where: { id: kie.id },
      data: {
        protocolKind: 'kie-native',
        defaultModelKey: kie.defaultModelKey ?? 'gemini-3.1-pro',
      },
    });
    providersPatched++;
    // eslint-disable-next-line no-console
    console.log('kie: custom-http → kie-native');
  }

  const grsai = await prisma.llmProvider.findUnique({ where: { name: 'grsai' } });
  if (grsai && grsai.protocolKind === 'custom-http') {
    await prisma.llmProvider.update({
      where: { id: grsai.id },
      data: {
        protocolKind: 'grsai-native',
        useProxy: true,
        proxyPath: 'grsai',
        baseUrl: grsai.baseUrl.includes('proxy.agent-lia.ru')
          ? 'https://grsaiapi.com'
          : grsai.baseUrl,
        defaultModelKey: grsai.defaultModelKey ?? 'gemini-3.1-pro',
      },
    });
    providersPatched++;
    // eslint-disable-next-line no-console
    console.log('grsai: custom-http → grsai-native (+useProxy/proxyPath)');
  }

  if (kie) {
    const staleModel = await prisma.llmModel.findFirst({
      where: { providerId: kie.id, modelKey: 'gpt-5-4', isActive: true },
    });
    if (staleModel) {
      await prisma.llmModel.update({ where: { id: staleModel.id }, data: { isActive: false } });
      modelsDeactivated++;
      // eslint-disable-next-line no-console
      console.log('kie/gpt-5-4: деактивирована (опечатка, реальный ключ gpt-5.4)');
    }
  }

  // eslint-disable-next-line no-console
  console.log(`providersPatched=${providersPatched}, modelsDeactivated=${modelsDeactivated}`);
  // eslint-disable-next-line no-console
  console.log('=== patch-llm-provider-protocols DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-llm-provider-protocols FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
