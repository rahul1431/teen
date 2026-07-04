import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/services/balance_service.dart';
import '../theme/app_theme.dart';

/// Persistent chrome around the five main tabs: a fixed top bar (brand,
/// live wallet balance chip, notifications bell) and the bottom nav.
/// Fullscreen routes (gameplay etc.) are registered outside the shell.
class AppShell extends StatelessWidget {
  final StatefulNavigationShell navigationShell;
  const AppShell({super.key, required this.navigationShell});

  void _goBranch(int index) {
    navigationShell.goBranch(index,
        initialLocation: index == navigationShell.currentIndex);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _TopBar(onWalletTap: () => _goBranch(2)),
            Expanded(child: navigationShell),
          ],
        ),
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(top: BorderSide(color: AppColors.border, width: 0.5)),
        ),
        child: BottomNavigationBar(
          currentIndex: navigationShell.currentIndex,
          onTap: _goBranch,
          type: BottomNavigationBarType.fixed,
          backgroundColor: Colors.transparent,
          elevation: 0,
          selectedItemColor: AppColors.gold,
          unselectedItemColor: AppColors.textSecondary,
          selectedFontSize: 11,
          unselectedFontSize: 11,
          items: const [
            BottomNavigationBarItem(icon: Icon(Icons.home_rounded), label: 'Home'),
            BottomNavigationBarItem(icon: Icon(Icons.casino_rounded), label: 'Games'),
            BottomNavigationBarItem(icon: Icon(Icons.account_balance_wallet_rounded), label: 'Wallet'),
            BottomNavigationBarItem(icon: Icon(Icons.emoji_events_rounded), label: 'Leaders'),
            BottomNavigationBarItem(icon: Icon(Icons.person_rounded), label: 'Profile'),
          ],
        ),
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  final VoidCallback onWalletTap;
  const _TopBar({required this.onWalletTap});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 10, 10),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(bottom: BorderSide(color: AppColors.border, width: 0.5)),
      ),
      child: Row(
        children: [
          // Brand
          const Text('🃏', style: TextStyle(fontSize: 22)),
          const SizedBox(width: 8),
          const Text('MyOnlineJoker',
              style: TextStyle(
                color: AppColors.gold,
                fontSize: 17,
                fontWeight: FontWeight.w900,
                letterSpacing: 0.3,
              )),
          const Spacer(),
          // Live balance chip
          GestureDetector(
            onTap: onWalletTap,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.gold.withOpacity(0.12),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: AppColors.gold.withOpacity(0.4)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.account_balance_wallet_rounded,
                      color: AppColors.gold, size: 15),
                  const SizedBox(width: 5),
                  ValueListenableBuilder<double>(
                    valueListenable: BalanceService.instance.real,
                    builder: (_, bal, __) => Text(
                      formatCurrency(bal),
                      style: const TextStyle(
                        color: AppColors.gold,
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  const Icon(Icons.add_circle_rounded, color: AppColors.gold, size: 15),
                ],
              ),
            ),
          ),
          const SizedBox(width: 4),
          IconButton(
            onPressed: () => context.push('/notifications'),
            icon: const Icon(Icons.notifications_rounded,
                color: AppColors.textSecondary, size: 22),
          ),
        ],
      ),
    );
  }
}
