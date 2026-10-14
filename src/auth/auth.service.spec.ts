import { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../common/app-error.js';
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
    service = new AuthService(prisma, sessions);
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
