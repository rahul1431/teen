import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:geolocator/geolocator.dart';
import 'monitor_service.dart';

/// Opt-in coarse GPS telemetry. Shows a one-time consent dialog, remembers
/// the user's choice, and (only on grant) periodically enqueues location
/// pings via [MonitorService]. Never crashes the app and never re-prompts
/// after a decline.
class LocationConsentService {
  static final LocationConsentService instance = LocationConsentService._();
  LocationConsentService._();

  static const _storage = FlutterSecureStorage();
  static const _key = 'monitor_loc_consent';
  Timer? _timer;
  bool _started = false;

  /// Show the consent prompt once, then (if granted) stream coarse location.
  Future<void> maybeStart(BuildContext context) async {
    if (_started) return;
    _started = true;
    try {
      final prior = await _storage.read(key: _key);
      if (prior == 'denied') return;
      if (prior != 'granted') {
        if (!context.mounted) return;
        final ok = await showDialog<bool>(
          context: context,
          builder: (c) => AlertDialog(
            title: const Text('Share location?'),
            content: const Text(
                'We use your approximate location to keep your account secure and '
                'to comply with regional gaming rules. You can decline.'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Not now')),
              TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Allow')),
            ],
          ),
        );
        if (ok != true) {
          await _storage.write(key: _key, value: 'denied');
          return;
        }
      }
      LocationPermission perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        await _storage.write(key: _key, value: 'denied');
        return;
      }
      await _storage.write(key: _key, value: 'granted');
      await _sample();
      _timer = Timer.periodic(const Duration(seconds: 60), (_) => _sample());
    } catch (_) {
      /* never crash */
    }
  }

  Future<void> _sample() async {
    try {
      final p = await Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.low);
      MonitorService.instance.location(p.latitude, p.longitude, accuracyM: p.accuracy.round());
    } catch (_) {}
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    _started = false;
  }
}
