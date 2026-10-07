import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    fileParallelism: false,
    env: {
      // e2e всегда идут в тестовую БД, чтобы TRUNCATE не стёр dev-данные
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://postgres:postgres@localhost:5433/messenger_test',
      PUBLIC_URL: 'http://localhost:3000',
      ALLOWED_ORIGINS: 'http://localhost:3000',
      FIRST_ADMIN: 'github:root-admin',
      GOOGLE_CLIENT_ID: 'test',
      GOOGLE_CLIENT_SECRET: 'test',
      GITHUB_CLIENT_ID: 'test',
      GITHUB_CLIENT_SECRET: 'test',
    },
  },
});
