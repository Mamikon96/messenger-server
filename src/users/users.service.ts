import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { activeUserWhere } from './active-user.js';

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
      where: activeUserWhere,
      select: { id: true, name: true, avatarUrl: true },
      orderBy: { name: 'asc' },
    });
  }
}
