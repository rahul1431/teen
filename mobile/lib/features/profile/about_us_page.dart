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
      _installedVersion = 'v${info.version} (${info.buildNumber})';
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
