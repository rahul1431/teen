import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:go_router/go_router.dart';
import '../network/api_client.dart';
import '../storage/secure_storage.dart';

// Singleton that wires FCM → local notification display → deep-link routing.
// Call PushNotificationService.init(router) once after login is confirmed.
class PushNotificationService {
  PushNotificationService._();
  static final _instance = PushNotificationService._();
  static PushNotificationService get instance => _instance;

  static const _channelId = 'myonlinejoker_main';
  static const _channelName = 'MyOnlineJoker Notifications';

  final _local = FlutterLocalNotificationsPlugin();
  GoRouter? _router;
  bool _initialized = false;

  Future<void> init(GoRouter router) async {
    if (_initialized) return;
    _initialized = true;
    _router = router;

    // Local notification channel (Android 8+)
    await _local.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
      onDidReceiveNotificationResponse: (details) {
        final payload = details.payload;
        if (payload != null && payload.isNotEmpty) _navigate(payload);
      },
    );

    const androidChannel = AndroidNotificationChannel(
      _channelId, _channelName,
      importance: Importance.high,
      playSound: true,
    );
    await _local
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(androidChannel);

    // Register FCM token with backend
    await _registerToken();

    // Listen for token refresh
    FirebaseMessaging.instance.onTokenRefresh.listen(_uploadToken);

    // Foreground messages → show local notification
    FirebaseMessaging.onMessage.listen(_onForeground);

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

  void _onForeground(RemoteMessage message) {
    final n = message.notification;
    if (n == null) return;
    _local.show(
      message.hashCode,
      n.title,
      n.body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _channelId, _channelName,
          importance: Importance.high,
          priority: Priority.high,
          icon: '@mipmap/ic_launcher',
        ),
        iOS: const DarwinNotificationDetails(sound: 'default'),
      ),
      payload: message.data['route'] as String? ?? '',
    );
  }

  void _routeMessage(RemoteMessage message) {
    final route = message.data['route'] as String?;
    if (route != null && route.isNotEmpty) _navigate(route);
  }

  void _navigate(String route) {
    _router?.push(route);
  }
}
