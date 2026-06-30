import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../constants/app_config.dart';

/// Checks the server for a newer app version and shows an update dialog.
/// Call [checkAndPrompt] once after the user is logged in.
class UpdateService {
  static final UpdateService instance = UpdateService._();
  UpdateService._();

  bool _shown = false;

  Future<void> checkAndPrompt(BuildContext context) async {
    if (_shown) return;
    try {
      final info = await PackageInfo.fromPlatform();
      final localCode = int.tryParse(info.buildNumber) ?? 0;

      final res = await Dio().get('${AppConfig.apiBaseUrl.trim()}/api/app/version');
      final data = res.data as Map<String, dynamic>;
      final serverCode = (data['version_code'] as num?)?.toInt() ?? 0;
      final forceUpdate = data['force_update'] == true;
      final serverName = data['version_name']?.toString() ?? '';
      final notes = data['release_notes']?.toString();
      final downloadUrl = data['download_url']?.toString() ?? '';

      if (serverCode <= localCode) return;
      if (!context.mounted) return;

      _shown = true;
      _showDialog(context, serverName: serverName, notes: notes, forceUpdate: forceUpdate, downloadUrl: downloadUrl);
    } catch (_) {
      // network error — silently skip, try again next launch
    }
  }

  void _showDialog(BuildContext context, {
    required String serverName,
    required String? notes,
    required bool forceUpdate,
    required String downloadUrl,
  }) {
    showDialog(
      context: context,
      barrierDismissible: !forceUpdate,
      builder: (ctx) => PopScope(
        canPop: !forceUpdate,
        child: AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Row(
            children: [
              const Icon(Icons.system_update, color: Color(0xFFd4af37)),
              const SizedBox(width: 8),
              Text('Update v$serverName'),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(forceUpdate
                  ? 'A required update is available. Please update to continue.'
                  : 'A new version is available. Update now for the latest features and fixes.'),
              if (notes != null && notes.isNotEmpty) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.grey.shade100,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(notes, style: const TextStyle(fontSize: 13)),
                ),
              ],
            ],
          ),
          actions: [
            if (!forceUpdate)
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Later'),
              ),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFd4af37), foregroundColor: Colors.black),
              icon: const Icon(Icons.download),
              label: const Text('Update Now'),
              onPressed: () => _launchDownload(downloadUrl),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _launchDownload(String url) async {
    final uri = Uri.tryParse(url);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}
