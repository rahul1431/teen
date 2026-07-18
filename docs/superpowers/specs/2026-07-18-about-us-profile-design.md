# About Us section in Profile — Design

## Goal
Add an "About Us" entry to the mobile app's Profile page where a user can see their currently installed app version, whether a newer version is available, and update the app if so.

## Background
The app already has a full update pipeline:
- Backend endpoint `GET /api/app/version` returns `{ version_code, version_name, force_update, release_notes, download_url }`.
- `mobile/lib/core/update/update_service.dart` (`UpdateService.checkAndPrompt`) calls this endpoint once after login and shows a private `_UpdateDialog` that downloads the APK via Dio and hands off to the system installer via `open_file`.

There is no existing "About Us" or version-info screen. There are no existing Terms of Service / Privacy Policy pages or URLs in the app (only a text mention on the registration screen, no link), and no in-app "About" contact block — WhatsApp/email contact already lives on `SupportPage`.

## Scope
In scope:
- A new About Us page reachable from Profile → About section.
- Shows: app name, installed version, latest-available version (auto-checked on page open), an "Update Now" flow when outdated, a link to Support, and a footer copyright line.

Out of scope (explicitly deferred, no real content exists yet):
- Terms of Service / Privacy Policy links — no real pages/URLs exist today.
- Duplicating WhatsApp/email contact details inline — About Us links to the existing Support page instead.

## Components

### 1. `mobile/lib/features/profile/about_us_page.dart` (new)
A `StatefulWidget` matching existing sub-page conventions (see `support_page.dart`, `kyc_page.dart`).

State on `initState`:
- Load `PackageInfo.fromPlatform()` for the locally installed `version` + `buildNumber` — always available, no network needed.
- Call `GET {AppConfig.apiBaseUrl}/api/app/version` (same call `UpdateService` makes) to determine the latest available version. Tracks `_checking`, `_checkError`, and the parsed server response.

Layout (top to bottom, matching the `ListView` + card style used elsewhere in profile/support pages):
1. Header card — app icon/glyph, `AppConfig.appName`, short tagline.
2. "Version" card — installed version, formatted as `v{version} ({buildNumber})`.
3. "Latest Version" card, one of four states:
   - Checking: spinner + "Checking for updates…"
   - Error (e.g. offline): "Couldn't check for updates" + Retry button (re-runs the check)
   - Up to date (`serverCode <= localCode`): green check icon + "You're up to date"
   - Outdated: "Version {version_name} available" + `release_notes` preview (if present) + "Update Now" button
4. Menu card — single "Contact Support" row (support icon) that pushes the existing `SupportPage`.
5. Footer — small centered gray text: "© 2026 MyOnlineJoker. All rights reserved."

"Update Now" behavior: rather than reimplementing APK download/install, it opens the same dialog `UpdateService` already uses (see below), passing through `version_name`, `release_notes`, `force_update` (always `false` from this entry point — force-update is only asserted by the login-time prompt), and `download_url`.

### 2. `mobile/lib/core/update/update_service.dart` (edit)
Rename the private `_UpdateDialog` / `_UpdateDialogState` classes to public `UpdateDialog` / `UpdateDialogState`. No behavior change — purely making the class importable so `about_us_page.dart` can reuse the existing download/install flow instead of duplicating it. `UpdateService.checkAndPrompt` updates its reference accordingly.

### 3. `mobile/lib/features/profile/profile_page.dart` (edit)
Add a new section between "Preferences" and the referral card:
```
_sectionLabel('About')
_menuCard([
  _menuItem(Icons.info_outline_rounded, 'About Us',
      subtitle: 'Version, updates & more',
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AboutUsPage()))),
])
```

## Data flow
1. About Us page opens → reads `PackageInfo` locally (instant) → fires `GET /api/app/version` (same request shape as `UpdateService`).
2. Response compared against local `buildNumber` the same way `UpdateService` does (`serverCode <= localCode` ⇒ up to date).
3. If outdated and user taps "Update Now" → `UpdateDialog` is shown, reusing the existing Dio download + `open_file` install flow already proven in `UpdateService`.

## Error handling
- Network failure while checking → show inline "Couldn't check for updates" + Retry, not a blocking error state (matches `UpdateService`'s silent-skip-and-retry-next-launch philosophy, but visible here since the user explicitly opened this page).
- No change to `force_update` semantics — that gating stays owned by the post-login `checkAndPrompt` flow; the About Us page only offers a voluntary update.

## Testing
- Manual verification on device/emulator: open Profile → About Us with app up to date (green check shown), and with a lower `version_code` seeded on the backend (outdated state shown, Update Now opens the download dialog and completes an install).
- No automated test suite currently covers `update_service.dart` or profile sub-pages; this follows existing project convention of manual verification for UI flows (see the `verify`/`run` skills already used in this repo).
