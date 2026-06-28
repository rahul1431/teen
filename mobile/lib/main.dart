import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:flutter/foundation.dart';
import 'core/monitor/monitor_service.dart';
import 'core/monitor/socket_monitor_wrapper.dart';
import 'core/socket/socket_service.dart';
import 'app.dart';

@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
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
  await Hive.initFlutter();
  await Hive.openBox('settings');
  await Hive.openBox('wallet');

  // Lock to portrait mode
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
  ));

  // Firebase — optional. If google-services.json isn't bundled, every
  // Firebase call (including FirebaseMessaging.instance) throws, so guard all
  // of it behind a single flag and never let it crash startup.
  bool firebaseReady = false;
  try {
    await Firebase.initializeApp();
    firebaseReady = true;
  } catch (_) {
    // Firebase not configured — continue without push notifications.
  }

  if (firebaseReady) {
    try {
      FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
      await FirebaseMessaging.instance
          .requestPermission(alert: true, badge: true, sound: true);
    } catch (_) {
      // Messaging unavailable — ignore.
    }
  }

  // ── App Monitor SDK ──────────────────────────────────────────────────────
  // Init MonitorService before runApp so the session_id exists from the first frame.
  await MonitorService.instance.init();

  // Register lifecycle observer to emit session end events
  WidgetsBinding.instance.addObserver(_AppLifecycleMonitor());

  // Override Flutter framework errors (widget build exceptions, layout errors, etc.)
  final prevFlutterErrorHandler = FlutterError.onError;
  FlutterError.onError = (FlutterErrorDetails details) {
    MonitorService.instance.enqueue({
      'event_type': 'error',
      'screen': MonitorService.instance.currentScreen,
      'error_message': details.exceptionAsString()
          .substring(0, details.exceptionAsString().length.clamp(0, 500)),
      'properties': {
        'stack': details.stack?.toString().substring(
              0, details.stack.toString().length.clamp(0, 1000)) ?? '',
        'source': 'flutter_error',
      },
    });
    if (kDebugMode) {
      FlutterError.presentError(details);
    } else {
      prevFlutterErrorHandler?.call(details);
    }
  };

  // Override platform/isolate errors (async exceptions not caught by Flutter framework)
  PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
    MonitorService.instance.enqueue({
      'event_type': 'error',
      'screen': MonitorService.instance.currentScreen,
      'error_message': error.toString()
          .substring(0, error.toString().length.clamp(0, 500)),
      'properties': {
        'stack': stack.toString().substring(
              0, stack.toString().length.clamp(0, 1000)),
        'source': 'platform_dispatcher',
      },
    });
    return true; // handled
  };

  // Attach WebSocket event monitoring (no changes to SocketService required)
  // ignore: unused_local_variable — listener is kept alive by ValueNotifier reference
  final socketMonitorWrapper = SocketMonitorWrapper(SocketService());
  // ─────────────────────────────────────────────────────────────────────────

  runApp(const MyOnlineJokerApp());
}
