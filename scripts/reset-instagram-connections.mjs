#!/usr/bin/env node

import 'dotenv/config';
import { ChannelType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_INSTAGRAM_STATE = {
  status: 'NOT_CONNECTED',
  message: 'Not connected.',
  externalAccountId: null,
  externalBusinessId: null,
  externalDisplayName: null,
  accessToken: null,
  tokenType: null,
  expiresIn: null,
  lastConnectedAt: null,
  lastProbeAt: null,
  lastProbeOk: null,
  lastWebhookAt: null,
  lastError: null,
};

function printUsage() {
  console.log('Usage:');
  console.log('  node scripts/reset-instagram-connections.mjs --dry-run');
  console.log('  node scripts/reset-instagram-connections.mjs --apply');
  console.log('  node scripts/reset-instagram-connections.mjs --apply --salon-id=5');
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function parseSalonIdArg(raw) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --salon-id value: ${raw}`);
  }
  return parsed;
}

function parseArgs(argv) {
  let apply = false;
  let salonId = null;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      apply = false;
      continue;
    }
    if (arg.startsWith('--salon-id=')) {
      salonId = parseSalonIdArg(arg.slice('--salon-id='.length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    apply,
    salonId,
  };
}

function isDefaultInstagramState(value) {
  const state = asObject(value);
  return (
    state.status === DEFAULT_INSTAGRAM_STATE.status &&
    state.message === DEFAULT_INSTAGRAM_STATE.message &&
    state.externalAccountId === DEFAULT_INSTAGRAM_STATE.externalAccountId &&
    state.externalBusinessId === DEFAULT_INSTAGRAM_STATE.externalBusinessId &&
    state.externalDisplayName === DEFAULT_INSTAGRAM_STATE.externalDisplayName &&
    state.accessToken === DEFAULT_INSTAGRAM_STATE.accessToken &&
    state.tokenType === DEFAULT_INSTAGRAM_STATE.tokenType &&
    state.expiresIn === DEFAULT_INSTAGRAM_STATE.expiresIn &&
    state.lastConnectedAt === DEFAULT_INSTAGRAM_STATE.lastConnectedAt &&
    state.lastProbeAt === DEFAULT_INSTAGRAM_STATE.lastProbeAt &&
    state.lastProbeOk === DEFAULT_INSTAGRAM_STATE.lastProbeOk &&
    state.lastWebhookAt === DEFAULT_INSTAGRAM_STATE.lastWebhookAt &&
    state.lastError === DEFAULT_INSTAGRAM_STATE.lastError
  );
}

async function resolveTargetSalonIds(salonId) {
  if (salonId) {
    const salon = await prisma.salon.findUnique({
      where: { id: salonId },
      select: { id: true, name: true },
    });
    if (!salon) {
      throw new Error(`Salon not found for --salon-id=${salonId}`);
    }
    return [salon.id];
  }

  const salons = await prisma.salon.findMany({
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  return salons.map((item) => item.id);
}

async function main() {
  const { apply, salonId } = parseArgs(process.argv.slice(2));
  const mode = apply ? 'apply' : 'dry-run';

  const targetSalonIds = await resolveTargetSalonIds(salonId);
  if (targetSalonIds.length === 0) {
    console.log(JSON.stringify({ mode, message: 'No salons found.' }, null, 2));
    return;
  }

  const [settingsRows, instagramBindingCount] = await Promise.all([
    prisma.salonAiAgentSettings.findMany({
      where: { salonId: { in: targetSalonIds } },
      select: { salonId: true, faqAnswers: true },
    }),
    prisma.salonChannelBinding.count({
      where: {
        salonId: { in: targetSalonIds },
        channel: ChannelType.INSTAGRAM,
      },
    }),
  ]);

  const settingsBySalonId = new Map(settingsRows.map((row) => [row.salonId, row]));
  let settingsNeedingUpdate = 0;
  let settingsMissing = 0;

  for (const id of targetSalonIds) {
    const existing = settingsBySalonId.get(id);
    if (!existing) {
      settingsMissing += 1;
      settingsNeedingUpdate += 1;
      continue;
    }

    const faqAnswers = asObject(existing.faqAnswers);
    const metaDirect = asObject(faqAnswers.metaDirect);
    const instagram = asObject(metaDirect.instagram);
    if (!isDefaultInstagramState(instagram)) {
      settingsNeedingUpdate += 1;
    }
  }

  let deletedBindings = 0;
  let settingsUpdated = 0;
  let settingsCreated = 0;

  if (apply) {
    for (const id of targetSalonIds) {
      const existing = settingsBySalonId.get(id);
      const faqAnswers = asObject(existing?.faqAnswers);
      const metaDirect = asObject(faqAnswers.metaDirect);
      const whatsapp = asObject(metaDirect.whatsapp);

      const nextFaqAnswers = {
        ...faqAnswers,
        metaDirect: {
          ...metaDirect,
          instagram: { ...DEFAULT_INSTAGRAM_STATE },
          whatsapp,
        },
      };

      if (existing) {
        await prisma.salonAiAgentSettings.update({
          where: { salonId: id },
          data: { faqAnswers: nextFaqAnswers },
        });
        settingsUpdated += 1;
      } else {
        await prisma.salonAiAgentSettings.create({
          data: {
            salonId: id,
            faqAnswers: nextFaqAnswers,
          },
        });
        settingsCreated += 1;
      }
    }

    const deleteResult = await prisma.salonChannelBinding.deleteMany({
      where: {
        salonId: { in: targetSalonIds },
        channel: ChannelType.INSTAGRAM,
      },
    });
    deletedBindings = deleteResult.count;
  }

  console.log(
    JSON.stringify(
      {
        mode,
        salonFilter: salonId,
        targetSalonCount: targetSalonIds.length,
        bindings: {
          instagramBindingsFound: instagramBindingCount,
          instagramBindingsDeleted: deletedBindings,
        },
        settings: {
          existingSettingsRows: settingsRows.length,
          missingSettingsRows: settingsMissing,
          rowsNeedingUpdate: settingsNeedingUpdate,
          rowsUpdated: settingsUpdated,
          rowsCreated: settingsCreated,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('reset-instagram-connections failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
