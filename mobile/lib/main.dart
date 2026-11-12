import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:flutter/foundation.dart';
import 'core/monitor/monitor_service.dart';
import 'core/monitor/socket_monitor_wrapper.dart';
import 'core/services/locale_service.dart';
import 'core/services/config_reload_service.dart';
import 'core/services/app_config_service.dart';
import 'core/socket/socket_service.dart';
import 'app.dart';

@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {}

  // If message contains a notification payload, Android OS system tray renders it
  // automatically via default_notification_channel_id.
  // For data-only payloads delivered when app is terminated/backgrounded, display
  // via FlutterLocalNotificationsPlugin to ensure guaranteed delivery:
  try {
    if (message.notification == null && message.data.isNotEmpty) {
      final title = (message.data['title'] as String?) ?? 'MyOnlineJoker';
      final body = (message.data['body'] as String?) ?? '';
      if (title.isNotEmpty || body.isNotEmpty) {
        final localNotifs = FlutterLocalNotificationsPlugin();
        const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
        await localNotifs.initialize(const InitializationSettings(android: androidInit));

        final channelId = (message.data['channel_id'] as String?) ?? 'myonlinejoker_notifications_v2';
        await localNotifs.show(
          message.hashCode,
          title,
          body,
          NotificationDetails(
            android: AndroidNotificationDetails(
              channelId,
              'Notifications',
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

class _AppLifecycleMonitor extends WidgetsBindingObserver {
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      MonitorService.instance.enqueue({
        'event_type': 'lifecycle',
        'properties': {'state': state.name},
      });
    } else if (state == AppLifecycleState.resumed) {
      MonitorService.instance.enqueue({
        'event_type': 'lifecycle',
        'properties': {'state': 'resumed'},
      });
    }
  }
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 1. Hive local storage
  try {
    await Hive.initFlutter();
    await Hive.openBox('settings');
    await Hive.openBox('wallet');
  } catch (e) {
    if (kDebugMode) debugPrint('[main] Hive init error: $e');
  }

  // 2. App Config Service
  try {
    await AppConfigService.init();
    // Allow remote config to run in background
    AppConfigService.fetchRemoteConfig().catchError((e) {
      if (kDebugMode) debugPrint('[main] AppConfigService background fetch error: $e');
    });
  } catch (e) {
    if (kDebugMode) debugPrint('[main] AppConfigService init error: $e');
  }

  // 3. Locale Service
  try {
    await locale.load();
  } catch (e) {
    if (kDebugMode) debugPrint('[main] Locale load error: $e');
  }

  // 4. System orientations and UI overlay
  try {
    await SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
      DeviceOrientation.portraitDown,
    ]);
    SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
    ));
  } catch (_) {}

  // 5. Firebase (Safe optional initialization)
  bool firebaseReady = false;
  try {
    await Firebase.initializeApp();
    firebaseReady = true;

    FlutterError.onError = (errorDetails) {
      try {
        FirebaseCrashlytics.instance.recordFlutterFatalError(errorDetails);
      } catch (_) {}
    };
    PlatformDispatcher.instance.onError = (error, stack) {
      try {
        FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
      } catch (_) {}
      return true;
    };
  } catch (_) {
    // Firebase not configured or missing google-services.json
  }

  if (firebaseReady) {
    try {
      FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
      await FirebaseMessaging.instance
          .requestPermission(alert: true, badge: true, sound: true);
    } catch (_) {}
  }

  // 6. Monitor & Analytics SDK
  try {
    await MonitorService.instance.init();
    WidgetsBinding.instance.addObserver(_AppLifecycleMonitor());

    final prevFlutterErrorHandler = FlutterError.onError;
    FlutterError.onError = (FlutterErrorDetails details) {
      try {
        MonitorService.instance.enqueue({
          'event_type': 'error',
          'screen': MonitorService.instance.currentScreen,
          'error_message': details.exceptionAsString().substring(
              0, details.exceptionAsString().length.clamp(0, 500)),
          'properties': {
            'stack': details.stack?.toString().substring(
                  0, details.stack.toString().length.clamp(0, 1000)) ?? '',
            'source': 'flutter_error',
          },
        });
      } catch (_) {}

      if (kDebugMode) {
        FlutterError.presentError(details);
      } else {
        prevFlutterErrorHandler?.call(details);
      }
    };

    PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
      try {
        MonitorService.instance.enqueue({
          'event_type': 'error',
          'screen': MonitorService.instance.currentScreen,
          'error_message': error.toString().substring(
              0, error.toString().length.clamp(0, 500)),
          'properties': {
            'stack': stack.toString().substring(
                  0, stack.toString().length.clamp(0, 1000)),
            'source': 'platform_dispatcher',
          },
        });
      } catch (_) {}
      return true;
    };
  } catch (e) {
    if (kDebugMode) debugPrint('[main] MonitorService init error: $e');
  }

  // 7. Sockets and Realtime Reload Service
  try {
    SocketMonitorWrapper(SocketService());
    ConfigReloadService().init();
  } catch (e) {
    if (kDebugMode) debugPrint('[main] Socket/Config services error: $e');
  }

  // 8. Always launch the app
  runApp(const MyOnlineJokerApp());
}
