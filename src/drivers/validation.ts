import { ConfigurationError } from '../errors/index.js';

export const parsePositiveSafeIntegerOrDefault = (
  value: number | undefined,
  defaultValue: number,
  optionName: string,
): number => {
  const resolved = value ?? defaultValue;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new ConfigurationError(
      `${optionName} must be a positive safe integer.`,
    );
  }
  return resolved;
};
