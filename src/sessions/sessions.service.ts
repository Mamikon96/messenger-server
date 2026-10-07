import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SessionInfo {
  userId: string;
  csrfToken: string;
  expiresAt: Date;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(userId: string): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.get().sessionTtlDays * 86_400_000);
    await this.prisma.session.create({
      data: { id: hashToken(token), userId, csrfToken, expiresAt },
    });
    return { token, csrfToken, expiresAt };
  }

  async find(token: string): Promise<SessionInfo | null> {
    const session = await this.prisma.session.findUnique({ where: { id: hashToken(token) } });
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    return { userId: session.userId, csrfToken: session.csrfToken, expiresAt: session.expiresAt };
  }

  async destroy(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: hashToken(token) } });
  }
}
