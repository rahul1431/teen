import 'dart:convert';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:go_router/go_router.dart';
import '../network/api_client.dart';
import '../storage/secure_storage.dart';

// Enterprise Push Notification Service:
// Wires FCM → deep-link routing, rich action buttons, conversion attribution tracking,
// and multi-channel local notifications (Cashier, Promotions, Game Alerts).
class PushNotificationService {
  PushNotificationService._();
  static final _instance = PushNotificationService._();
  static PushNotificationService get instance => _instance;

  static const _channelGeneral = 'myonlinejoker_notifications_v2';
  static const _channelCashier = 'myonlinejoker_cashier_v1';
  static const _channelPromotions = 'myonlinejoker_promotions_v1';
  static const _channelGameAlerts = 'myonlinejoker_game_alerts_v1';

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
            final campaignId = decoded['campaign_id'] as String?;
            final notifId = (decoded['notification_id'] ?? decoded['id']) as String?;

            String? targetRoute = decoded['route'] as String?;
            final actionId = response.actionId;
            if (actionId == 'action_claim') {
              targetRoute = '/wallet';
            } else if (actionId == 'action_play') {
              targetRoute = '/games/teen-patti';
            } else if (actionId == 'action_lobby') {
              targetRoute = '/home';
            }

            if (targetRoute != null && targetRoute.isNotEmpty) _navigate(targetRoute);
            _markCampaignRead(campaignId);
            _markNotificationClicked(notifId);
          } catch (_) {}
        },
      );

      final androidImpl = _localNotifications
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();

      // Register Multi-Channel Notification Profiles
      await androidImpl?.createNotificationChannel(
        const AndroidNotificationChannel(
          _channelCashier,
          'Wallet & Cashier Updates',
          description: 'Instant deposit confirmations, withdrawals, and wallet alerts',
          importance: Importance.max,
        ),
      );

      await androidImpl?.createNotificationChannel(
        const AndroidNotificationChannel(
          _channelPromotions,
          'Promotions & Bonuses',
          description: 'Special offers, bonus chips, and re-engagement rewards',
          importance: Importance.high,
        ),
      );

      await androidImpl?.createNotificationChannel(
        const AndroidNotificationChannel(
          _channelGameAlerts,
          'Game Invites & Table Action',
          description: 'Table challenges, game results, and tournament notices',
          importance: Importance.high,
        ),
      );

      await androidImpl?.createNotificationChannel(
        const AndroidNotificationChannel(
          _channelGeneral,
          'Notifications',
          description: 'General system announcements and news',
          importance: Importance.high,
        ),
      );
    } catch (_) {
      // Local notifications unavailable
    }
  }

  String _resolveChannelId(Map<String, dynamic> data) {
    final type = data['type'] as String?;
    if (type == 'wallet' || type == 'deposit_recovery' || type == 'payout') {
      return _channelCashier;
    }
    if (type == 'promotion' || type == 'reengagement' || type == 'churn_winback' || type == 'bonus') {
      return _channelPromotions;
    }
    if (type == 'game_result' || type == 'game_invite') {
      return _channelGameAlerts;
    }
    return (data['channel_id'] as String?) ?? _channelGeneral;
  }

  List<AndroidNotificationAction> _buildActions(String? actionsRaw) {
    if (actionsRaw == null || actionsRaw.isEmpty) return const [];
    try {
      final list = jsonDecode(actionsRaw) as List<dynamic>;
      return list.map((item) {
        final m = item as Map<String, dynamic>;
        return AndroidNotificationAction(
          m['id'] as String? ?? 'action_default',
          m['title'] as String? ?? 'Open',
          showsUserInterface: true,
        );
      }).toList();
    } catch (_) {
      return const [];
    }
  }

  Future<void> _showForegroundNotification(RemoteMessage message) async {
    final notification = message.notification;
    if (notification == null) return;
    try {
      final channelId = _resolveChannelId(message.data);
      final actions = _buildActions(message.data['actions'] as String?);

      await _localNotifications.show(
        message.hashCode,
        notification.title,
        notification.body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            channelId,
            channelId == _channelCashier
                ? 'Wallet & Cashier Updates'
                : channelId == _channelPromotions
                    ? 'Promotions & Bonuses'
                    : channelId == _channelGameAlerts
                        ? 'Game Invites & Table Action'
                        : 'Notifications',
            importance: Importance.high,
            priority: Priority.high,
            actions: actions,
          ),
          iOS: const DarwinNotificationDetails(),
        ),
        payload: jsonEncode({
          'route': message.data['route'],
          'campaign_id': message.data['campaign_id'],
          'notification_id': message.data['notification_id'] ?? message.data['id'],
        }),
      );
    } catch (_) {
      // Best-effort
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
    final notifId = (message.data['notification_id'] ?? message.data['id']) as String?;
    if (route != null && route.isNotEmpty) _navigate(route);
    _markCampaignRead(message.data['campaign_id'] as String?);
    _markNotificationClicked(notifId);
  }

  void _navigate(String route) {
    _router?.push(route);
  }

  Future<void> _markCampaignRead(String? campaignId) async {
    if (campaignId == null || campaignId.isEmpty) return;
    try {
      await ApiClient().dio.put('/api/notifications/read-by-campaign/$campaignId');
    } catch (_) {}
  }

  Future<void> _markNotificationClicked(String? notificationId) async {
    if (notificationId == null || notificationId.isEmpty) return;
    try {
      await ApiClient().dio.put('/api/notifications/click/$notificationId');
    } catch (_) {}
  }
}
