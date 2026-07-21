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
  },
  font: {
    family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  radius: {
    base: 10,
  },
} as const
