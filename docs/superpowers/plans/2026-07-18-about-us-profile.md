# About Us Section in Profile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "About Us" page reachable from the mobile app's Profile screen, showing the installed app version, an auto-checked latest-available version with an update flow, and a link to Support.

**Architecture:** A new `AboutUsPage` StatefulWidget reads `PackageInfo` locally and calls the existing `GET /api/app/version` backend endpoint (same one `UpdateService` already uses) to determine update status. When an update is available, it reuses the existing APK download/install dialog from `update_service.dart` (made public) instead of duplicating that logic. `ProfilePage` gets one new menu entry linking to it.

**Tech Stack:** Flutter/Dart, `dio` (HTTP), `package_info_plus` (installed version), existing `AppColors`/`AppSnackBar` theme helpers from `mobile/lib/shared/theme/app_theme.dart`.

## Global Constraints

- No backend changes — `GET {AppConfig.apiBaseUrl}/api/app/version` already returns `{ version_code, version_name, force_update, release_notes, download_url }` and must not be modified.
- No Terms of Service / Privacy Policy links — none exist yet, out of scope per spec.
- No duplicated WhatsApp/email contact details — link to the existing `SupportPage` instead.
- Follow existing UI conventions: `ListView` + card layout, `AppColors.cardBg`/`AppColors.border`/`AppColors.gold`/`AppColors.textSecondary`, as used in `support_page.dart` and `profile_page.dart`.
- This codebase has no automated test suite for Flutter UI pages or `update_service.dart` — verification is manual, matching existing project convention (see `support_page.dart`, `kyc_page.dart` — no matching `_test.dart` files).

---

### Task 1: Make `UpdateDialog` reusable (public) in `update_service.dart`

**Files:**
- Modify: `mobile/lib/core/update/update_service.dart`

**Interfaces:**
- Produces: `UpdateDialog` (public widget, was `_UpdateDialog`) with constructor `UpdateDialog({required String serverName, required String? notes, required bool forceUpdate, required String downloadUrl})` — same fields as before, just renamed and exported for use by `about_us_page.dart` in Task 2.
- Produces: `UpdateDialogState` (public State class, was `_UpdateDialogState`) — no external consumers need this directly, but it must be public since it's the State type for a public StatefulWidget.

This task is a pure rename — no behavior change. `UpdateService.checkAndPrompt` is the only existing caller and must keep working identically.

- [ ] **Step 1: Rename the classes and update the internal reference**

In `mobile/lib/core/update/update_service.dart`:

1. Change the `showDialog` builder inside `checkAndPrompt` from:
```dart
          builder: (ctx) => PopScope(
            canPop: !forceUpdate,
            child: _UpdateDialog(
              serverName: serverName,
              notes: notes,
              forceUpdate: forceUpdate,
              downloadUrl: downloadUrl,
            ),
          ),
```
to:
```dart
          builder: (ctx) => PopScope(
            canPop: !forceUpdate,
            child: UpdateDialog(
              serverName: serverName,
              notes: notes,
              forceUpdate: forceUpdate,
              downloadUrl: downloadUrl,
            ),
          ),
```

2. Change the class declaration from:
```dart
class _UpdateDialog extends StatefulWidget {
  final String serverName;
  final String? notes;
  final bool forceUpdate;
  final String downloadUrl;

  const _UpdateDialog({
    required this.serverName,
    required this.notes,
    required this.forceUpdate,
    required this.downloadUrl,
  });

  @override
  State<_UpdateDialog> createState() => _UpdateDialogState();
}
```
to:
```dart
class UpdateDialog extends StatefulWidget {
  final String serverName;
  final String? notes;
  final bool forceUpdate;
  final String downloadUrl;

  const UpdateDialog({
    super.key,
    required this.serverName,
    required this.notes,
    required this.forceUpdate,
    required this.downloadUrl,
  });

  @override
  State<UpdateDialog> createState() => UpdateDialogState();
}
```

3. Change the state class declaration from:
```dart
class _UpdateDialogState extends State<_UpdateDialog> {
```
to:
```dart
class UpdateDialogState extends State<UpdateDialog> {
```

