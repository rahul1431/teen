import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'core/storage/secure_storage.dart';
import 'core/services/push_notification_service.dart';
import 'shared/theme/app_theme.dart';
import 'features/auth/pages/splash_page.dart';
import 'features/auth/pages/login_page.dart';
import 'features/auth/pages/register_page.dart';
import 'features/auth/pages/otp_page.dart';
import 'features/home/home_page.dart';
import 'features/wallet/wallet_page.dart';
import 'features/games/teen_patti/lobby_page.dart';
import 'features/games/teen_patti/game_page.dart';
import 'features/games/aviator/aviator_page.dart';
import 'features/leaderboard/leaderboard_page.dart';
import 'features/profile/profile_page.dart';
import 'features/notifications/notifications_page.dart';

final GoRouter _router = GoRouter(
  initialLocation: '/splash',
  redirect: (context, state) async {
    final token = await SecureStorage.getAccessToken();
    final isAuth = token != null;
    final isPublic = state.matchedLocation.startsWith('/auth') ||
        state.matchedLocation == '/splash' ||
        state.matchedLocation.endsWith('/demo');
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
    GoRoute(path: '/auth/register', builder: (_, state) => RegisterPage(phone: state.uri.queryParameters['phone'] ?? '', otp: state.uri.queryParameters['otp'] ?? '')),
    GoRoute(path: '/auth/otp', builder: (_, state) => OtpPage(phone: state.uri.queryParameters['phone'] ?? '')),
    GoRoute(path: '/home', builder: (_, __) => const HomePage()),
    GoRoute(path: '/wallet', builder: (_, __) => const WalletPage()),
    GoRoute(path: '/notifications', builder: (_, __) => const NotificationsPage()),
    GoRoute(path: '/games/teen-patti', builder: (_, __) => const TeenPattiLobbyPage()),
    GoRoute(path: '/games/teen-patti/play/:roomId', builder: (_, s) => TeenPattiGamePage(roomId: s.pathParameters['roomId']!)),
    GoRoute(path: '/games/teen-patti/demo', builder: (_, __) => const TeenPattiGamePage(roomId: 'DEMO', demo: true)),
    GoRoute(path: '/games/aviator', builder: (_, __) => const AviatorPage()),
    GoRoute(path: '/leaderboard', builder: (_, __) => const LeaderboardPage()),
    GoRoute(path: '/profile', builder: (_, __) => const ProfilePage()),
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
