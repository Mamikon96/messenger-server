import { AppError } from '../../common/app-error.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { loginSchema, registerSchema } from './credentials.dto.js';

const GOOD = 'correct horse battery';

function run(schema: typeof registerSchema, body: unknown) {
  const pipe = new ZodValidationPipe(schema, { details: true });
  try {
    pipe.transform(body);
  } catch (error) {
    return (error as AppError).getResponse() as {
      error: { message: string; details?: unknown };
    };
  }
  throw new Error('expected a validation error');
}

describe('registerSchema details', () => {
  it.each([
    ['missing login', { password: GOOD }, [['login', 'required']]],
    ['blank login', { login: '  ', password: GOOD }, [['login', 'required']]],
    ['numeric login', { login: 5, password: GOOD }, [['login', 'required']]],
    [
      'null password',
      { login: 'alice', password: null },
      [['password', 'required']],
    ],
    [
      'empty password',
      { login: 'alice', password: '' },
      [['password', 'required']],
    ],
    [
      'login format',
      { login: 'al ice', password: GOOD },
      [['login', 'invalid_format']],
    ],
    [
      'login too short',
      { login: 'ab', password: GOOD },
      [['login', 'invalid_format']],
    ],
    [
      'login too long',
      { login: 'a'.repeat(33), password: GOOD },
      [['login', 'too_long']],
    ],
    [
      'password too short',
      { login: 'alice', password: 'short' },
      [['password', 'too_short']],
    ],
    [
      'password too long',
      { login: 'alice', password: 'x'.repeat(257) },
      [['password', 'too_long']],
    ],
    [
      'common password',
      { login: 'alice', password: 'Password1234' },
      [['password', 'too_common']],
    ],
    [
      'empty object',
      {},
      [
        ['login', 'required'],
        ['password', 'required'],
      ],
    ],
    [
      'empty body',
      undefined,
      [
        ['login', 'required'],
        ['password', 'required'],
      ],
    ],
    [
      'both fields invalid, one code each',
      { login: 'a b', password: 'x' },
      [
        ['login', 'invalid_format'],
        ['password', 'too_short'],
      ],
    ],
  ] as const)('%s', (_name, body, expected) => {
    const { error } = run(registerSchema, body);
    expect(error.details).toEqual(
      expected.map(([field, code]) => ({ field, code })),
    );
  });

  it.each([
    ['array', []],
    ['string', 'x'],
    ['number', 5],
    ['null', null],
  ])('no details for a non-object body: %s', (_name, body) => {
    expect(run(registerSchema, body).error.details).toBeUndefined();
  });

  it('keeps message human-readable', () => {
    const { error } = run(registerSchema, { login: 'a b', password: GOOD });
    expect(error.message).not.toMatch(/^\w+: \w+$/);
    expect(error.message).toContain('login');
  });
});

describe('loginSchema details', () => {
  it.each([
    ['missing password', { login: 'alice' }, [['password', 'required']]],
    [
      'empty password',
      { login: 'alice', password: '' },
      [['password', 'required']],
    ],
    ['blank login', { login: '  ', password: 'x' }, [['login', 'required']]],
    ['numeric login', { login: 5, password: 'x' }, [['login', 'required']]],
    [
      'array password',
      { login: 'alice', password: ['x'] },
      [['password', 'required']],
    ],
    [
      'empty object',
      {},
      [
        ['login', 'required'],
        ['password', 'required'],
      ],
    ],
    [
      'empty body',
      undefined,
      [
        ['login', 'required'],
        ['password', 'required'],
      ],
    ],
  ] as const)('%s', (_name, body, expected) => {
    expect(run(loginSchema, body).error.details).toEqual(
      expected.map(([field, code]) => ({ field, code })),
    );
  });

  it.each([[[]], ['x'], [5], [null]])(
    'no details for non-object body %j',
    (body) => {
      expect(run(loginSchema, body).error.details).toBeUndefined();
    },
  );
});
