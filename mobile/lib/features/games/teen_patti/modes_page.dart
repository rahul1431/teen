import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';
import 'history_page.dart';

class TeenPattiModesPage extends StatefulWidget {
  const TeenPattiModesPage({super.key});
  @override
  State<TeenPattiModesPage> createState() => _TeenPattiModesPageState();
}

class _TeenPattiModesPageState extends State<TeenPattiModesPage> {
  String? _balance;

  @override
  void initState() {
    super.initState();
    _loadBalance();
  }

  Future<void> _loadBalance() async {
    try {
      final res = await ApiClient().dio.get('/api/wallet/balance');
      if (!mounted) return;
      setState(() => _balance =
          double.parse(res.data['real_balance'].toString()).toStringAsFixed(0));
    } catch (_) {/* offline / no auth — leave as '—' */}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Teen Patti'),
        actions: [
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
                child: Text('₹${_balance ?? '—'}',
                    style: const TextStyle(
                        color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 13)),
              ),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text('Choose a Mode',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          const Text('Pick how you want to play',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          const SizedBox(height: 20),

          // Classic is the flagship variant — promoted to a wide hero tile so
          // the remaining 4 modes divide evenly into a 2x2 grid below.
          _heroModeCard(
            title: 'Classic',
            rule: 'Standard Teen Patti',
            icon: Icons.style_rounded,
            gradient: AppColors.teenPattiGrad,
            onTap: () => context.push('/games/teen-patti/lobby?variation=classic'),
          ),
          const SizedBox(height: 14),

          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 14,
            crossAxisSpacing: 14,
            childAspectRatio: 0.92,
            children: [
              _modeCard(
                title: 'AK47',
                rule: 'WILD · A K 4 7',
                iconWidget: _wildRanksBadge(),
                gradient: AppColors.premiumGrad,
                onTap: () => context.push('/games/teen-patti/lobby?variation=ak47'),
              ),
              _modeCard(
                title: 'No Limit',
                rule: 'NO POT CAP',
                icon: Icons.all_inclusive_rounded,
                gradient: const [Color(0xFF2196F3), Color(0xFF0D47A1)],
                onTap: () => context.push('/games/teen-patti/lobby?variation=no_limit'),
              ),
              _modeCard(
                title: 'Muflis',
                rule: 'LOWEST WINS',
                icon: Icons.trending_down_rounded,
                gradient: const [Color(0xFF00C853), Color(0xFF064E3B)],
                onTap: () => context.push('/games/teen-patti/lobby?variation=muflis'),
              ),
              _modeCard(
                title: 'Joker',
                rule: 'RANDOM WILD',
                icon: Icons.casino_rounded,
                gradient: const [Color(0xFF9C27B0), Color(0xFF4A148C)],
                onTap: () => context.push('/games/teen-patti/lobby?variation=joker'),
              ),
            ],
          ),
          const SizedBox(height: 20),
          // History — full-width shortcut to past games across all modes
          GestureDetector(
            onTap: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const TeenPattiHistoryPage())),
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: AppColors.gold.withValues(alpha: 0.5), width: 1.5),
              ),
              child: Row(
                children: [
                  Container(
                    width: 48, height: 48,
                    decoration: BoxDecoration(
                        color: AppColors.gold.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(14)),
                    child: const Icon(Icons.history_rounded, color: AppColors.gold, size: 28),
                  ),
                  const SizedBox(width: 14),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: const [
                      Text('History',
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                      SizedBox(height: 2),
                      Text('Your past Teen Patti games',
                          style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
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

  // Circular glass icon badge shared by the hero and grid cards — replaces
  // the old flat black-square icon container.
  Widget _iconBadge(Widget child, {double size = 52}) => Container(
        width: size, height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: [
            Colors.white.withValues(alpha: 0.22),
            Colors.white.withValues(alpha: 0.06),
          ]),
          border: Border.all(color: Colors.white.withValues(alpha: 0.35), width: 1.2),
          boxShadow: [
            BoxShadow(color: Colors.black.withValues(alpha: 0.25), blurRadius: 8, offset: const Offset(0, 3)),
          ],
        ),
        child: Center(child: child),
      );

  // AK47's signature element: rather than a generic sparkle icon, show the
  // four wild ranks themselves — the icon encodes the actual rule.
  Widget _wildRanksBadge() => SizedBox(
        width: 30, height: 30,
        child: GridView.count(
          crossAxisCount: 2,
          mainAxisSpacing: 2,
          crossAxisSpacing: 2,
          physics: const NeverScrollableScrollPhysics(),
          children: const [
            _RankChip('A'), _RankChip('K'), _RankChip('4'), _RankChip('7'),
          ],
        ),
      );

  Widget _rulePill(String rule) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.28),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
        ),
        child: Text(rule,
            style: TextStyle(
                fontSize: 9.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.6,
                color: Colors.white.withValues(alpha: 0.9))),
      );

  Widget _heroModeCard({
    required String title,
    required String rule,
    required IconData icon,
    required List<Color> gradient,
    required VoidCallback onTap,
  }) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          height: 118,
          decoration: BoxDecoration(
            gradient: LinearGradient(
                begin: Alignment.topLeft, end: Alignment.bottomRight, colors: gradient),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: AppColors.gold.withValues(alpha: 0.6), width: 1.5),
            boxShadow: [
              BoxShadow(color: gradient.last.withValues(alpha: 0.5), blurRadius: 18, offset: const Offset(0, 8)),
            ],
          ),
          child: Stack(
            children: [
              // Oversized watermark icon for depth — the hero's visual anchor.
              Positioned(
                right: -14, bottom: -14,
                child: Icon(icon, size: 110, color: Colors.white.withValues(alpha: 0.10)),
              ),
              Padding(
                padding: const EdgeInsets.all(18),
                child: Row(
                  children: [
                    _iconBadge(Icon(icon, color: Colors.white, size: 30), size: 58),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.gold.withValues(alpha: 0.9),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: const Text('MOST PLAYED',
                                style: TextStyle(
                                    fontSize: 9,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: 0.8,
                                    color: Colors.black)),
                          ),
                          const SizedBox(height: 8),
                          Text(title,
                              style: const TextStyle(
                                  fontSize: 22, fontWeight: FontWeight.w900, color: Colors.white)),
                          const SizedBox(height: 6),
                          _rulePill(rule),
                        ],
                      ),
                    ),
                    Icon(Icons.chevron_right_rounded,
                        color: Colors.white.withValues(alpha: 0.8), size: 26),
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
    IconData? icon,
    Widget? iconWidget,
    required List<Color> gradient,
    required VoidCallback onTap,
  }) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
                begin: Alignment.topLeft, end: Alignment.bottomRight, colors: gradient),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.gold.withValues(alpha: 0.5), width: 1.5),
            boxShadow: [
              BoxShadow(color: gradient.last.withValues(alpha: 0.5), blurRadius: 16, offset: const Offset(0, 6)),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _iconBadge(iconWidget ?? Icon(icon, color: Colors.white, size: 26)),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w900, color: Colors.white,
                            shadows: [Shadow(color: Colors.black38, blurRadius: 4)])),
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

// Tiny rank chip used only inside the AK47 wild-ranks badge.
class _RankChip extends StatelessWidget {
  final String rank;
  const _RankChip(this.rank);
  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.22),
          borderRadius: BorderRadius.circular(4),
        ),
        alignment: Alignment.center,
        child: Text(rank,
            style: const TextStyle(
                fontSize: 9, fontWeight: FontWeight.w900, color: Colors.white)),
      );
}
