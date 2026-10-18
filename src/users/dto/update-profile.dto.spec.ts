import { toValidationDetails } from '../../common/validation-details.js';
import { updateProfileSchema } from './update-profile.dto.js';

const parse = (value: unknown) => updateProfileSchema.safeParse(value);
const detailsOf = (value: unknown) => {
  const result = parse(value);
  if (result.success) throw new Error('expected a failure');
  return toValidationDetails(result.error.issues);
};

describe('updateProfileSchema', () => {
  it('trims both fields and keeps absent ones absent', () => {
    expect(parse({ firstName: ' A ', lastName: ' B ' }).data).toEqual({
      firstName: 'A',
      lastName: 'B',
    });
    expect(parse({ lastName: '  ' }).data).toEqual({ lastName: '' });
    expect(parse({ firstName: 'A' }).data).toEqual({ firstName: 'A' });
  });

  it('counts the length in code points after trim', () => {
    expect(parse({ firstName: '😀'.repeat(64) }).success).toBe(true);
    expect(detailsOf({ firstName: '😀'.repeat(65) })).toEqual([
      { field: 'firstName', code: 'too_long' },
    ]);
  });

  it('gives invalid_format for control, separator, bidi override and lone surrogate characters', () => {
    for (const bad of ['a\u0000b', 'a\nb', 'a b', 'a‮b', 'a\ud800b']) {
      expect(detailsOf({ firstName: bad })).toEqual([
        { field: 'firstName', code: 'invalid_format' },
      ]);
      expect(detailsOf({ lastName: bad })).toEqual([
        { field: 'lastName', code: 'invalid_format' },
      ]);
    }
    expect(parse({ firstName: 'Анна 😀', lastName: 'שלום' }).success).toBe(
      true,
    );
  });

  it('checks the trimmed value: a separator at the edge is trimmed, not rejected', () => {
    expect(parse({ firstName: ' A ' }).data).toEqual({
      firstName: 'A',
    });
  });

  it('prefers required and too_long over invalid_format per field', () => {
    expect(detailsOf({ firstName: 'a\u0000'.repeat(40) })).toEqual([
      { field: 'firstName', code: 'too_long' },
    ]);
    expect(detailsOf({ firstName: 5, lastName: 'a\u0000b' })).toEqual([
      { field: 'firstName', code: 'required' },
      { field: 'lastName', code: 'invalid_format' },
    ]);
  });

  it('wrong type, empty or blank firstName is required; lastName is required only for the wrong type', () => {
    expect(detailsOf({ firstName: 5, lastName: null })).toEqual([
      { field: 'firstName', code: 'required' },
      { field: 'lastName', code: 'required' },
    ]);
    expect(detailsOf({ firstName: '   ' })).toEqual([
      { field: 'firstName', code: 'required' },
    ]);
    expect(parse({ lastName: '' }).success).toBe(true);
  });

  it('gives no details for no fields, unknown fields only or a non-object body', () => {
    for (const value of [{}, undefined, { foo: 1 }, { firstName: 'A', x: 1 }]) {
      const result = parse(value);
      expect(result.success).toBe(false);
      expect(detailsOf(value)).toEqual([]);
    }
    for (const value of [[], 'x', 5, null]) {
      expect(detailsOf(value)).toEqual([]);
    }
  });

  it('treats an own __proto__ key (from JSON.parse) as an unknown field', () => {
    for (const raw of [
      '{"firstName":"A","__proto__":{}}',
      '{"__proto__":{"firstName":"A"}}',
    ]) {
      const value: unknown = JSON.parse(raw);
      expect(parse(value).success).toBe(false);
      expect(detailsOf(value)).toEqual([]);
    }
  });

  it('reports only known fields when an unknown one is present too', () => {
    expect(detailsOf({ firstName: '', foo: 1 })).toEqual([
      { field: 'firstName', code: 'required' },
    ]);
  });
});