(No other references to `_UpdateDialog`/`_UpdateDialogState` exist in this file — the `widget.serverName` etc. field accesses inside the state class are unaffected by the rename.)

- [ ] **Step 2: Verify no leftover references to the old private names**

Run: `grep -n "_UpdateDialog" mobile/lib/core/update/update_service.dart`
Expected: no output (empty — all renamed).

- [ ] **Step 3: Analyze the file for errors**

Run: `cd mobile && flutter analyze lib/core/update/update_service.dart`
Expected: `No issues found!` (or pre-existing unrelated warnings only — no new errors about undefined `_UpdateDialog`/`_UpdateDialogState`).

- [ ] **Step 4: Commit**

```bash
git add mobile/lib/core/update/update_service.dart
git commit -m "refactor(mobile): make UpdateDialog public for reuse in About Us page"
```

---

### Task 2: Create `AboutUsPage`

**Files:**
- Create: `mobile/lib/features/profile/about_us_page.dart`

**Interfaces:**
- Consumes: `UpdateDialog` from `mobile/lib/core/update/update_service.dart` (Task 1) — constructor `UpdateDialog({required String serverName, required String? notes, required bool forceUpdate, required String downloadUrl})`.
- Consumes: `AppConfig.apiBaseUrl`, `AppConfig.appName` from `mobile/lib/core/constants/app_config.dart`.
- Consumes: `SupportPage` from `mobile/lib/features/support/support_page.dart`.
- Consumes: `AppColors` from `mobile/lib/shared/theme/app_theme.dart` (fields used: `background`, `surface`, `cardBg`, `border`, `gold`, `goldLight`, `textSecondary`, `green`, `red`).
- Produces: `AboutUsPage` (public `StatelessWidget`... actually `StatefulWidget`, see below) — no constructor args, used by `ProfilePage` in Task 3.

- [ ] **Step 1: Write the page**

Create `mobile/lib/features/profile/about_us_page.dart`:

