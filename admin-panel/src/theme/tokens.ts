// Design tokens for the admin panel with a Light, Rich, and Luxurious color palette.

export const tokens = {
  color: {
    // Rich Royal Gold & Amber accents
    gold: '#D97706',
    goldHover: '#F59E0B',
    goldActive: '#B45309',
    goldGlow: 'rgba(217, 119, 6, 0.20)',
    goldLight: '#FEF3C7',

    // Rich Jewel Tones
    emerald: '#059669',
    emeraldHover: '#10B981',
    emeraldLight: '#D1FAE5',
    emeraldGlow: 'rgba(5, 150, 105, 0.18)',

    sapphire: '#2563EB',
    sapphireHover: '#3B82F6',
    sapphireLight: '#DBEAFE',
    sapphireGlow: 'rgba(37, 99, 235, 0.18)',

    indigo: '#4F46E5',
    indigoGlow: 'rgba(79, 70, 229, 0.18)',

    amber: '#D97706',
    amberGlow: 'rgba(217, 119, 6, 0.18)',

    crimson: '#E11D48',
    crimsonGlow: 'rgba(225, 29, 72, 0.18)',

    violet: '#7C3AED',
    violetHover: '#8B5CF6',
    violetLight: '#EDE9FE',
    violetGlow: 'rgba(124, 58, 237, 0.18)',

    rose: '#E11D48',
    roseHover: '#F43F5E',
    roseLight: '#FFE4E6',
    roseGlow: 'rgba(225, 29, 72, 0.18)',

    cyan: '#0891B2',
    cyanHover: '#06B6D4',
    cyanLight: '#CFFAFE',

    // Sidebar & Shell Surfaces
    sidebarBase: '#0F172A',
    sidebarRaised: '#1E293B',
    sidebarBorder: '#334155',
    sidebarHover: '#1E293B',

    inkBase: '#0F172A',
    inkRaised: '#1E293B',
    inkBorder: '#334155',
    inkHover: '#1E293B',

    // Light Content-Area Surfaces
    bgLayout: '#F8FAFC',
    bgCard: '#FFFFFF',
    bgCardSubtle: '#F1F5F9',
    bgCardMuted: '#F8FAFC',

    // Text on dark (sidebar)
    textOnDark: '#F8FAFC',
    textOnDarkMuted: '#94A3B8',

    // Rich Text on light surfaces
    textPrimary: '#0F172A',
    textSecondary: '#334155',
    textMuted: '#64748B',
    textDisabled: '#94A3B8',

    // Semantic Status Colors
    success: '#059669',
    warning: '#D97706',
    error: '#E11D48',
    info: '#2563EB',

    // Borders & Dividers
    borderLight: '#E2E8F0',
    borderSubtle: '#F1F5F9',
    borderStrong: '#CBD5E1',
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
    sm: '0 1px 3px rgba(15, 23, 42, 0.06)',
    card: '0 1px 3px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.05)',
    cardHover: '0 4px 12px rgba(15, 23, 42, 0.08), 0 16px 36px rgba(15, 23, 42, 0.08)',
    gold: '0 4px 18px rgba(217, 119, 6, 0.28)',
    emerald: '0 4px 18px rgba(5, 150, 105, 0.25)',
  },
  gradient: {
    sidebar: 'linear-gradient(180deg, #0F172A 0%, #090D16 100%)',
    goldButton: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
    emeraldButton: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
    cardHeader: 'linear-gradient(135deg, rgba(217, 119, 6, 0.05) 0%, rgba(37, 99, 235, 0.03) 100%)',
    glassHeader: 'linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.85) 100%)',
  },
  glass: {
    headerBg: 'rgba(255, 255, 255, 0.88)',
    blur: '16px',
  },
} as const
