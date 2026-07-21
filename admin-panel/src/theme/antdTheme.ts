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
    fontFamily: tokens.font.family,
    borderRadius: tokens.radius.base,
  },
  components: {
    Layout: {
      siderBg: tokens.color.inkBase,
      headerBg: tokens.color.bgCard,
      bodyBg: tokens.color.bgLayout,
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemColor: tokens.color.textOnDark,
      darkItemHoverColor: tokens.color.gold,
      darkItemSelectedBg: tokens.color.goldActive,
      darkItemSelectedColor: tokens.color.inkBase,
      darkSubMenuItemBg: 'transparent',
    },
  },
}
