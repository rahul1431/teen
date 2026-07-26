import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/services/balance_service.dart';
import '../../core/services/notification_service.dart';
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
            BottomNavigationBarItem(
                icon: Icon(Icons.home_rounded), label: 'Home'),
            BottomNavigationBarItem(
                icon: Icon(Icons.casino_rounded), label: 'Games'),
            BottomNavigationBarItem(
                icon: Icon(Icons.account_balance_wallet_rounded),
                label: 'Wallet'),
            BottomNavigationBarItem(
                icon: Icon(Icons.emoji_events_rounded), label: 'Leaders'),
            BottomNavigationBarItem(
                icon: Icon(Icons.person_rounded), label: 'Profile'),
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
                color: AppColors.gold.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(20),
                border:
                    Border.all(color: AppColors.gold.withValues(alpha: 0.4)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.account_balance_wallet_rounded,
                      color: AppColors.gold, size: 15),
                  const SizedBox(width: 5),
                  // Total balance = real (deposits + winnings) + bonus
                  AnimatedBuilder(
                    animation: Listenable.merge([
                      BalanceService.instance.real,
                      BalanceService.instance.bonus,
                    ]),
                    builder: (_, __) => Text(
                      formatCurrency(BalanceService.instance.real.value +
                          BalanceService.instance.bonus.value),
                      style: const TextStyle(
                        color: AppColors.gold,
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  const Icon(Icons.add_circle_rounded,
                      color: AppColors.gold, size: 15),
                ],
              ),
            ),
          ),
          const SizedBox(width: 4),
          const _NotificationBell(),
        ],
      ),
    );
  }
}

/// Bell icon with a live unread-count badge. The count refreshes when the
/// shell first builds and again after the user returns from the
/// notifications page (where items get marked read).
class _NotificationBell extends StatefulWidget {
  const _NotificationBell();

  @override
  State<_NotificationBell> createState() => _NotificationBellState();
}

class _NotificationBellState extends State<_NotificationBell> {
  @override
  void initState() {
    super.initState();
    NotificationService.instance.refresh();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: NotificationService.instance.unreadCount,
      builder: (_, count, __) => Stack(
        clipBehavior: Clip.none,
        children: [
          IconButton(
            onPressed: () async {
              await context.push('/notifications');
              NotificationService.instance.refresh();
            },
            icon: const Icon(Icons.notifications_rounded,
                color: AppColors.textSecondary, size: 22),
          ),
          if (count > 0)
            Positioned(
              right: 6,
              top: 4,
              child: IgnorePointer(
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                  constraints:
                      const BoxConstraints(minWidth: 16, minHeight: 16),
                  decoration: BoxDecoration(
                    color: AppColors.red,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.surface, width: 1.5),
                  ),
                  child: Text(
                    count > 99 ? '99+' : '$count',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 9,
                      fontWeight: FontWeight.w800,
                      height: 1.2,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