```dart
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../../core/constants/app_config.dart';
import '../../core/update/update_service.dart';
import '../../shared/theme/app_theme.dart';
import '../support/support_page.dart';

enum _UpdateCheckStatus { checking, error, upToDate, outdated }

class AboutUsPage extends StatefulWidget {
  const AboutUsPage({super.key});

  @override
  State<AboutUsPage> createState() => _AboutUsPageState();
}

class _AboutUsPageState extends State<AboutUsPage> {
  String _installedVersion = '';
  int _localCode = 0;
  _UpdateCheckStatus _status = _UpdateCheckStatus.checking;
  String? _serverName;
  String? _releaseNotes;
  String? _downloadUrl;

  @override
  void initState() {
    super.initState();
    _loadInstalledVersion();
  }

  Future<void> _loadInstalledVersion() async {
    final info = await PackageInfo.fromPlatform();
    _localCode = int.tryParse(info.buildNumber) ?? 0;
    if (!mounted) return;
    setState(() {
      _installedVersion = '${info.version} (${info.buildNumber})';
    });
    _checkForUpdate();
  }

  Future<void> _checkForUpdate() async {
    setState(() => _status = _UpdateCheckStatus.checking);
    try {
      final res = await Dio()
          .get('${AppConfig.apiBaseUrl.trim()}/api/app/version');
      final data = res.data as Map<String, dynamic>;
      final serverCode = (data['version_code'] as num?)?.toInt() ?? 0;
      if (!mounted) return;
      setState(() {
        _serverName = data['version_name']?.toString() ?? '';
        _releaseNotes = data['release_notes']?.toString();
        _downloadUrl = data['download_url']?.toString() ?? '';
        _status = serverCode > _localCode
            ? _UpdateCheckStatus.outdated
            : _UpdateCheckStatus.upToDate;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _status = _UpdateCheckStatus.error);
    }
  }

  void _showUpdateDialog() {
    showDialog(
      context: context,
      builder: (ctx) => UpdateDialog(
        serverName: _serverName ?? '',
        notes: _releaseNotes,
        forceUpdate: false,
        downloadUrl: _downloadUrl ?? '',
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('About Us')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildHeaderCard(),
          const SizedBox(height: 16),
          _buildVersionCard(),
          const SizedBox(height: 12),
          _buildUpdateStatusCard(),
          const SizedBox(height: 16),
          _buildSupportRow(),
          const SizedBox(height: 24),
          const Center(
            child: Text(
              '© 2026 MyOnlineJoker. All rights reserved.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 11),
            ),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  Widget _buildHeaderCard() => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                gradient:
                    LinearGradient(colors: [AppColors.gold, AppColors.goldLight]),
              ),
              child: const Icon(Icons.casino_rounded,
                  color: Colors.black, size: 32),
            ),
            const SizedBox(height: 12),
            const Text(AppConfig.appName,
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
            const SizedBox(height: 4),
            const Text('Play. Win. Repeat.',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          ],
        ),
      );

  Widget _buildVersionCard() => Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: AppColors.cardBg,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(children: [
          const Icon(Icons.info_outline_rounded, color: AppColors.gold, size: 20),
          const SizedBox(width: 12),
          const Expanded(
              child: Text('App Version',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
          Text(_installedVersion.isEmpty ? '—' : _installedVersion,
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 13)),
        ]),
      );

  Widget _buildUpdateStatusCard() {
    switch (_status) {
      case _UpdateCheckStatus.checking:
        return _statusCard(
          icon: const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                  strokeWidth: 2, color: AppColors.gold)),
          title: 'Checking for updates…',
        );
      case _UpdateCheckStatus.error:
        return _statusCard(
          icon: const Icon(Icons.error_outline_rounded,
              color: AppColors.red, size: 20),
          title: "Couldn't check for updates",
          trailing: TextButton(
            onPressed: _checkForUpdate,
            child: const Text('Retry'),
          ),
        );
      case _UpdateCheckStatus.upToDate:
        return _statusCard(
          icon: const Icon(Icons.check_circle_rounded,
              color: AppColors.green, size: 20),
          title: "You're up to date",
        );
      case _UpdateCheckStatus.outdated:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _statusCard(
              icon: const Icon(Icons.system_update_rounded,
                  color: AppColors.gold, size: 20),
              title: 'Version $_serverName available',
              subtitle:
                  (_releaseNotes != null && _releaseNotes!.isNotEmpty)
                      ? _releaseNotes
                      : null,
            ),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: _showUpdateDialog,
              icon: const Icon(Icons.download_rounded),
              label: const Text('Update Now'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.gold,
                foregroundColor: Colors.black,
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ],
        );
    }
  }

  Widget _statusCard({
    required Widget icon,
    required String title,
    String? subtitle,
    Widget? trailing,
  }) =>
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: AppColors.cardBg,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(children: [
          icon,
          const SizedBox(width: 12),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(title,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 14)),
                if (subtitle != null) ...[
                  const SizedBox(height: 4),
                  Text(subtitle,
                      style: const TextStyle(
                          color: AppColors.textSecondary, fontSize: 12)),
                ],
              ])),
          if (trailing != null) trailing,
        ]),
      );

  Widget _buildSupportRow() => Container(
        decoration: BoxDecoration(
          color: AppColors.cardBg,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => Navigator.push(context,
              MaterialPageRoute(builder: (_) => const SupportPage())),
          child: const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(children: [
              Icon(Icons.support_agent_rounded, color: AppColors.gold, size: 20),
              SizedBox(width: 12),
              Expanded(
                  child: Text('Contact Support',
                      style: TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 14))),
              Icon(Icons.chevron_right_rounded,
                  color: AppColors.textSecondary, size: 20),
            ]),
          ),
        ),
      );
}
```

- [ ] **Step 2: Analyze the file for errors**

