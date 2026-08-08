// Design tokens for the admin panel redesign. Single source of truth,
// consumed by antdTheme.ts (ConfigProvider) and any component needing
// a raw value outside antd's token system.

export const tokens = {
  color: {
    // Brand gold & luxury accents
    gold: '#D4AF37',
    goldHover: '#E5C158',
    goldActive: '#B39127',
    goldGlow: 'rgba(212, 175, 55, 0.25)',
    emerald: '#10B981',
    emeraldGlow: 'rgba(16, 185, 129, 0.20)',
    indigo: '#6366F1',
    indigoGlow: 'rgba(99, 102, 241, 0.20)',
    amber: '#F59E0B',
    amberGlow: 'rgba(245, 158, 11, 0.20)',
    crimson: '#EF4444',
    crimsonGlow: 'rgba(239, 68, 68, 0.20)',

    // Warm obsidian sidebar surfaces
    inkBase: '#0F1117',
    inkRaised: '#181B24',
    inkBorder: '#262A36',
    inkHover: '#202430',

    // Content-area surfaces
    bgLayout: '#F4F6FB',
    bgCard: '#FFFFFF',
    bgCardSubtle: '#F8FAFC',

    // Text on dark (sidebar/dark theme) surfaces
    textOnDark: '#F1F5F9',
    textOnDarkMuted: '#94A3B8',

    // Semantic status colors
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',

    // Muted body/label text for light surfaces
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#64748B',
    borderLight: 'rgba(226, 232, 240, 0.8)',
  },
  font: {
    family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  radius: {
    sm: 6,
    base: 10,
    card: 16,
    pill: 9999,
  },
  shadow: {
    sm: '0 1px 3px rgba(15, 23, 42, 0.05)',
    card: '0 1px 3px rgba(15, 23, 42, 0.04), 0 10px 28px rgba(15, 23, 42, 0.06)',
    cardHover: '0 4px 12px rgba(15, 23, 42, 0.08), 0 18px 42px rgba(15, 23, 42, 0.12)',
    gold: '0 4px 20px rgba(212, 175, 55, 0.30)',
  },
  gradient: {
    sidebar: 'linear-gradient(180deg, #111319 0%, #0A0C10 100%)',
    goldButton: 'linear-gradient(135deg, #E5C158 0%, #D4AF37 50%, #B39127 100%)',
    cardHeader: 'linear-gradient(135deg, rgba(212, 175, 55, 0.08) 0%, rgba(99, 102, 241, 0.04) 100%)',
    glassHeader: 'linear-gradient(180deg, rgba(255, 255, 255, 0.90) 0%, rgba(255, 255, 255, 0.75) 100%)',
  },
  glass: {
    headerBg: 'rgba(255, 255, 255, 0.82)',
    blur: '16px',
  },
} as const

