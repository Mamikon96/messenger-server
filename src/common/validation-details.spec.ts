import { z } from 'zod';
import { toValidationDetails } from './validation-details.js';

const issuesOf = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('expected a parse failure');
  return result.error.issues;
};

describe('toValidationDetails', () => {
  it('maps invalid_type to required', () => {
    const issues = issuesOf(z.object({ a: z.string() }), { a: 1 });
    expect(toValidationDetails(issues)).toEqual([
      { field: 'a', code: 'required' },
    ]);
  });

  it('maps too_small, too_big and format issues of strings', () => {
    const schema = z.object({
      a: z.string().min(3),
      b: z.string().max(2),
      c: z.string().regex(/^x$/),
    });
    expect(
      toValidationDetails(issuesOf(schema, { a: 'a', b: 'bbb', c: 'y' })),
    ).toEqual([
      { field: 'a', code: 'too_short' },
      { field: 'b', code: 'too_long' },
      { field: 'c', code: 'invalid_format' },
    ]);
  });

  it('prefers params.code of custom issues', () => {
    const schema = z.object({ a: z.string() }).superRefine((_, ctx) => {
      ctx.addIssue({
        code: 'custom',
        path: ['a'],
        params: { code: 'too_common' },
      });
    });
    expect(toValidationDetails(issuesOf(schema, { a: 'x' }))).toEqual([
      { field: 'a', code: 'too_common' },
    ]);
  });

  it('keeps one code per field (the first issue wins)', () => {
    const schema = z.object({ a: z.string().min(3).regex(/^\d+$/) });
    expect(toValidationDetails(issuesOf(schema, { a: 'x' }))).toEqual([
      { field: 'a', code: 'too_short' },
    ]);
  });

  it('skips issues without a field path (body is not an object)', () => {
    expect(
      toValidationDetails(issuesOf(z.object({ a: z.string() }), [])),
    ).toEqual([]);
  });

  it('skips custom issues without a known code', () => {
    const schema = z.object({ a: z.string() }).superRefine((_, ctx) => {
      ctx.addIssue({ code: 'custom', path: ['a'] });
    });
    expect(toValidationDetails(issuesOf(schema, { a: 'x' }))).toEqual([]);
  });
});
