import 'package:flutter/material.dart';
import '../../../shared/theme/app_theme.dart';
import 'lottery_draws_page.dart';
import 'lottery_scratch_page.dart';
import 'lottery_daily_page.dart';

// ─────────────────────────────────────────────────────────────────────────────
//  Lottery Page — top-level menu of the four lottery types
// ─────────────────────────────────────────────────────────────────────────────
class LotteryPage extends StatelessWidget {
  const LotteryPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF03070A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF03070A),
        elevation: 0,
        leading: const BackButton(color: AppColors.gold),
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('🎰', style: TextStyle(fontSize: 18)),
            SizedBox(width: 6),
            Text('LOTTERY',
                style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 2.5,
                    color: AppColors.goldLight)),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _typeCard(
            context,
            title: 'Daily Lottery',
            subtitle: 'Tier-based draws — multiple chances daily',
            icon: Icons.calendar_today_rounded,
            color: Colors.cyanAccent,
            onTap: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const LotteryDailyPage())),
          ),
          const SizedBox(height: 16),
          _typeCard(
            context,
            title: 'Instant Lottery',
            subtitle: 'Scratch cards — win instantly',
            icon: Icons.auto_awesome_rounded,
            color: Colors.purpleAccent,
            onTap: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const LotteryScratchPage())),
          ),
          const SizedBox(height: 16),
          _typeCard(
            context,
            title: 'Weekly Lottery',
            subtitle: 'Pick a 4-digit number',
            icon: Icons.event_repeat_rounded,
            color: Colors.lightBlueAccent,
            onTap: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => const LotteryDrawsPage(
                        category: 'weekly', title: 'Weekly Lottery'))),
          ),
          const SizedBox(height: 16),
          _typeCard(
            context,
            title: 'Monthly Lottery',
            subtitle: 'Bigger jackpots, monthly draw',
            icon: Icons.calendar_month_rounded,
            color: AppColors.gold,
            onTap: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => const LotteryDrawsPage(
                        category: 'monthly', title: 'Monthly Lottery'))),
          ),
        ],
      ),
    );
  }

  Widget _typeCard(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: const Color(0xFF11161C),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(14)),
              child: Icon(icon, color: color, size: 26),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.w900)),
                  const SizedBox(height: 4),
                  Text(subtitle,
                      style: TextStyle(
                          color: AppColors.textSecondary.withValues(alpha: 0.8),
                          fontSize: 12,
                          fontWeight: FontWeight.w600)),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, color: color.withValues(alpha: 0.6)),
          ],
        ),
      ),
    );
  }
}
