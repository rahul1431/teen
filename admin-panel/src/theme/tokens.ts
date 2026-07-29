// Design tokens for the admin panel redesign. Single source of truth,
// consumed by antdTheme.ts (ConfigProvider) and any component needing
// a raw value outside antd's token system (e.g. inline sidebar styles).

export const tokens = {
  color: {
    // Brand gold — kept from the existing brand identity, not replaced.
    gold: '#D4AF37',
    goldHover: '#E4C558',
    goldActive: '#B4922A',

    // Warm near-black sidebar surfaces, replacing the flat navy (#001529).
    inkBase: '#14110D',
    inkRaised: '#1D1811',
    inkBorder: '#2A231A',

    // Content-area surfaces.
    bgLayout: '#F7F5F1',
    bgCard: '#FFFFFF',

    // Text on dark (sidebar) surfaces.
    textOnDark: '#EDE9E2',
    textOnDarkMuted: '#8C8579',

    // Semantic status colors, WCAG-AA on both light and dark surfaces.
    success: '#16A34A',
    warning: '#D97706',
    error: '#DC2626',
    info: '#2563EB',

    // Muted body/label text for light (content-area) surfaces — distinct from
    // textOnDarkMuted, which is only contrast-checked against inkBase.
    textMuted: '#6B6558',
  },
  font: {
    family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  radius: {
    base: 10,
    card: 16,
  },
  shadow: {
    card: '0 1px 2px rgba(20, 17, 13, 0.04), 0 8px 24px rgba(20, 17, 13, 0.06)',
    cardHover: '0 4px 8px rgba(20, 17, 13, 0.06), 0 16px 40px rgba(20, 17, 13, 0.10)',
  },
  gradient: {
    // Sidebar surface — subtle vertical depth instead of a flat fill.
    sidebar: 'linear-gradient(180deg, #17140F 0%, #0E0C09 100%)',
  },
  glass: {
    headerBg: 'rgba(255, 255, 255, 0.72)',
    blur: '12px',
  },
} as const
