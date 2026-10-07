import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import type { Provider } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AllowlistItem {
  id: string;
  provider: Provider;
  login: string;
  createdAt: Date;
}

@Injectable()
export class AllowlistService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<AllowlistItem[]> {
    const entries = await this.prisma.allowlistEntry.findMany({ orderBy: { createdAt: 'asc' } });
    return entries.map(toItem);
  }

  async add(provider: Provider, login: string, addedBy: string | null): Promise<AllowlistItem> {
    const providerLogin = login.toLowerCase();
    try {
      const entry = await this.prisma.allowlistEntry.create({
        data: { provider, providerLogin, addedById: addedBy },
      });
      return toItem(entry);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new AppError(409, 'already_exists');
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const { count } = await this.prisma.allowlistEntry.deleteMany({ where: { id } });
    if (count === 0) throw new AppError(404, 'not_found');
  }
}

function toItem(entry: {
  id: string;
  provider: Provider;
  providerLogin: string;
  createdAt: Date;
}): AllowlistItem {
  return {
    id: entry.id,
    provider: entry.provider,
    login: entry.providerLogin,
    createdAt: entry.createdAt,
  };
}
