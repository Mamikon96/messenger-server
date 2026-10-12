import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SessionRequest } from '../sessions/session.guard.js';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { session } = context.switchToHttp().getRequest<SessionRequest>();
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user?.isAdmin) throw new AppError(403, 'forbidden');
    return true;
  }
}
