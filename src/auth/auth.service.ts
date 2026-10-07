import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { ConfigService } from '../config/config.service.js';
import type { Provider } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import type { OAuthProfile } from './oauth-provider.js';

export interface SessionBody {
  user: { id: string; name: string; avatarUrl: string; provider: Provider };
  csrfToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly config: ConfigService,
  ) {}

  async signIn(
    provider: Provider,
    profile: OAuthProfile,
  ): Promise<{ token: string; expiresAt: Date }> {
    const login = profile.login.toLowerCase();
    const user = await this.prisma.$transaction(async (tx) => {
      // Sign-ins of one account (several tabs) run one at a time: under READ COMMITTED their
      // reads would otherwise mix states before/after a parallel commit (false `not_allowed`,
      // deleting an already deleted entry). Other accounts are not blocked; races between
      // accounts for one entry are settled by the atomic claim below (BE-D15, BE-13).
      const accountKey = `auth:${provider}:${profile.providerUserId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${accountKey}, 0))`;
      const existing = await tx.user.findUnique({
        where: { provider_providerUserId: { provider, providerUserId: profile.providerUserId } },
      });
      const linked = existing
        ? await tx.allowlistEntry.findUnique({ where: { userId: existing.id } })
        : null;
      const byLogin = await tx.allowlistEntry.findUnique({
        where: { provider_providerLogin: { provider, providerLogin: login } },
      });
      // An entry already linked to another account belongs to that account (BE-D15).
      const heldByOther = byLogin !== null && byLogin.userId !== null && byLogin.userId !== existing?.id;
      const claimable = byLogin !== null && !heldByOther;

      let isAdmin = existing?.isAdmin ?? false;
      if (linked && heldByOther) throw new AppError(409, 'login_taken');
      if (!isAdmin && !linked && !claimable) {
        if (!(await this.canBootstrapAdmin(tx, provider, login))) {
          throw new AppError(403, 'not_allowed');
        }
        isAdmin = true;
      }

      const saved = await tx.user.upsert({
        where: { provider_providerUserId: { provider, providerUserId: profile.providerUserId } },
        update: { name: profile.name, avatarUrl: profile.avatarUrl, isAdmin },
        create: {
          provider,
          providerUserId: profile.providerUserId,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          isAdmin,
        },
      });

      if (linked && claimable && byLogin.id !== linked.id) {
        // The new login was already allowlisted: keep that entry, drop the stale one.
        await tx.allowlistEntry.delete({ where: { id: linked.id } });
        await this.claim(tx, byLogin.id, saved.id);
      } else if (linked && linked.providerLogin !== login) {
        await tx.allowlistEntry.update({ where: { id: linked.id }, data: { providerLogin: login } });
      } else if (!linked && claimable) {
        await this.claim(tx, byLogin.id, saved.id);
      }
      return saved;
    });
    const { token, expiresAt } = await this.sessions.create(user.id);
    return { token, expiresAt };
  }

  // Atomic claim: two accounts racing for one entry cannot overwrite each other.
  private async claim(tx: Pick<PrismaService, 'allowlistEntry'>, entryId: string, userId: string) {
    const { count } = await tx.allowlistEntry.updateMany({
      // Re-claiming by the same user is idempotent (parallel first sign-ins, two tabs).
      where: { id: entryId, OR: [{ userId: null }, { userId }] },
      data: { userId },
    });
    if (count === 0) throw new AppError(403, 'not_allowed');
  }

  // FIRST_ADMIN only bootstraps the very first administrator (BE-D15).
  private async canBootstrapAdmin(
    tx: Pick<PrismaService, 'user'>,
    provider: Provider,
    login: string,
  ): Promise<boolean> {
    const { firstAdmin } = this.config.get();
    if (firstAdmin.provider !== provider || firstAdmin.login !== login) return false;
    return (await tx.user.count({ where: { isAdmin: true } })) === 0;
  }

  async getSession(token: string): Promise<SessionBody | null> {
    const session = await this.sessions.find(token);
    if (!session) return null;
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return null;
    return {
      user: { id: user.id, name: user.name, avatarUrl: user.avatarUrl, provider: user.provider },
      csrfToken: session.csrfToken,
    };
  }

  async signOut(token: string): Promise<void> {
    await this.sessions.destroy(token);
  }
}
