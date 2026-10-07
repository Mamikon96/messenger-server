import { Injectable } from '@nestjs/common';
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
      select: { id: true, name: true, avatarUrl: true },
      orderBy: { name: 'asc' },
    });
  }
}
