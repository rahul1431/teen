import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'core/storage/secure_storage.dart';
import 'core/monitor/monitor_navigator_observer.dart';
import 'core/services/push_notification_service.dart';
import 'shared/theme/app_theme.dart';
import 'features/auth/pages/splash_page.dart';
import 'features/auth/pages/login_page.dart';
import 'features/auth/pages/register_page.dart';
import 'features/auth/pages/otp_page.dart';
import 'features/auth/pages/offline_demo_page.dart';
import 'features/home/home_page.dart';
import 'features/wallet/wallet_page.dart';
import 'features/games/teen_patti/modes_page.dart';
import 'features/games/teen_patti/lobby_page.dart';
import 'features/games/teen_patti/game_page.dart';
import 'features/games/teen_patti/friends_lobby_page.dart';
import 'features/games/aviator/aviator_page.dart';
import 'features/games/ludo/ludo_modes_page.dart';
import 'features/games/ludo/ludo_lobby_page.dart';
import 'features/games/ludo/ludo_game_page.dart';
import 'features/games/betting/matka_page.dart';
import 'features/games/betting/lottery_page.dart';
import 'features/games/betting/cricket_page.dart';
import 'features/leaderboard/leaderboard_page.dart';
import 'features/profile/profile_page.dart';
import 'features/notifications/notifications_page.dart';
import 'features/referral/referral_page.dart';
import 'features/daily_bonus/daily_bonus_page.dart';

final GoRouter _router = GoRouter(
  initialLocation: '/splash',
  observers: [MonitorNavigatorObserver()],
  redirect: (context, state) async {
    final token = await SecureStorage.getAccessToken();
    final isAuth = token != null;
    final isPublic = state.matchedLocation.startsWith('/auth') ||
        state.matchedLocation == '/splash' ||
        state.matchedLocation.endsWith('/demo') ||
        state.matchedLocation.endsWith('/practice');
    if (!isAuth && !isPublic) return '/auth/login';
    // Register/refresh FCM push token on every authenticated navigation
    if (isAuth && !isPublic) {
      PushNotificationService.instance.init(_router);
    }
    return null;
  },
  routes: [
    GoRoute(path: '/splash', builder: (_, __) => const SplashPage()),
    GoRoute(path: '/auth/login', builder: (_, __) => const LoginPage()),
    GoRoute(path: '/auth/offline-demo', builder: (_, __) => const OfflineDemoPage()),
    GoRoute(path: '/auth/register', builder: (_, state) => RegisterPage(phone: state.uri.queryParameters['phone'] ?? '', otp: state.uri.queryParameters['otp'] ?? '')),
    GoRoute(path: '/auth/otp', builder: (_, state) => OtpPage(phone: state.uri.queryParameters['phone'] ?? '')),
    GoRoute(path: '/home', builder: (_, __) => const HomePage()),
    GoRoute(path: '/wallet', builder: (_, __) => const WalletPage()),
    GoRoute(path: '/notifications', builder: (_, __) => const NotificationsPage()),
    GoRoute(path: '/games/teen-patti', builder: (_, __) => const TeenPattiModesPage()),
    GoRoute(path: '/games/teen-patti/lobby', builder: (_, s) => TeenPattiLobbyPage(variation: s.uri.queryParameters['variation'] ?? 'classic')),
    GoRoute(path: '/games/teen-patti/friends', builder: (_, s) => TeenPattiFriendsPage(
      mode: s.uri.queryParameters['mode'] ?? 'join',
      stake: double.tryParse(s.uri.queryParameters['stake'] ?? '') ?? 10,
    )),
    GoRoute(
      path: '/games/teen-patti/play/:roomId',
      pageBuilder: (context, state) => NoTransitionPage(
        child: TeenPattiGamePage(
          roomId: state.pathParameters['roomId']!,
          initialData: state.extra as Map<String, dynamic>?,
        ),
      ),
    ),
    GoRoute(
      path: '/games/teen-patti/demo',
      pageBuilder: (context, state) => const NoTransitionPage(
        child: TeenPattiGamePage(roomId: 'DEMO', demo: true),
      ),
    ),
    GoRoute(path: '/games/aviator', builder: (_, __) => const AviatorPage()),
    GoRoute(path: '/games/ludo', builder: (_, __) => const LudoModesPage()),
    GoRoute(path: '/games/ludo/lobby', builder: (_, s) => LudoLobbyPage(privateMode: s.uri.queryParameters['private'], privateCode: s.uri.queryParameters['code'])),
    GoRoute(path: '/games/ludo/practice', builder: (_, __) => const LudoGamePage(offline: true)),
    GoRoute(path: '/games/ludo/play/:roomId', builder: (_, s) => LudoGamePage(roomId: s.pathParameters['roomId']!, initialData: s.extra as Map<String, dynamic>?)),
    GoRoute(path: '/games/matka', builder: (_, __) => const MatkaPage()),
    GoRoute(path: '/games/lottery', builder: (_, __) => const LotteryPage()),
    GoRoute(path: '/games/cricket', builder: (_, __) => const CricketPage()),
    GoRoute(path: '/leaderboard', builder: (_, __) => const LeaderboardPage()),
    GoRoute(path: '/profile', builder: (_, __) => const ProfilePage()),
    GoRoute(path: '/referral', builder: (_, __) => const ReferralPage()),
    GoRoute(path: '/daily-bonus', builder: (_, __) => const DailyBonusPage()),
  ],
);

class MyOnlineJokerApp extends StatelessWidget {
  const MyOnlineJokerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'MyOnlineJoker',
      theme: AppTheme.dark,
      routerConfig: _router,
      debugShowCheckedModeBanner: false,
    );
  }
}
