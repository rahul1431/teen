import { theme, type ThemeConfig } from 'antd'
import { tokens } from './tokens'

export const antdTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: tokens.color.gold,
    colorSuccess: tokens.color.success,
    colorWarning: tokens.color.warning,
    colorError: tokens.color.error,
    colorInfo: tokens.color.info,
    colorBgLayout: tokens.color.bgLayout,
    colorBgContainer: tokens.color.bgCard,
    fontFamily: tokens.font.family,
    borderRadius: tokens.radius.base,
    borderRadiusLG: tokens.radius.card,
    borderRadiusSM: tokens.radius.sm,
    colorText: tokens.color.textPrimary,
    colorTextSecondary: tokens.color.textSecondary,
    colorTextTertiary: tokens.color.textMuted,
    colorBorder: 'rgba(226, 232, 240, 0.9)',
    colorBorderSecondary: 'rgba(241, 245, 249, 0.9)',
  },
  components: {
    Layout: {
      siderBg: tokens.color.inkBase,
      headerBg: 'transparent',
      bodyBg: tokens.color.bgLayout,
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemColor: tokens.color.textOnDarkMuted,
      darkItemHoverColor: tokens.color.goldHover,
      darkItemHoverBg: 'rgba(255, 255, 255, 0.05)',
      darkItemSelectedBg: 'rgba(212, 175, 55, 0.15)',
      darkItemSelectedColor: tokens.color.gold,
      darkSubMenuItemBg: 'transparent',
      itemMarginInline: 10,
      itemBorderRadius: tokens.radius.base,
      iconSize: 17,
    },
    Card: {
      borderRadiusLG: tokens.radius.card,
      boxShadowTertiary: tokens.shadow.card,
      colorBorderSecondary: 'rgba(226, 232, 240, 0.8)',
    },
    Button: {
      borderRadius: tokens.radius.base,
      fontWeight: 600,
      controlHeight: 38,
      paddingInline: 18,
    },
    Table: {
      borderRadius: tokens.radius.card,
      headerBg: '#F8FAFC',
      headerColor: '#475569',
      rowHoverBg: 'rgba(212, 175, 55, 0.04)',
      borderColor: '#E2E8F0',
    },
    Input: {
      controlHeight: 38,
      borderRadius: tokens.radius.base,
      colorBorder: '#CBD5E1',
    },
    Select: {
      controlHeight: 38,
      borderRadius: tokens.radius.base,
    },
    Tag: {
      borderRadiusSM: tokens.radius.pill,
    },
    Tabs: {
      itemColor: tokens.color.textMuted,
      itemSelectedColor: tokens.color.gold,
      itemHoverColor: tokens.color.goldHover,
      inkBarColor: tokens.color.gold,
      titleFontSize: 14,
    },
    Modal: {
      borderRadiusLG: tokens.radius.card,
    },
    Badge: {
      textFontSize: 11,
    },
  },
}

