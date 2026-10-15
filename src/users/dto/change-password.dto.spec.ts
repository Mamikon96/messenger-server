import { toValidationDetails } from '../../common/validation-details.js';
import { changePasswordSchema } from './change-password.dto.js';

const OLD = 'old-password-1234';
const NEW = 'correct horse battery';
const parse = (value: unknown) => changePasswordSchema.safeParse(value);
const detailsOf = (value: unknown) => {
  const result = parse(value);
  if (result.success) throw new Error('expected a failure');
  return toValidationDetails(result.error.issues);
};

describe('changePasswordSchema', () => {
  it('accepts valid values and keeps them as is (no trim, no normalization)', () => {
    expect(
      parse({ currentPassword: ` ${OLD} `, newPassword: ` ${NEW} ` }).data,
    ).toEqual({ currentPassword: ` ${OLD} `, newPassword: ` ${NEW} ` });
  });

  it('applies the password policy to newPassword only', () => {
    const cases: [string, string][] = [
      ['', 'required'],
      ['short', 'too_short'],
      ['x'.repeat(257), 'too_long'],
      ['password1234', 'too_common'],
    ];
    for (const [newPassword, code] of cases) {
      expect(detailsOf({ currentPassword: OLD, newPassword })).toEqual([
        { field: 'newPassword', code },
      ]);
    }
  });

  it('currentPassword is only non-empty: no length, blocklist or trim rules', () => {
    for (const currentPassword of ['x', 'password', '   ', 'y'.repeat(5000)]) {
      expect(parse({ currentPassword, newPassword: NEW }).success).toBe(true);
    }
    expect(detailsOf({ currentPassword: '', newPassword: NEW })).toEqual([
      { field: 'currentPassword', code: 'required' },
    ]);
  });

  it('a field of the wrong type is required; both fields are reported together', () => {
    expect(detailsOf({ currentPassword: 5, newPassword: null })).toEqual([
      { field: 'currentPassword', code: 'required' },
      { field: 'newPassword', code: 'required' },
    ]);
    expect(detailsOf({ currentPassword: OLD, newPassword: ['a'] })).toEqual([
      { field: 'newPassword', code: 'required' },
    ]);
    expect(detailsOf({ currentPassword: '', newPassword: 'short' })).toEqual([
      { field: 'currentPassword', code: 'required' },
      { field: 'newPassword', code: 'too_short' },
    ]);
  });

  it('an absent body counts as {}: both fields are required', () => {
    for (const value of [undefined, {}]) {
      expect(detailsOf(value)).toEqual([
        { field: 'currentPassword', code: 'required' },
        { field: 'newPassword', code: 'required' },
      ]);
    }
  });

  it('an unknown key with valid fields is an error without details', () => {
    const bodies = [
      { currentPassword: OLD, newPassword: NEW, foo: 1 },
      JSON.parse(
        `{"currentPassword":"${OLD}","newPassword":"${NEW}","__proto__":1}`,
      ),
    ];
    for (const body of bodies) {
      const result = parse(body);
      expect(result.success).toBe(false);
      expect(
        result.success ? [] : toValidationDetails(result.error.issues),
      ).toEqual([]);
    }
  });

  it('an unknown key next to an invalid known field: details only for the known field', () => {
    expect(
      detailsOf({ currentPassword: OLD, newPassword: 'short', foo: 1 }),
    ).toEqual([{ field: 'newPassword', code: 'too_short' }]);
  });

  it('a body that is not an object gives no details', () => {
    for (const value of [null, [], 'text', 5, true]) {
      const result = parse(value);
      expect(result.success).toBe(false);
      expect(
        result.success ? [] : toValidationDetails(result.error.issues),
      ).toEqual([]);
    }
  });
});
