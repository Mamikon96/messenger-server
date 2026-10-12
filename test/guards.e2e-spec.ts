import { Controller, INestApplication, Post, UseGuards } from '@nestjs/common';
import request from 'supertest';
import { AuthRateLimitGuard } from '../src/common/auth-rate-limit.guard.js';
import { CommonModule } from '../src/common/common.module.js';
import { OriginGuard } from '../src/common/origin.guard.js';
import { createTestApp } from './support/create-app.js';

@Controller('guard-probe')
class GuardProbeController {
  @Post('origin')
  @UseGuards(OriginGuard)
  origin() {
    return { ok: true };
  }

  @Post('rate')
  @UseGuards(AuthRateLimitGuard)
  rate() {
    return { ok: true };
  }
}

async function appWithEnv(env: Record<string, string>): Promise<INestApplication> {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return createTestApp({ controllers: [GuardProbeController], imports: [CommonModule] });
}

describe('Public guards (e2e)', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('OriginGuard rejects missing and foreign Origin with 403 forbidden and passes http://localhost:3000', async () => {
    app = await appWithEnv({});
    const server = app.getHttpServer();
    const missing = await request(server).post('/api/guard-probe/origin').expect(403);
    expect(missing.body.error.code).toBe('forbidden');
    await request(server)
      .post('/api/guard-probe/origin')
      .set('Origin', 'http://evil.example')
      .expect(403);
    await request(server)
      .post('/api/guard-probe/origin')
      .set('Origin', 'http://localhost:3000')
      .expect(201);
  });

  it('AuthRateLimitGuard returns 429 rate_limited after AUTH_RATE_PER_MINUTE requests from one IP', async () => {
    app = await appWithEnv({ AUTH_RATE_PER_MINUTE: '3' });
    const server = app.getHttpServer();
    for (let i = 0; i < 3; i++) await request(server).post('/api/guard-probe/rate').expect(201);
    const res = await request(server).post('/api/guard-probe/rate').expect(429);
    expect(res.body.error.code).toBe('rate_limited');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('one IP bucket is shared by passkey and invite endpoints (full AppModule)', async () => {
    vi.stubEnv('AUTH_RATE_PER_MINUTE', '2');
    app = await createTestApp();
    const server = app.getHttpServer();
    const origin = 'http://localhost:3000';
    for (let i = 0; i < 2; i++) {
      await request(server)
        .post('/api/auth/passkey/login/options')
        .set('Origin', origin)
        .send({})
        .expect(200);
    }
    const res = await request(server)
      .post('/api/invites/inspect')
      .set('Origin', origin)
      .send({ token: 'x' })
      .expect(429);
    expect(res.body.error.code).toBe('rate_limited');
  });

  it('with TRUST_PROXY=1 different X-Forwarded-For values get separate buckets', async () => {
    app = await appWithEnv({ AUTH_RATE_PER_MINUTE: '1', TRUST_PROXY: '1' });
    const server = app.getHttpServer();
    await request(server).post('/api/guard-probe/rate').set('X-Forwarded-For', '1.1.1.1').expect(201);
    await request(server).post('/api/guard-probe/rate').set('X-Forwarded-For', '2.2.2.2').expect(201);
    await request(server).post('/api/guard-probe/rate').set('X-Forwarded-For', '1.1.1.1').expect(429);
  });

  it('with TRUST_PROXY=0 X-Forwarded-For is ignored', async () => {
    app = await appWithEnv({ AUTH_RATE_PER_MINUTE: '1', TRUST_PROXY: '0' });
    const server = app.getHttpServer();
    await request(server).post('/api/guard-probe/rate').set('X-Forwarded-For', '1.1.1.1').expect(201);
    await request(server).post('/api/guard-probe/rate').set('X-Forwarded-For', '2.2.2.2').expect(429);
  });
});
