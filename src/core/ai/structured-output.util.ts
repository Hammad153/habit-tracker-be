import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { ClassConstructor } from 'class-transformer';

/**
 * Shared helpers for structured AI output contracts (Phase 3.3/3.4).
 * Models wrap JSON in prose or fences; these tolerate that reality.
 */

export const extractOuterJson = (text: string): string => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return text;
  return text.slice(start, end + 1);
};

/** Parse + schema-validate; throws on anything malformed or hostile. */
export const parseValidatedJson = <T extends object>(
  rawText: string,
  dtoClass: ClassConstructor<T>,
): T => {
  let candidate: unknown;
  try {
    candidate = JSON.parse(extractOuterJson(rawText));
  } catch {
    throw new Error('malformed JSON');
  }
  const dto = plainToInstance(dtoClass, candidate, { exposeUnsetFields: false });
  const errors = validateSync(dto, { whitelist: true });
  if (errors.length > 0) throw new Error('schema violation');
  return dto;
};
