# Admin Panel UI/UX Redesign — Design Spec

**Date:** 2026-07-21
**Status:** Approved (design), pending implementation plan

## Context

The admin panel (`admin-panel/`) is a React + Vite app built on Ant Design v5 (`antd` + `@ant-design/pro-components`), with ~35 pages under `src/pages`. The visual identity is a dark sidebar with a gold accent (`#d4af37`), reflecting the "MyOnlineJoker" casino/gaming brand. The panel has grown organically: styling is largely default-antd with per-page inline styles, menu labels mix emoji and antd icons, and there's no shared design-token layer.

Several features served by this panel are under prior explicit lockdowns (no code changes without re-authorization): Teen Patti, Ludo, Aviator, Lottery, App Update, KYC, Player Tracking, App Monitor. The user has explicitly re-authorized this work as **visual/styling-only** — no behavior, logic, data-fetching, or route changes to any page, locked or not.

## Goal

Redesign the entire admin panel's visual language — layout, navigation, typography, color, and component styling — across all pages and the sidebar menu/submenu structure, while keeping:
- The existing Ant Design component library (no migration to shadcn/Tailwind).
- The dark + gold "casino premium" brand identity (evolved, not replaced).
- All existing functionality, routes, and data flows completely unchanged.

## Non-Goals

- No component library migration.
- No changes to business logic, API calls, permissions, or route paths.
- No changes to backend services.
- Not a single atomic delivery — this spec covers the full scope, but implementation is phased (see Delivery Phasing).

## Design

### 1. Theme Token Foundation

Introduce a central Ant Design v5 `ConfigProvider` theme (`admin-panel/src/theme.ts` or similar) defining:

- **Color tokens**: dark base shifted from flat navy (`#001529`) toward a warmer near-black (Premium Dark + Gold palette family, e.g. `#1C1917`-range), gold accent retained and contrast-tuned from `#d4af37` (WCAG-checked against both dark and light surfaces), plus semantic tokens (success/warning/error/info) reused consistently instead of per-page raw hex.
- **Typography**: Inter (heading + body), replacing antd's default font stack — chosen for legibility at small sizes and tabular-number rendering across the panel's many stat/table-heavy pages.
- **Density**: tighter spacing/radius scale suited to dense tables and stat cards.
- **Elevation**: subtle shadow/border tokens to separate cards/tables from page background, replacing flat panels.

This token layer is consumed globally via `ConfigProvider`, so every page inherits it without per-page rewrites.

### 2. Shell Redesign (`Layout.tsx`)

- Sidebar: reskin with the new tokens; improve active/hover state clarity.
- Header: polish spacing/alignment of the notification bell and avatar/profile dropdown.
- Replace emoji-based menu icons (👥 🛡️ 🤖 🃏 🎲 ✈️ 🎯 🎰 🏏 📣 🏷️ 🖼️ 🎁 📄 📋) with consistent Ant Design SVG icons, matching the existing icon-based items.
- Mobile drawer (existing `lg` breakpoint swap) keeps its current responsive behavior, reskinned only.

### 3. Navigation / IA Restructure

Current: 3 grouped submenus (User Management, Games, Marketing & CMS) + ~15 flat top-level items.

New grouping (menu labels/order only — **no route changes**):

- Dashboard (flat)
- User Management: Players, Admin Users, Bot Profiles *(unchanged)*
- Games: Teen Patti, Ludo, Aviator, Satta Matka, Lottery, Cricket *(unchanged)*
- Marketing & CMS: SEO & Campaigns, Promo Codes, Home Banners, Daily Bonus, CMS Management *(unchanged)*
- **Operations** *(new group)*: Finance, Risk Center, Security, KYC Verification
- **Engagement** *(new group)*: Notifications, Leaderboard, Support Center
- **Platform** *(new group)*: AI Control Center, App Update, Website Settings, Analytics, Agents, Tasks, Changelog

All existing route paths (`/admin/...`) stay identical; this only changes which `Menu` group each item's label renders under.

### 4. Shared Component Patterns

Standardize recurring UI using the new tokens, applied as pages are redesigned in their batch:
- Stat/KPI cards (Dashboard, Analytics, AI Control Center, Finance)
- Table toolbars (search/filter/export bars)
- Status/badge tags (semantic color tokens, not raw hex)
- Empty/loading states

### 5. Delivery Phasing

Implementation proceeds in reviewable batches, each independently verifiable before the next starts:

1. **Foundation + Shell**: theme tokens (`theme.ts`, `ConfigProvider`), `Layout.tsx` (sidebar/header/nav restructure/icons).
2. **Dashboard + Analytics**
3. **User Management**: Users, AdminUsers, Bots
4. **Games group**: 6 game admin pages (`src/pages/games/*`)
5. **Marketing & CMS group**: Marketing, PromoCodes, Banners, DailyBonus, CMSManagement
6. **Operations group**: Finance, RiskCenter, Security, KYC
7. **Engagement group**: Notifications, NotificationsHistory, Leaderboard, Support
8. **Platform group**: AIControlCenter (incl. Player Tracking / App Monitor tabs), AppUpdate, WebsiteSettings, Agents, Tasks, Changelog, MetricsDashboard, PlayerAnomaliesPage
9. **Auth/standalone**: Login, AgentLogin, AgentPortal, Profile

### 6. Verification Approach

Per batch: run the dev server, walk each page in-browser at 375/768/1024/1440px, check color contrast (WCAG AA), confirm zero functional/behavioral regressions (all data fetching, forms, mutations, and permissions identical to before — visual-only diff), screenshot before/after for user review.

## Risks / Open Questions

- Antd v5 `ConfigProvider` token overrides don't cover every visual detail some pages may use inline `style={{...}}` overrides that bypass tokens — these will need spot-fixing per page during that page's batch, not the foundation phase.
- Locked-feature pages (Teen Patti/Ludo/Aviator/Lottery under Games; App Update; KYC; Player Tracking/App Monitor tabs in AI Control Center) are in scope for this visual pass only, per explicit user re-authorization in this spec — any future *functional* change to those areas still requires separate re-authorization.
