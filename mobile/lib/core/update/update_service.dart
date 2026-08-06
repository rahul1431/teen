import 'dart:async';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:open_file/open_file.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../network/api_client.dart';

/// Checks the server for a newer app version and shows an update dialog
/// that downloads the APK in-app and hands off to the system installer.
/// Call [checkAndPrompt] once after the user is logged in.
class UpdateService {
  static final UpdateService instance = UpdateService._();
  UpdateService._();

  bool _shown = false;

  void reset() {
    _shown = false;
  }

  Future<void> checkAndPrompt(BuildContext context, {bool force = false}) async {
    if (_shown && !force) return;
    try {
      final info = await PackageInfo.fromPlatform();
      final localCode = int.tryParse(info.buildNumber) ?? 0;

      final res = await ApiClient().dio.get('/api/app/version');
      final data = res.data as Map<String, dynamic>;
      final serverCode = (data['version_code'] as num?)?.toInt() ?? 0;
      final forceUpdate = data['force_update'] == true;
      final serverName = data['version_name']?.toString() ?? '';
      final notes = data['release_notes']?.toString();
      var rawDownloadUrl = data['download_url']?.toString() ?? '';

      if (serverCode <= localCode) return;

      if (rawDownloadUrl.startsWith('/')) {
        rawDownloadUrl = 'https://game.myonlinejoker.com$rawDownloadUrl';
      }

      final downloadUrl = rawDownloadUrl.isEmpty
          ? rawDownloadUrl
          : '$rawDownloadUrl${rawDownloadUrl.contains('?') ? '&' : '?'}v=$serverCode';
      if (!context.mounted) return;

      _shown = true;
      showDialog(
        context: context,
        barrierDismissible: !forceUpdate,
        builder: (ctx) => PopScope(
          canPop: !forceUpdate,
          child: UpdateDialog(
            serverName: serverName,
            notes: notes,
            forceUpdate: forceUpdate,
            downloadUrl: downloadUrl,
          ),
        ),
      );
    } catch (e) {
      debugPrint('[UpdateService] checkAndPrompt failed: $e');
    }
  }
}

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

class UpdateDialogState extends State<UpdateDialog> {
  bool _downloading = false;
  bool _downloaded = false;
  double _progress = 0;
  String? _filePath;
  String? _error;
  CancelToken? _cancelToken;

  @override
  void dispose() {
    _cancelToken?.cancel();
    super.dispose();
  }

  Future<void> _download() async {
    setState(() {
      _downloading = true;
      _error = null;
      _progress = 0;
    });
    final path = '${Directory.systemTemp.path}/myonlinejoker_update.apk';
    _cancelToken = CancelToken();
    try {
      await Dio().download(
        widget.downloadUrl,
        path,
        cancelToken: _cancelToken,
        options: Options(headers: {'Cache-Control': 'no-cache'}),
        onReceiveProgress: (received, total) {
          if (total > 0 && mounted) setState(() => _progress = received / total);
        },
      );
      if (!mounted) return;
      setState(() {
        _downloading = false;
        _downloaded = true;
        _filePath = path;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _downloading = false;
        _error = 'Download failed. Check your connection and try again.';
      });
    }
  }

  Future<void> _install() async {
    if (_filePath == null) return;
    final result = await OpenFile.open(_filePath!, type: 'application/vnd.android.package-archive');
    if (!mounted) return;
    if (result.type != ResultType.done) {
      setState(() => _error = 'Could not open installer: ${result.message}');
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Row(
        children: [
          const Icon(Icons.system_update, color: Color(0xFFd4af37)),
          const SizedBox(width: 8),
          Expanded(child: Text('Update v${widget.serverName}')),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _downloaded
                ? 'Download complete. Tap Install to finish updating.'
                : widget.forceUpdate
                    ? 'A required update is available. Please update to continue.'
                    : 'A new version is available. Update now for the latest features and fixes.',
            style: const TextStyle(color: Colors.black87),
          ),
          if (widget.notes != null && widget.notes!.isNotEmpty) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.grey.shade100,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                widget.notes!,
                style: const TextStyle(fontSize: 13, color: Colors.black87),
              ),
            ),
          ],
          if (_downloading) ...[
            const SizedBox(height: 16),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: _progress > 0 ? _progress : null,
                minHeight: 6,
                backgroundColor: Colors.grey.shade200,
                color: const Color(0xFFd4af37),
              ),
            ),
            const SizedBox(height: 6),
            Text('${(_progress * 100).toStringAsFixed(0)}%', style: const TextStyle(fontSize: 12, color: Colors.black87)),
          ],
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 12)),
          ],
        ],
      ),
      actions: [
        if (!widget.forceUpdate && !_downloading && !_downloaded)
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Later'),
          ),
        if (_downloaded)
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFd4af37), foregroundColor: Colors.black),
            icon: const Icon(Icons.install_mobile),
            label: const Text('Install'),
            onPressed: _install,
          )
        else
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFd4af37), foregroundColor: Colors.black),
            icon: _downloading
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                : const Icon(Icons.download),
            label: Text(_downloading ? 'Downloading…' : 'Update Now'),
            onPressed: _downloading ? null : _download,
          ),
      ],
    );
  }
}
