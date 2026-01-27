// Lumenless design tokens
export const colors = {
  bg: '#08080c',
  bgElevated: '#0e0e12',
  surface: '#141418',
  surfaceHover: '#1a1a1f',
  border: 'rgba(255, 255, 255, 0.06)',
  borderLight: 'rgba(255, 255, 255, 0.1)',
  text: '#fafafa',
  textSecondary: '#a1a1aa',
  textMuted: '#71717a',
  accent: '#8b5cf6',
  accentDim: 'rgba(139, 92, 246, 0.15)',
  accentGlow: 'rgba(139, 92, 246, 0.25)',
  success: '#22c55e',
  successDim: 'rgba(34, 197, 94, 0.15)',
  error: '#ef4444',
  errorDim: 'rgba(239, 68, 68, 0.15)',
  overlay: 'rgba(0, 0, 0, 0.75)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  full: 9999,
};

export const typography = {
  title: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, fontWeight: '500' as const },
  body: { fontSize: 15, fontWeight: '500' as const },
  caption: { fontSize: 13, fontWeight: '500' as const },
  mono: { fontSize: 14, fontWeight: '600' as const },
  button: { fontSize: 15, fontWeight: '600' as const },
};
