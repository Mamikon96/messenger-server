import { Injectable } from '@nestjs/common';
import { allowedUserWhere } from '../allowlist/allowed-user.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface UserSummary {
  id: string;
  name: string;
  avatarUrl: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<UserSummary[]> {
    return this.prisma.user.findMany({
      where: allowedUserWhere,
      select: { id: true, name: true, avatarUrl: true },
      orderBy: { name: 'asc' },
    });
  }
}
