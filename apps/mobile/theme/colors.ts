/**
 * Qmail palette, mirroring apps/web/src/styles/tokens.css exactly.
 *
 * One dominant colour, one accent, one neutral, plus two state colours used
 * only for signature verification results.
 */
export const colors = {
  ink: '#0B1120',
  inkRaised: '#121A2C',
  inkLine: '#1E293B',

  accent: '#3FB9AE',
  accentQuiet: 'rgba(63, 185, 174, 0.16)',

  paper: '#F7F5F0',
  paperDim: '#D8D5CD',
  paperFaint: '#8B8A85',

  stateVerified: '#4F9D72',
  stateFailed: '#B4544C',
} as const;

export const space = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 24,
  s6: 32,
  s7: 48,
  s8: 64,
} as const;

export const radius = {
  base: 6,
  lg: 10,
} as const;
