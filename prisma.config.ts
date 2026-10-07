import { defineConfig } from 'prisma/config';

try {
  process.loadEnvFile('.env');
} catch {
  // .env необязателен: DATABASE_URL может прийти из окружения
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
