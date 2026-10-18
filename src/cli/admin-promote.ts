import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { runAdminPromote } from './admin-promote-command.js';
import { CliModule } from './cli.module.js';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: ['error'],
  });
  try {
    const lines: string[] = [];
    const code = await runAdminPromote(process.argv.slice(2), {
      prisma: app.get(PrismaService),
      out: (line) => lines.push(line),
    });
    // сообщения об ошибках — в stderr
    (code === 0 ? process.stdout : process.stderr).write(
      lines.map((line) => `${line}\n`).join(''),
    );
    process.exitCode = code;
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
