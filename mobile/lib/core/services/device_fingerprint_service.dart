import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// Result of [DeviceFingerprintService.getInfo]: the stable hash plus the
/// human-readable metadata it was derived from, so the backend can store
/// both — the hash for the fraud-detection join, the metadata for admins
/// eyeballing a "Device Links" row.
class DeviceFingerprintInfo {
  final String fingerprint;
  final Map<String, dynamic> deviceInfo;
  const DeviceFingerprintInfo(this.fingerprint, this.deviceInfo);
}

/// Builds a stable per-device fingerprint sent on login/register so
/// risk-service's co-location rule and the admin Risk Center "Device Links"
/// tab can detect multiple accounts sharing one device.
///
/// Combines the platform, device model/manufacturer, and a UUID that's
/// persisted in secure storage (survives app restarts and, on iOS, app
/// updates — but not a full uninstall/reinstall or "reset app data", same
/// caveat as any client-supplied identifier) into a single SHA-256 hash.
/// This is deliberately a *separate* persisted key from
/// [MonitorService]'s `monitor_device_id` — that one is analytics-only
/// telemetry, this one feeds fraud detection, and the two features
/// shouldn't be coupled to each other's storage.
class DeviceFingerprintService {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  static const _uuid = Uuid();
  static const _installIdKey = 'device_fingerprint_install_id';

  static DeviceFingerprintInfo? _cached;

  /// Returns just the fingerprint hash. Never throws — returns null on any
  /// failure so callers can omit the field rather than fail login/register.
  static Future<String?> get() async => (await getInfo())?.fingerprint;

  /// Returns the cached fingerprint + device metadata if already computed
  /// this session, otherwise derives and caches it. Never throws — returns
  /// null on any failure so callers can omit the field rather than fail
  /// login/register.
  static Future<DeviceFingerprintInfo?> getInfo() async {
    if (_cached != null) return _cached;
    try {
      String? installId = await _storage.read(key: _installIdKey);
      if (installId == null) {
        installId = _uuid.v4();
        await _storage.write(key: _installIdKey, value: installId);
      }

      final platform = Platform.isAndroid ? 'android' : (Platform.isIOS ? 'ios' : Platform.operatingSystem);
      String model = 'unknown';
      String manufacturer = 'unknown';

      try {
        final deviceInfo = DeviceInfoPlugin();
        if (Platform.isAndroid) {
          final a = await deviceInfo.androidInfo;
          model = a.model;
          manufacturer = a.manufacturer;
        } else if (Platform.isIOS) {
          final i = await deviceInfo.iosInfo;
          model = i.utsname.machine;
          manufacturer = 'Apple';
        }
      } catch (_) {
        // Fall back to the install UUID alone — still stable, just less specific.
      }

      final raw = '$platform|$manufacturer|$model|$installId';
      final fingerprint = sha256.convert(utf8.encode(raw)).toString();
      _cached = DeviceFingerprintInfo(fingerprint, {
        'platform': platform,
        'model': model,
        'manufacturer': manufacturer,
      });
      return _cached;
    } catch (_) {
      return null;
    }
  }
}