Run: `cd mobile && flutter analyze lib/features/profile/about_us_page.dart`
Expected: `No issues found!`

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/features/profile/about_us_page.dart
git commit -m "feat(mobile): add About Us page with version and update status"
```

---

### Task 3: Link "About Us" from the Profile page

**Files:**
- Modify: `mobile/lib/features/profile/profile_page.dart:1-18` (imports), `:259-277` (Preferences section)

**Interfaces:**
- Consumes: `AboutUsPage` from `mobile/lib/features/profile/about_us_page.dart` (Task 2).

- [ ] **Step 1: Add the import**

In `mobile/lib/features/profile/profile_page.dart`, add to the import list (after the existing `import 'bank_details_page.dart';` / `import 'kyc_page.dart';` lines):

```dart
import 'about_us_page.dart';
```

- [ ] **Step 2: Add the About section**

In `mobile/lib/features/profile/profile_page.dart`, the "Preferences" section currently ends with:

```dart
                      _sectionLabel('Preferences'),
                      _menuCard([
                        _menuItem(Icons.language_rounded, locale.t('language'),
                            subtitle: locale.current.nativeName,
                            onTap: () => Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                        builder: (_) =>
                                            const LanguageSelectionPage()))
                                .then((_) => setState(() {}))),
                        _menuToggle(
                          Icons.fingerprint_rounded,
                          locale.t('biometric_login'),
                          subtitle: locale.t('enable_biometric'),
                          value: _biometricEnabled,
                          onChanged: _toggleBiometric,
                        ),
                      ]),
                      const SizedBox(height: 20),

                      _buildReferralCard(),
```

Replace it with (inserting a new "About" section right before the referral card):

```dart
                      _sectionLabel('Preferences'),
                      _menuCard([
                        _menuItem(Icons.language_rounded, locale.t('language'),
                            subtitle: locale.current.nativeName,
                            onTap: () => Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                        builder: (_) =>
                                            const LanguageSelectionPage()))
                                .then((_) => setState(() {}))),
                        _menuToggle(
                          Icons.fingerprint_rounded,
                          locale.t('biometric_login'),
                          subtitle: locale.t('enable_biometric'),
                          value: _biometricEnabled,
                          onChanged: _toggleBiometric,
                        ),
                      ]),
                      const SizedBox(height: 12),

                      _sectionLabel('About'),
                      _menuCard([
                        _menuItem(Icons.info_outline_rounded, 'About Us',
                            subtitle: 'Version, updates & more',
                            onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                    builder: (_) => const AboutUsPage()))),
                      ]),
                      const SizedBox(height: 20),

                      _buildReferralCard(),
```

- [ ] **Step 3: Analyze the file for errors**

Run: `cd mobile && flutter analyze lib/features/profile/profile_page.dart`
Expected: `No issues found!`

- [ ] **Step 4: Commit**

```bash
git add mobile/lib/features/profile/profile_page.dart
git commit -m "feat(mobile): link About Us page from Profile"
```

---

### Task 4: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run full analyzer over the touched package**

Run: `cd mobile && flutter analyze`
Expected: no new errors introduced by this feature (pre-existing warnings elsewhere are not this task's concern).

- [ ] **Step 2: Launch the app and exercise the flow**

Use the project's `run` skill (or `flutter run`) to launch the app on a connected device/emulator, log in, navigate to Profile → About Us, and confirm:
- Installed version shows correctly (matches `pubspec.yaml` version/build number).
- Update status resolves to "You're up to date" when the backend's `version_code` is `<=` the installed build number.
- Contact Support row navigates to the existing Support page and back.

- [ ] **Step 3: Exercise the outdated-version path**

Temporarily lower the installed build number expectation by checking against a backend `version_code` known to be higher (e.g. read the current value from the `app_versions` table used by `infra/db/migrations/023_app_versions.sql` via the admin panel's App Update screen, or bump it there if you control a test row), reload About Us, and confirm:
- "Version {name} available" + release notes preview show.
- "Update Now" opens the download dialog, and the download/install flow completes (reusing the already-proven `UpdateDialog`).

- [ ] **Step 4: Report results to the user**

Summarize what was verified and any issues found, before considering this plan complete.
