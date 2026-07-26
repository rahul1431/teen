import '../network/api_client.dart';

/// Product analytics: event tracking + feature-flag evaluation. Mirrors the
/// singleton-init pattern used by MonitorService, but talks to
/// /api/analytics/* instead — a separate, lighter-weight concern (product
/// funnels/flags, not app-health telemetry).
class ProductAnalytics {
  static final ProductAnalytics instance = ProductAnalytics._();
  ProductAnalytics._();

  Map<String, dynamic> _flags = {};
  bool _initialized = false;

  /// Fetches all flag evaluations once at app launch and caches them.
  /// Call after login (flags require an authenticated player) — safe to
  /// call multiple times, only the first successful call populates the cache.
  Future<void> init() async {
    if (_initialized) return;
    try {
      final res = await ApiClient().dio.get('/api/analytics/flags');
      _flags = Map<String, dynamic>.from(res.data as Map);
      _initialized = true;
    } catch (_) {
      // Never block app startup on analytics — flags default to off.
    }
  }

  /// Fire-and-forget event log. Never throws — a tracking failure must
  /// never surface to the user or interrupt their flow.
  void track(String eventName, [Map<String, dynamic>? properties]) {
    ApiClient().dio.post('/api/analytics/events', data: {
      'event_name': eventName,
      'properties': properties ?? {},
    }).catchError((_) {
      // Swallow — analytics is best-effort.
      return null;
    });
  }

  bool isEnabled(String flagKey) {
    final entry = _flags[flagKey];
    if (entry == null) return false;
    return entry['enabled'] == true;
  }

  String? variant(String flagKey) {
    final entry = _flags[flagKey];
    if (entry == null) return null;
    return entry['variant'] as String?;
  }
}
