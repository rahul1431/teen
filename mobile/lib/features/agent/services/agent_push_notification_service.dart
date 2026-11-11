import 'dart:convert';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'agent_api_service.dart';

/// Enterprise Push Notification Service for Agent Partner App.
/// Handles background/foreground messaging, token registration with admin-service,
/// and local notification trays for live commission credits and payout status.
class AgentPushNotificationService {
  AgentPushNotificationService._();
  static final AgentPushNotificationService _instance = AgentPushNotificationService._();
  static AgentPushNotificationService get instance => _instance;

  static const _channelId = 'joker_agent_notifications_v1';
  static const _channelName = 'Agent Partner Alerts';
  static const _channelDescription = 'Live commission credits, player top-ups, and payout updates';

  final _localNotifications = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    await _initLocalNotifications();
    await _requestPermissions();
    await _registerToken();

    // Listen for FCM token refreshes
    FirebaseMessaging.instance.onTokenRefresh.listen((token) {
      _uploadToken(token);
    });

    // Handle foreground pushes
    FirebaseMessaging.onMessage.listen(_showForegroundNotification);

    // Handle background notification clicks
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      debugPrint('[AgentPush] Opened app from notification: ${message.data}');
    });

    // Check if app was opened from terminated state by a notification
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null) {
      debugPrint('[AgentPush] Initial notification: ${initial.data}');
    }
  }

  Future<void> _requestPermissions() async {
    try {
      final settings = await FirebaseMessaging.instance.requestPermission(
        alert: true,
        announcement: false,
        badge: true,
        carPlay: false,
        criticalAlert: false,
        provisional: false,
        sound: true,
      );
      debugPrint('[AgentPush] Permission status: ${settings.authorizationStatus}');
    } catch (e) {
      debugPrint('[AgentPush] Permission request error: $e');
    }
  }

  Future<void> _initLocalNotifications() async {
    try {
      const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
      const iosSettings = DarwinInitializationSettings();
      await _localNotifications.initialize(
        const InitializationSettings(android: androidSettings, iOS: iosSettings),
        onDidReceiveNotificationResponse: (response) {
          final payload = response.payload;
          if (payload != null && payload.isNotEmpty) {
            debugPrint('[AgentPush] Foreground notification tapped: $payload');
          }
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
    } catch (e) {
      debugPrint('[AgentPush] Local notifications init error: $e');
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
            icon: '@mipmap/ic_launcher',
          ),
          iOS: DarwinNotificationDetails(),
        ),
        payload: jsonEncode(message.data),
      );
    } catch (e) {
      debugPrint('[AgentPush] Show notification error: $e');
    }
  }

  Future<void> _registerToken() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null && token.isNotEmpty) {
        await _uploadToken(token);
      }
    } catch (e) {
      debugPrint('[AgentPush] Token retrieval error: $e');
    }
  }

  Future<void> _uploadToken(String token) async {
    try {
      final agentToken = await AgentApiService().getToken();
      if (agentToken != null && agentToken.isNotEmpty) {
        await AgentApiService().registerFcmToken(token);
        debugPrint('[AgentPush] Successfully uploaded agent FCM token');
      }
    } catch (e) {
      debugPrint('[AgentPush] Token upload error: $e');
    }
  }
}

