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
  const userUpdate = vi.fn();
  const revokeOthers = vi.fn();
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
        user: {
          create: userCreate,
          findUnique,
          findUniqueOrThrow,
          update: userUpdate,
        },
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
      revokeOtherSessions: revokeOthers,
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

    it('a hash gate rejection (429) creates no user', async () => {
      findUnique.mockResolvedValue(null);
      vi.mocked(hashPassword).mockRejectedValue(
        new AppError(429, 'rate_limited'),
      );
      await expect(
        service.register({ login: 'alice', password: 'whatever-long-pass' }),
      ).rejects.toMatchObject({ code: 'rate_limited' });
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

    it('a hash gate rejection (429) gives the slot back: the attempt was never checked', async () => {
      findUnique.mockResolvedValue({ id: 'u1', passwordHash: STORED_HASH });
      vi.mocked(verifyPassword).mockRejectedValue(
        new AppError(429, 'rate_limited'),
      );
      await expect(
        service.login({ login: 'alice', password: 'x' }),
      ).rejects.toMatchObject({ code: 'rate_limited' });
      expect(limiter.size()).toBe(0);
    });

    it('a hash gate rejection for an unknown login gives the slot back too', async () => {
      findUnique.mockResolvedValue(null);
      vi.mocked(verifyAgainstDummyHash).mockRejectedValue(
        new AppError(429, 'rate_limited'),
      );
      await expect(
        service.login({ login: 'nobody', password: 'x' }),
      ).rejects.toMatchObject({ code: 'rate_limited' });
      expect(limiter.size()).toBe(0);
    });

    it('a hash gate rejection keeps earlier failed attempts of the login counted', async () => {
      findUnique.mockResolvedValue({ id: 'u1', passwordHash: STORED_HASH });
      for (let i = 0; i < 3; i++) limiter.acquire('alice');
      vi.mocked(verifyPassword).mockRejectedValue(
        new AppError(429, 'rate_limited'),
      );
      await service.login({ login: 'alice', password: 'x' }).catch(() => {});
      for (let i = 0; i < 7; i++) limiter.acquire('alice');
      expect(() => limiter.acquire('alice')).toThrow(AppError);
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

  describe('changePassword', () => {
    const dto = {
      currentPassword: 'current-password',
      newPassword: 'new-password-1234',
    };
    const found = { login: 'alice', passwordHash: STORED_HASH };
    const lock = (hash = STORED_HASH, disabledAt: Date | null = null) =>
      queryRaw.mockResolvedValue([
        { password_hash: hash, disabled_at: disabledAt },
      ]);

    it('verifies, hashes outside the transaction, then writes and revokes the others in it', async () => {
      findUnique.mockResolvedValue(found);
      lock();
      revokeOthers.mockImplementation(() => {
        calls.push('revoke');
        return Promise.resolve(2);
      });
      userUpdate.mockImplementation(() => {
        calls.push('update');
        return Promise.resolve({});
      });
      await service.changePassword('u1', 'tok', dto);
      expect(calls).toEqual(['verify', 'hash', 'tx', 'update', 'revoke']);
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { passwordHash: '$argon2id$new' },
      });
      expect(revokeOthers).toHaveBeenCalledWith('u1', 'tok', expect.anything());
    });

    it('a hash gate rejection (429) on the current password check gives the slot back', async () => {
      findUnique.mockResolvedValue(found);
      vi.mocked(verifyPassword).mockRejectedValue(
        new AppError(429, 'rate_limited'),
      );
      await expect(
        service.changePassword('u1', 'tok', dto),
      ).rejects.toMatchObject({ code: 'rate_limited' });
      expect(limiter.size()).toBe(0);
    });

    it('limited login: 429 before the database query and any argon2 work', async () => {
      for (let i = 0; i < 10; i++) limiter.acquire('alice');
      findUnique.mockResolvedValue(found);
      await expect(
        service.changePassword('u1', 'tok', dto),
      ).rejects.toMatchObject({
        code: 'rate_limited',
      });
      expect(calls).toEqual([]);
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('wrong current password: 401 auth_failed, counted in the login counter, nothing written', async () => {
      findUnique.mockResolvedValue(found);
      vi.mocked(verifyPassword).mockResolvedValue(false);
      for (let i = 0; i < 10; i++) {
        await expect(
          service.changePassword('u1', 'tok', dto),
        ).rejects.toMatchObject({ code: 'auth_failed' });
      }
      await expect(
        service.changePassword('u1', 'tok', dto),
      ).rejects.toMatchObject({
        code: 'rate_limited',
      });
      expect(hashPassword).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it('a correct current password resets the counter', async () => {
      findUnique.mockResolvedValue(found);
      lock();
      limiter.acquire('alice');
      limiter.acquire('alice');
      await service.changePassword('u1', 'tok', dto);
      expect(limiter.size()).toBe(0);
    });

    it('password_hash changed under the lock: 401 auth_failed, nothing written or revoked', async () => {
      findUnique.mockResolvedValue(found);
      lock('$argon2id$other');
      await expect(
        service.changePassword('u1', 'tok', dto),
      ).rejects.toMatchObject({
        code: 'auth_failed',
      });
      expect(userUpdate).not.toHaveBeenCalled();
      expect(revokeOthers).not.toHaveBeenCalled();
    });

    it('disabled under the lock or the user is gone: 401 unauthorized, nothing written', async () => {
      findUnique.mockResolvedValue(found);
      lock(STORED_HASH, new Date());
      await expect(
        service.changePassword('u1', 'tok', dto),
      ).rejects.toMatchObject({
        code: 'unauthorized',
      });
      findUnique.mockResolvedValue(null);
      await expect(
        service.changePassword('u1', 'tok', dto),
      ).rejects.toMatchObject({
        code: 'unauthorized',
      });
      expect(userUpdate).not.toHaveBeenCalled();
      expect(revokeOthers).not.toHaveBeenCalled();
    });
  });
});
