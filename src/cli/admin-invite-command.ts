import { InvitesService, type IssuedInvite } from '../invites/invites.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AdminInviteDeps {
  invites: InvitesService;
  prisma: PrismaService;
  out: (line: string) => void;
}

const USAGE = 'usage: npm run admin:invite [-- --recover <userId> | --list-admins]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function printInvite(invite: IssuedInvite, out: (line: string) => void): number {
  out(invite.url);
  out(`expires: ${invite.expiresAt.toISOString()}`);
  return 0;
}

/** Команда `admin:invite`: чистая функция без доступа к process; возвращает код выхода. */
export async function runAdminInvite(argv: string[], deps: AdminInviteDeps): Promise<number> {
  const { invites, prisma, out } = deps;

  if (argv.length === 0) {
    return printInvite(await invites.createJoin(null, true), out);
  }

  if (argv[0] === '--list-admins' && argv.length === 1) {
    const admins = await prisma.user.findMany({
      where: { isAdmin: true },
      select: { id: true, name: true, disabledAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const { id, name, disabledAt } of admins) {
      out(`${id}\t${name}\t${disabledAt ? 'disabled' : ''}`);
    }
    return 0;
  }

  if (argv[0] === '--recover' && argv.length === 2) {
    const userId = argv[1]!;
    if (!UUID.test(userId)) {
      out('error: userId must be a UUID');
      return 1;
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
    if (!user?.isAdmin) {
      out('error: admin user not found');
      return 1;
    }
    return printInvite(await invites.createRecovery(userId, null), out);
  }

  out(USAGE);
  return 1;
}
