import { NestFactory } from '@nestjs/core';
import { InvitesService } from '../invites/invites.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { runAdminInvite } from './admin-invite-command.js';
import { CliModule } from './cli.module.js';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(CliModule, { logger: ['error'] });
  try {
    process.exitCode = await runAdminInvite(process.argv.slice(2), {
      invites: app.get(InvitesService),
      prisma: app.get(PrismaService),
      out: (line) => {
        process.stdout.write(`${line}\n`);
      },
    });
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
