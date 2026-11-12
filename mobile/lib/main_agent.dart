import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'features/agent/agent_app.dart';

@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {}

  try {
    if (message.notification == null && message.data.isNotEmpty) {
      final title = (message.data['title'] as String?) ?? 'MyOnlineJoker Agent';
      final body = (message.data['body'] as String?) ?? '';
      if (title.isNotEmpty || body.isNotEmpty) {
        final localNotifs = FlutterLocalNotificationsPlugin();
        const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
        await localNotifs.initialize(const InitializationSettings(android: androidInit));

        const channelId = 'joker_agent_notifications_v1';
        await localNotifs.show(
          message.hashCode,
          title,
          body,
          const NotificationDetails(
            android: AndroidNotificationDetails(
              channelId,
              'Agent Partner Alerts',
              importance: Importance.max,
              priority: Priority.high,
              playSound: true,
              enableVibration: true,
            ),
          ),
        );
      }
    }
  } catch (_) {}
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
  } catch (e) {
    debugPrint('[Firebase Agent init error]: $e');
  }

  // Enforce portrait orientation for clean mobile agent operations
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  runApp(const JokerAgentApp());
}
