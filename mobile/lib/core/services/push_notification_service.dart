import 'dart:convert';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:go_router/go_router.dart';
import '../network/api_client.dart';
import '../storage/secure_storage.dart';

// Wires FCM → deep-link routing, and shows a system-tray notification for
// foreground pushes (Android/iOS never auto-display one for a foregrounded
// app, even for `notification`-payload messages — the app has to do it).
//
// A prior version of this file did this via flutter_local_notifications on
// a channel that later needed different sound/importance settings — Android
// notification channels are immutable once created on-device, so that
// channel-settings change silently did nothing for anyone who already had
// the app installed, and the foreground handling was removed entirely
// rather than chase channel IDs. `_channelId` below is a NEW id (never used
// by any shipped version) specifically so this doesn't hit the same trap;
// if channel settings ever need to change again, bump this id rather than
// editing the existing channel's properties in place.
//
// Call PushNotificationService.init(router) once after login is confirmed.
class PushNotificationService {
  PushNotificationService._();
  static final _instance = PushNotificationService._();
  static PushNotificationService get instance => _instance;

  static const _channelId = 'myonlinejoker_notifications_v2';
  static const _channelName = 'Notifications';
  static const _channelDescription = 'Promotions, wallet updates, and game results';

  final _localNotifications = FlutterLocalNotificationsPlugin();
  GoRouter? _router;
  bool _initialized = false;

  Future<void> init(GoRouter router) async {
    if (_initialized) return;
    _initialized = true;
    _router = router;

    await _initLocalNotifications();

    // Register FCM token with backend
    await _registerToken();

    // Listen for token refresh
    FirebaseMessaging.instance.onTokenRefresh.listen(_uploadToken);

    // Foreground: FCM never shows a system notification itself while the
    // app is open, so we display one manually via flutter_local_notifications.
    FirebaseMessaging.onMessage.listen(_showForegroundNotification);

    // Background tap (app was in background, user tapped notification)
    FirebaseMessaging.onMessageOpenedApp.listen((msg) => _routeMessage(msg));

    // Terminated tap (app was killed, user tapped notification)
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null) _routeMessage(initial);
  }

  Future<void> _initLocalNotifications() async {
    try {
      const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
      const iosSettings = DarwinInitializationSettings();
      await _localNotifications.initialize(
        const InitializationSettings(android: androidSettings, iOS: iosSettings),
        onDidReceiveNotificationResponse: (response) {
          final payload = response.payload;
          if (payload == null || payload.isEmpty) return;
          try {
            final decoded = jsonDecode(payload) as Map<String, dynamic>;
            final route = decoded['route'] as String?;
            final campaignId = decoded['campaign_id'] as String?;
            if (route != null && route.isNotEmpty) _navigate(route);
            _markCampaignRead(campaignId);
          } catch (_) {}
        },
      );

      const channel = AndroidNotificationChannel(
        _channelId,
        _channelName,
        description: _channelDescription,
        importance: Importance.high,
      );
      await _localNotifications
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(channel);
    } catch (_) {
      // Local notifications unavailable — foreground pushes just won't show
      // a tray notification; background/terminated delivery is unaffected.
    }
  }

  Future<void> _showForegroundNotification(RemoteMessage message) async {
    final notification = message.notification;
    if (notification == null) return;
    try {
      await _localNotifications.show(
        message.hashCode,
        notification.title,
        notification.body,
        const NotificationDetails(
          android: AndroidNotificationDetails(
            _channelId,
            _channelName,
            channelDescription: _channelDescription,
            importance: Importance.high,
            priority: Priority.high,
          ),
          iOS: DarwinNotificationDetails(),
        ),
        payload: jsonEncode({
          'route': message.data['route'],
          'campaign_id': message.data['campaign_id'],
        }),
      );
    } catch (_) {
      // Best-effort — a failed local notification must never crash the app.
    }
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
    _markCampaignRead(message.data['campaign_id'] as String?);
  }

  void _navigate(String route) {
    _router?.push(route);
  }

  // Marks the notification read the moment the user actually acts on it —
  // taps the tray notification (background/terminated, here) or the local
  // foreground notification (see onDidReceiveNotificationResponse above).
  // Best-effort: a failed mark-as-read must never block navigation.
  Future<void> _markCampaignRead(String? campaignId) async {
    if (campaignId == null || campaignId.isEmpty) return;
    try {
      await ApiClient().dio.put('/api/notifications/read-by-campaign/$campaignId');
    } catch (_) {}
  }
}
