import { lockUserRow } from '../auth/user-lock.js';
import { normalizeLogin } from '../auth/password/login.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AdminPromoteDeps {
  prisma: PrismaService;
  out: (line: string) => void;
}

const USAGE = 'usage: npm run admin:promote <login>';

/** Команда `admin:promote`: чистая функция без доступа к process; возвращает код выхода. */
export async function runAdminPromote(
  argv: string[],
  deps: AdminPromoteDeps,
): Promise<number> {
  const { prisma, out } = deps;

  if (argv.length !== 1 || argv[0]!.startsWith('-')) {
    out(USAGE);
    return 1;
  }
  const normalized = normalizeLogin(argv[0]!);
  // не прошедший формат логин существовать не может
  const user = normalized.ok
    ? await prisma.user.findUnique({
        where: { login: normalized.login },
        select: { id: true, login: true, isAdmin: true, disabledAt: true },
      })
    : null;
  if (!user) {
    out('error: user not found');
    return 1;
  }
  // та же блокировка строки, что берут отключение и вход: гонка «отключение ↔ promote»
  const promoted = await prisma.$transaction(async (tx) => {
    const locked = await lockUserRow(tx, user.id);
    if (!locked) return 'not_found';
    if (locked.disabledAt) return 'disabled';
    if (!user.isAdmin) {
      await tx.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    }
    return 'ok';
  });
  if (promoted === 'not_found') {
    out('error: user not found');
    return 1;
  }
  if (promoted === 'disabled') {
    out('error: user is disabled; enable it in the admin panel first');
    return 1;
  }
  out(`${user.login} is an admin`);
  return 0;
}
