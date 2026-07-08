import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:go_router/go_router.dart';
import '../network/api_client.dart';
import '../storage/secure_storage.dart';

// Wires FCM → deep-link routing. Foreground pushes are never shown as a
// system notification (previously done via flutter_local_notifications) —
// Android notification channels are immutable once created on-device, so a
// "silence this channel" code change silently did nothing for anyone whose
// app already created the old sound-on channel. Dropping the local
// notification entirely sidesteps that instead of chasing channel IDs.
// Call PushNotificationService.init(router) once after login is confirmed.
class PushNotificationService {
  PushNotificationService._();
  static final _instance = PushNotificationService._();
  static PushNotificationService get instance => _instance;

  GoRouter? _router;
  bool _initialized = false;

  Future<void> init(GoRouter router) async {
    if (_initialized) return;
    _initialized = true;
    _router = router;

    // Register FCM token with backend
    await _registerToken();

    // Listen for token refresh
    FirebaseMessaging.instance.onTokenRefresh.listen(_uploadToken);

    // Background tap (app was in background, user tapped notification)
    FirebaseMessaging.onMessageOpenedApp.listen((msg) => _routeMessage(msg));

    // Terminated tap (app was killed, user tapped notification)
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null) _routeMessage(initial);
  }

  Future<void> _registerToken() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await _uploadToken(token);
    } catch (_) {}
  }

  Future<void> _uploadToken(String token) async {
    try {
      final accessToken = await SecureStorage.getAccessToken();
      if (accessToken == null) return;
      await ApiClient().dio.put('/api/auth/fcm-token', data: {'token': token});
    } catch (_) {}
  }

  void _routeMessage(RemoteMessage message) {
    final route = message.data['route'] as String?;
    if (route != null && route.isNotEmpty) _navigate(route);
  }

  void _navigate(String route) {
    _router?.push(route);
  }
}
