import { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../common/app-error.js';
import { LoginAttemptLimiter } from '../common/login-attempt-limiter.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import { AuthService } from './auth.service.js';
import {
  hashPassword,
  verifyAgainstDummyHash,
  verifyPassword,
} from './password/password-hasher.js';

vi.mock('./password/password-hasher.js', () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  verifyAgainstDummyHash: vi.fn(),
}));

const STORED_HASH = '$argon2id$stored';
const userRow = {
  id: 'u1',
  login: 'alice',
  firstName: 'A',
  lastName: 'B',
  name: 'A B',
  avatarUrl: '',
};

describe('AuthService', () => {
  const calls: string[] = [];
  const findUnique = vi.fn();
  const findUniqueOrThrow = vi.fn();
  const queryRaw = vi.fn();
  const userCreate = vi.fn();
  const transaction = vi.fn();
  const sessionsCreate = vi.fn();
  const sessionsDestroy = vi.fn();
  let service: AuthService;
  let limiter: LoginAttemptLimiter;

  beforeEach(() => {
    vi.resetAllMocks();
    calls.length = 0;
    vi.mocked(hashPassword).mockImplementation(() => {
      calls.push('hash');
      return Promise.resolve('$argon2id$new');
    });
    vi.mocked(verifyPassword).mockImplementation(() => {
      calls.push('verify');
      return Promise.resolve(true);
    });
    vi.mocked(verifyAgainstDummyHash).mockImplementation(() => {
      calls.push('dummy');
      return Promise.resolve(false);
    });
    transaction.mockImplementation((fn: (tx: unknown) => unknown) => {
      calls.push('tx');
      return fn({
        user: { create: userCreate, findUnique, findUniqueOrThrow },
        $queryRaw: queryRaw,
      });
    });
    sessionsCreate.mockResolvedValue({
      token: 't',
      csrfToken: 'c',
      expiresAt: new Date(),
    });
    userCreate.mockResolvedValue(userRow);
    const prisma = {
      user: { findUnique },
      $transaction: transaction,
    } as unknown as PrismaService;
    const sessions = {
      create: sessionsCreate,
      destroy: sessionsDestroy,
    } as unknown as SessionsService;
    limiter = new LoginAttemptLimiter();
    service = new AuthService(prisma, sessions, limiter);
  });

  describe('register', () => {
    it('checks login availability before hashing: taken login -> 409 without argon2', async () => {
      findUnique.mockResolvedValue({ id: 'x' });
      await expect(
        service.register({ login: 'alice', password: 'whatever-long-pass' }),
      ).rejects.toMatchObject({ code: 'login_taken' });
      expect(hashPassword).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it('hashes outside the transaction', async () => {
      findUnique.mockResolvedValue(null);
      await service.register({
        login: 'alice',
        password: 'whatever-long-pass',
      });
      expect(calls).toEqual(['hash', 'tx']);
    });

    it('maps a P2002 unique violation of the transaction to 409 login_taken', async () => {
      findUnique.mockResolvedValue(null);
      transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      const error: unknown = await service
        .register({ login: 'alice', password: 'whatever-long-pass' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'login_taken' });
      expect((error as AppError).getStatus()).toBe(409);
    });

    it('rethrows other transaction errors', async () => {
      findUnique.mockResolvedValue(null);
      const boom = new Error('boom');
      transaction.mockRejectedValue(boom);
      await expect(
        service.register({ login: 'alice', password: 'whatever-long-pass' }),
      ).rejects.toBe(boom);
    });
  });

  describe('login attempt limit', () => {
    const exhaust = (login: string) => {
      for (let i = 0; i < 10; i++) limiter.acquire(login);
    };

    it('limited login: 429 before any database query or argon2 work', async () => {
      exhaust('alice');
      const error: unknown = await service
        .login({ login: ' Alice ', password: 'x' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'rate_limited' });
      expect((error as AppError).headers?.['Retry-After']).toBeDefined();
      expect(findUnique).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('counts failures for an unknown but well-formed login', async () => {
      findUnique.mockResolvedValue(null);
      for (let i = 0; i < 10; i++) {
        await expect(
          service.login({ login: 'Nobody', password: 'x' }),
        ).rejects.toMatchObject({ code: 'auth_failed' });
      }
      await expect(
        service.login({ login: 'nobody', password: 'x' }),
      ).rejects.toMatchObject({ code: 'rate_limited' });
    });

    it('does not count or store a login that violates the format', async () => {
      for (let i = 0; i < 12; i++) {
        await expect(
          service.login({ login: `bad login ${i}!`, password: 'x' }),
        ).rejects.toMatchObject({ code: 'auth_failed' });
      }
      await expect(
        service.login({ login: 'a'.repeat(40), password: 'x' }),
      ).rejects.toMatchObject({ code: 'auth_failed' });
      expect(limiter.size()).toBe(0);
    });

    it('a successful login resets the counter', async () => {
      findUnique.mockResolvedValue({ id: 'u1', passwordHash: STORED_HASH });
      findUniqueOrThrow.mockResolvedValue(userRow);
      queryRaw.mockResolvedValue([
        { password_hash: STORED_HASH, disabled_at: null },
      ]);
      for (let i = 0; i < 9; i++) limiter.acquire('alice');
      await service.login({ login: 'alice', password: 'x' });
      expect(limiter.size()).toBe(0);
    });

    it('a database failure after acquire keeps the slot counted', async () => {
      findUnique.mockRejectedValue(new Error('db down'));
      await expect(
        service.login({ login: 'alice', password: 'x' }),
      ).rejects.toThrow('db down');
      expect(limiter.size()).toBe(1);
    });

    it('an argon2 failure after acquire keeps the slot counted', async () => {
      findUnique.mockResolvedValue({ id: 'u1', passwordHash: STORED_HASH });
      vi.mocked(verifyPassword).mockRejectedValue(new Error('argon2 failed'));
      await expect(
        service.login({ login: 'alice', password: 'x' }),
      ).rejects.toThrow('argon2 failed');
      expect(limiter.size()).toBe(1);
    });

    it('right password of a disabled user: 403 and the counter is reset', async () => {
      findUnique.mockResolvedValue({ id: 'u1', passwordHash: STORED_HASH });
      queryRaw.mockResolvedValue([
        { password_hash: STORED_HASH, disabled_at: new Date() },
      ]);
      for (let i = 0; i < 5; i++) limiter.acquire('alice');
      await expect(
        service.login({ login: 'alice', password: 'x' }),
      ).rejects.toMatchObject({ code: 'user_disabled' });
      expect(limiter.size()).toBe(0);
    });

    it('a wrong password keeps its slot', async () => {
      findUnique.mockResolvedValue({ id: 'u1', passwordHash: STORED_HASH });
      vi.mocked(verifyPassword).mockResolvedValue(false);
      await service.login({ login: 'alice', password: 'x' }).catch(() => {});
      expect(limiter.size()).toBe(1);
    });
  });

  describe('login', () => {
    it('unknown login: dummy hash, no real verification, 401 auth_failed', async () => {
      findUnique.mockResolvedValue(null);
      await expect(
        service.login({ login: 'nobody', password: 'x' }),
      ).rejects.toMatchObject({ code: 'auth_failed' });
      expect(calls).toEqual(['dummy']);
    });

    it('login that violates the format: dummy hash without a database query', async () => {
      await expect(
        service.login({ login: 'not a login!', password: 'x' }),
      ).rejects.toMatchObject({ code: 'auth_failed' });
      expect(findUnique).not.toHaveBeenCalled();
      expect(calls).toEqual(['dummy']);
    });

    it('wrong password: 401 auth_failed, no transaction', async () => {
      findUnique.mockResolvedValue({ id: 'u1', passwordHash: STORED_HASH });
      vi.mocked(verifyPassword).mockResolvedValue(false);
      await expect(
        service.login({ login: 'alice', password: 'x' }),
      ).rejects.toMatchObject({ code: 'auth_failed' });
      expect(verifyPassword).toHaveBeenCalledWith('x', STORED_HASH);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('verifies outside the transaction, then signs in under the row lock', async () => {
      findUnique.mockResolvedValueOnce({ id: 'u1', passwordHash: STORED_HASH });
      findUniqueOrThrow.mockResolvedValue(userRow);
      queryRaw.mockResolvedValue([
        { password_hash: STORED_HASH, disabled_at: null },
      ]);
      const result = await service.login(
        { login: 'Alice', password: 'x' },
        'old-token',
      );
      expect(calls).toEqual(['verify', 'tx']);
      expect(sessionsDestroy).toHaveBeenCalledWith(
        'old-token',
        expect.anything(),
      );
      expect(result.body).toEqual({ user: userRow, csrfToken: 'c' });
    });

    it('password_hash changed under the lock -> 401 auth_failed, previous session kept', async () => {
      findUnique.mockResolvedValueOnce({ id: 'u1', passwordHash: STORED_HASH });
      queryRaw.mockResolvedValue([
        { password_hash: '$argon2id$other', disabled_at: null },
      ]);
      await expect(
        service.login({ login: 'alice', password: 'x' }, 'old-token'),
      ).rejects.toMatchObject({ code: 'auth_failed' });
      expect(sessionsDestroy).not.toHaveBeenCalled();
      expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it('disabled under the lock -> 403 user_disabled', async () => {
      findUnique.mockResolvedValueOnce({ id: 'u1', passwordHash: STORED_HASH });
      queryRaw.mockResolvedValue([
        { password_hash: STORED_HASH, disabled_at: new Date() },
      ]);
      await expect(
        service.login({ login: 'alice', password: 'x' }),
      ).rejects.toMatchObject({ code: 'user_disabled' });
      expect(sessionsCreate).not.toHaveBeenCalled();
    });
  });
});
