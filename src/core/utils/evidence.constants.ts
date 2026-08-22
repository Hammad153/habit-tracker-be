export const MAX_IDENTITY_LEVEL = 5;

/** Virtual currency awarded per successful completion, by kind. */
export const COINS_PER_COMPLETION: Record<
  'FULL' | 'MINIMUM' | 'EMERGENCY',
  number
> = {
  FULL: 10,
  MINIMUM: 3,
  EMERGENCY: 2,
};
