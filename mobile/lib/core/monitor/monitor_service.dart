import 'dart:async';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:uuid/uuid.dart';
import '../constants/app_config.dart';

class MonitorService {
  static final MonitorService instance = MonitorService._();
  MonitorService._();

  static const _storage = FlutterSecureStorage();
  static const _uuid = Uuid();

  final List<Map<String, dynamic>> _queue = [];
  Timer? _flushTimer;
  Dio? _monitorDio;

  String? _sessionId;
  String? _deviceId;
  String? _appVersion;
  String? _platform;
  String? _osVersion;
  String? _userId;

  /// Set by MonitorNavigatorObserver — read by MonitorInterceptor to tag API calls with screen.
  String? currentScreen;

  bool _initialized = false;

  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    try {
      _sessionId = _uuid.v4();

      // Persistent device ID across app reinstalls (stored in secure storage)
      _deviceId = await _storage.read(key: 'monitor_device_id');
      if (_deviceId == null) {
        _deviceId = _uuid.v4();
        await _storage.write(key: 'monitor_device_id', value: _deviceId!);
      }

      final info = await PackageInfo.fromPlatform();
      _appVersion = info.version;
      _platform = Platform.isAndroid ? 'android' : 'ios';
      // e.g. "Android 14" or "iOS 17.0"
      final rawOs = Platform.operatingSystemVersion;
      _osVersion = rawOs.length > 80 ? rawOs.substring(0, 80) : rawOs;

      // Separate Dio instance — no auth interceptors, no monitor interceptor (avoids loops)
      _monitorDio = Dio(BaseOptions(
        baseUrl: AppConfig.apiBaseUrl.trim(),
        connectTimeout: const Duration(seconds: 5),
        receiveTimeout: const Duration(seconds: 5),
        headers: {'Content-Type': 'application/json'},
      ));

      // Shared secret — set via --dart-define=MONITOR_SECRET_KEY=xxx at build time
      const monitorKey = String.fromEnvironment('MONITOR_SECRET_KEY');
      if (monitorKey.isNotEmpty) {
        _monitorDio!.options.headers['x-monitor-key'] = monitorKey;
      }

      _flushTimer = Timer.periodic(const Duration(seconds: 10), (_) => _flush());
    } catch (_) {
      // MonitorService must never crash the app
    }
  }

  /// Call after successful login with the authenticated user's ID.
  /// Call with null on logout.
  void setUserId(String? userId) {
    _userId = userId;
  }

  /// Add an event to the queue. Silently drops if not initialized or queue is full.
  void enqueue(Map<String, dynamic> event) {
    if (!_initialized) return;
    try {
      if (_queue.length >= 200) _queue.removeAt(0); // cap memory at 200 events
      _queue.add({
        ...event,
        'ts': DateTime.now().toUtc().toIso8601String(),
      });
    } catch (_) {}
  }

  Future<void> _flush() async {
    if (_queue.isEmpty || _monitorDio == null) return;

    final batch = List<Map<String, dynamic>>.from(_queue);
    _queue.clear();

    try {
      await _monitorDio!.post('/api/monitor/events', data: {
        'session_id': _sessionId,
        'user_id': _userId,
        'device_id': _deviceId,
        'app_version': _appVersion ?? 'unknown',
        'platform': _platform ?? 'android',
        'os_version': _osVersion ?? 'unknown',
        'events': batch,
      });
    } catch (_) {
      // Re-enqueue on failure (respecting cap)
      for (final e in batch) {
        if (_queue.length < 200) _queue.add(e);
      }
    }
  }

  /// Best-effort flush before the app closes. Call from lifecycle observer.
  void dispose() {
    _flushTimer?.cancel();
    _flush(); // fire-and-forget
  }
}
