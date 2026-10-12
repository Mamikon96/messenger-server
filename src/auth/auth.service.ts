import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionsService } from '../sessions/sessions.service.js';

export interface SessionBody {
  user: { id: string; name: string; avatarUrl: string };
  csrfToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
  ) {}

  async getSession(token: string): Promise<SessionBody | null> {
    const session = await this.sessions.find(token);
    if (!session) return null;
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return null;
    return {
      user: { id: user.id, name: user.name, avatarUrl: user.avatarUrl },
      csrfToken: session.csrfToken,
    };
  }

  async signOut(token: string): Promise<void> {
    await this.sessions.destroy(token);
  }
}
