import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/services/app_config_service.dart';
import '../../../shared/theme/app_theme.dart';
import 'rummy_history_page.dart';

class RummyModesPage extends StatefulWidget {
  const RummyModesPage({super.key});

  @override
  State<RummyModesPage> createState() => _RummyModesPageState();
}

class _RummyModesPageState extends State<RummyModesPage> {
  String? _balance;

  @override
  void initState() {
    super.initState();
    _loadBalance();
  }

  Future<void> _loadBalance() async {
    if (AppConfigService.isSafeMode()) return;
    try {
      final res = await ApiClient().dio.get('/api/wallet/balance');
      if (!mounted) return;
      setState(() => _balance =
          double.parse(res.data['real_balance'].toString()).toStringAsFixed(0));
    } catch (_) {
      // offline / no auth — leave as '—'
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Indian Rummy'),
        actions: [
          if (!AppConfigService.isSafeMode())
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                  decoration: BoxDecoration(
                    color: AppColors.feltDark,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.gold.withValues(alpha: 0.6)),
                  ),
                  child: Text(
                    AppConfigService.getSafeBalanceText(_balance),
                    style: const TextStyle(
                      color: AppColors.gold,
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'Choose a Mode',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 4),
          const Text(
            '13-Card Indian Rummy formats',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 20),

          // Points Rummy is the flagship variant — wide hero card at the top
          _heroModeCard(
            title: 'Points Rummy',
            rule: AppConfigService.isSafeMode() ? 'FAST 1-DEAL · PRACTICE' : 'FAST 1-DEAL · CASH PER POINT',
            icon: Icons.flash_on_rounded,
            badgeText: 'MOST POPULAR',
            gradient: AppColors.rummyGrad,
            onTap: () {
              if (AppConfigService.isSafeMode()) {
                context.push('/games/rummy/practice');
              } else {
                context.push('/games/rummy/lobby?variation=points');
              }
            },
          ),
          const SizedBox(height: 14),

          // 2x2 Grid of Pool & Deals formats
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 14,
            crossAxisSpacing: 14,
            childAspectRatio: 0.92,
            children: [
              _modeCard(
                title: 'Pool 101',
                rule: 'ELIMINATE @ 101 PTS',
                icon: Icons.shield_rounded,
                gradient: const [Color(0xFF0D9488), Color(0xFF0F766E), Color(0xFF115E59)],
                onTap: () {
                  if (AppConfigService.isSafeMode()) {
                    context.push('/games/rummy/practice');
                  } else {
                    context.push('/games/rummy/lobby?variation=pool101');
                  }
                },
              ),
              _modeCard(
                title: 'Pool 201',
                rule: 'ELIMINATE @ 201 PTS',
                icon: Icons.military_tech_rounded,
                gradient: const [Color(0xFF2563EB), Color(0xFF1D4ED8), Color(0xFF1E40AF)],
                onTap: () {
                  if (AppConfigService.isSafeMode()) {
                    context.push('/games/rummy/practice');
                  } else {
                    context.push('/games/rummy/lobby?variation=pool201');
                  }
                },
              ),
              _modeCard(
                title: 'Deals Rummy',
                rule: 'BEST OF 2 / 3 DEALS',
                icon: Icons.layers_rounded,
                gradient: const [Color(0xFF7C3AED), Color(0xFF6D28D9), Color(0xFF4C1D95)],
                onTap: () {
                  if (AppConfigService.isSafeMode()) {
                    context.push('/games/rummy/practice');
                  } else {
                    context.push('/games/rummy/lobby?variation=deals');
                  }
                },
              ),
              _modeCard(
                title: 'Practice Table',
                rule: 'FREE · PLAY WITH BOTS',
                icon: Icons.school_rounded,
                gradient: const [Color(0xFF059669), Color(0xFF047857), Color(0xFF064E3B)],
                onTap: () => context.push('/games/rummy/practice'),
              ),
            ],
          ),
          const SizedBox(height: 20),

          // History shortcut
          GestureDetector(
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const RummyHistoryPage()),
            ),
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: AppColors.gold.withValues(alpha: 0.5),
                  width: 1.5,
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: AppColors.gold.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(
                      Icons.history_rounded,
                      color: AppColors.gold,
                      size: 28,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: const [
                      Text(
                        'Rummy History',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Your past scorecards & payouts',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                  const Spacer(),
                  const Icon(Icons.chevron_right_rounded, color: AppColors.gold),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _iconBadge(Widget child, {double size = 52}) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: [
            Colors.white.withValues(alpha: 0.22),
            Colors.white.withValues(alpha: 0.06),
          ]),
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.35),
            width: 1.2,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.25),
              blurRadius: 8,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Center(child: child),
      );

  Widget _rulePill(String rule) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.28),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
        ),
        child: Text(
          rule,
          style: TextStyle(
            fontSize: 9.5,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.6,
            color: Colors.white.withValues(alpha: 0.9),
          ),
        ),
      );

  Widget _heroModeCard({
    required String title,
    required String rule,
    required IconData icon,
    required String badgeText,
    required List<Color> gradient,
    required VoidCallback onTap,
  }) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          height: 118,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: gradient,
            ),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
              color: AppColors.gold.withValues(alpha: 0.6),
              width: 1.5,
            ),
            boxShadow: [
              BoxShadow(
                color: gradient.last.withValues(alpha: 0.5),
                blurRadius: 18,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Stack(
            children: [
              Positioned(
                right: -14,
                bottom: -14,
                child: Icon(
                  icon,
                  size: 110,
                  color: Colors.white.withValues(alpha: 0.10),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(18),
                child: Row(
                  children: [
                    _iconBadge(Icon(icon, color: Colors.white, size: 30),
                        size: 58),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.gold.withValues(alpha: 0.9),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              badgeText,
                              style: const TextStyle(
                                fontSize: 9,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 0.8,
                                color: Colors.black,
                              ),
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            title,
                            style: const TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.w900,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(height: 6),
                          _rulePill(rule),
                        ],
                      ),
                    ),
                    Icon(
                      Icons.chevron_right_rounded,
                      color: Colors.white.withValues(alpha: 0.8),
                      size: 26,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );

  Widget _modeCard({
    required String title,
    required String rule,
    required IconData icon,
    required List<Color> gradient,
    required VoidCallback onTap,
  }) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: gradient,
            ),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: AppColors.gold.withValues(alpha: 0.5),
              width: 1.5,
            ),
            boxShadow: [
              BoxShadow(
                color: gradient.last.withValues(alpha: 0.5),
                blurRadius: 16,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _iconBadge(Icon(icon, color: Colors.white, size: 26)),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                        color: Colors.white,
                        shadows: [
                          Shadow(color: Colors.black38, blurRadius: 4),
                        ],
                      ),
                    ),
                    const SizedBox(height: 6),
                    _rulePill(rule),
                  ],
                ),
              ],
            ),
          ),
        ),
      );
}
