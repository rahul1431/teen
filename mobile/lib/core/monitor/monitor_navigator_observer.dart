// mobile/lib/core/monitor/monitor_navigator_observer.dart
import 'package:flutter/material.dart';
import 'monitor_service.dart';

/// Tracks screen transitions via GoRouter's NavigatorObserver hook.
/// Records each screen's name and time spent before navigating away.
class MonitorNavigatorObserver extends NavigatorObserver {
  int? _screenStartMs;
  String? _currentScreen;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    _trackTransition(route);
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    if (newRoute != null) _trackTransition(newRoute);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (previousRoute != null) _trackTransition(previousRoute);
  }

  void _trackTransition(Route<dynamic> incomingRoute) {
    try {
      final now = DateTime.now().millisecondsSinceEpoch;

      // Emit duration for the screen we're leaving
      if (_currentScreen != null && _screenStartMs != null) {
        MonitorService.instance.enqueue({
          'event_type': 'screen_view',
          'screen': _currentScreen,
          'duration_ms': now - _screenStartMs!,
        });
      }

      // GoRouter sets settings.name to the route path (e.g. '/home', '/games/aviator')
      final screenName = incomingRoute.settings.name ?? 'unknown';
      _currentScreen = screenName;
      _screenStartMs = now;

      // Keep MonitorService.currentScreen in sync so MonitorInterceptor can tag API calls
      MonitorService.instance.currentScreen = screenName;
    } catch (_) {}
  }
}
