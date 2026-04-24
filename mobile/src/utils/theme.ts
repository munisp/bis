/**
 * BIS Mobile Design Tokens
 * Centralised colour palette, typography scale, and spacing system.
 */

export const colors = {
  // Backgrounds
  background: '#0f172a',
  backgroundSecondary: '#1e293b',
  card: '#1e293b',
  cardHover: '#263548',

  // Borders
  border: '#334155',
  borderLight: '#475569',

  // Text
  text: '#f8fafc',
  textSecondary: '#cbd5e1',
  textMuted: '#64748b',

  // Brand
  primary: '#3b82f6',
  primaryDark: '#2563eb',
  primaryLight: '#60a5fa',

  // Semantic
  success: '#22c55e',
  warning: '#eab308',
  error: '#ef4444',
  info: '#06b6d4',

  // Severity
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',

  // Status
  open: '#3b82f6',
  pending: '#eab308',
  resolved: '#22c55e',
  closed: '#64748b',
};

export const typography = {
  h1: {
    fontSize: 28,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 22,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
  },
  h3: {
    fontSize: 18,
    fontWeight: '600' as const,
  },
  h4: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  body: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '500' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  mono: {
    fontSize: 12,
    fontFamily: 'Courier',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
};

export const shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
};
