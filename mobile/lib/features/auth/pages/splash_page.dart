import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:go_router/go_router.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../shared/theme/app_theme.dart';

class SplashPage extends StatefulWidget {
  const SplashPage({super.key});
  @override
  State<SplashPage> createState() => _SplashPageState();
}

class _SplashPageState extends State<SplashPage> {
  @override
  void initState() {
    super.initState();
    _navigate();
  }

  Future<void> _navigate() async {
    await Future.delayed(const Duration(milliseconds: 2200));
    if (!mounted) return;
    final token = await SecureStorage.getAccessToken();
    if (mounted) context.go(token != null ? '/home' : '/auth/login');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 96, height: 96,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppColors.gold, AppColors.goldLight],
                  begin: Alignment.topLeft, end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(24),
                boxShadow: [BoxShadow(color: AppColors.gold.withOpacity(0.5), blurRadius: 32, spreadRadius: 4)],
              ),
              child: const Icon(Icons.style_rounded, size: 52, color: Colors.black),
            )
            .animate()
            .scale(begin: const Offset(0.4, 0.4), curve: Curves.elasticOut, duration: 800.ms)
            .fadeIn(duration: 400.ms),
            const SizedBox(height: 20),
            const Text('MyOnlineJoker',
              style: TextStyle(fontSize: 30, fontWeight: FontWeight.w900, color: AppColors.gold, letterSpacing: 1),
            )
            .animate(delay: 300.ms)
            .fadeIn(duration: 500.ms)
            .slideY(begin: 0.3, end: 0),
            const SizedBox(height: 8),
            const Text('Play. Win. Repeat.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 14, letterSpacing: 2),
            )
            .animate(delay: 500.ms)
            .fadeIn(duration: 500.ms),
            const SizedBox(height: 48),
            SizedBox(
              width: 32, height: 32,
              child: CircularProgressIndicator(
                color: AppColors.gold.withOpacity(0.5),
                strokeWidth: 2,
              ),
            )
            .animate(delay: 800.ms)
            .fadeIn(duration: 400.ms),
          ],
        ),
      ),
    );
  }
}
