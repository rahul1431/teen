import 'package:flutter/material.dart';
import '../../../shared/theme/app_theme.dart';
import 'lottery_draws_page.dart';
import 'lottery_scratch_page.dart';

// ─────────────────────────────────────────────────────────────────────────────
//  Lottery Page — top-level menu of the four lottery types
// ─────────────────────────────────────────────────────────────────────────────
class LotteryPage extends StatefulWidget {
  const LotteryPage({super.key});

  @override
  State<LotteryPage> createState() => _LotteryPageState();
}

class _LotteryPageState extends State<LotteryPage> with TickerProviderStateMixin {
  late final AnimationController _enterCtrl;
  late final AnimationController _pulseCtrl;

  @override
  void initState() {
    super.initState();
    _enterCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 800));
    _pulseCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat(reverse: true);
    _enterCtrl.forward();
  }

  @override
  void dispose() {
    _enterCtrl.dispose();
    _pulseCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF03070A),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
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
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF03070A), Color(0xFF0D1219)],
          ),
        ),
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            _buildAnimatedCard(
              index: 0,
              title: 'Daily Lottery',
              subtitle: 'Pick a 4-digit number',
              icon: Icons.calendar_today_rounded,
              color: Colors.cyanAccent,
              onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                      builder: (_) => const LotteryDrawsPage(
                          category: 'daily', title: 'Daily Lottery'))),
            ),
            const SizedBox(height: 16),
            _buildAnimatedCard(
              index: 1,
              title: 'Instant Lottery',
              subtitle: 'Scratch cards — win instantly',
              icon: Icons.auto_awesome_rounded,
              color: Colors.purpleAccent,
              onTap: () => Navigator.push(context,
                  MaterialPageRoute(builder: (_) => const LotteryScratchPage())),
            ),
            const SizedBox(height: 16),
            _buildAnimatedCard(
              index: 2,
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
            _buildAnimatedCard(
              index: 3,
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
      ),
    );
  }

  Widget _buildAnimatedCard({
    required int index,
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
    required VoidCallback onTap,
  }) {
    // Staggered animation values
    final start = index * 0.15;
    final end = start + 0.5;
    final slideCurve = CurvedAnimation(
      parent: _enterCtrl,
      curve: Interval(start, end > 1.0 ? 1.0 : end, curve: Curves.easeOutCubic),
    );

    return AnimatedBuilder(
      animation: _enterCtrl,
      builder: (context, child) {
        return Opacity(
          opacity: slideCurve.value,
          child: Transform.translate(
            offset: Offset(0, 30 * (1 - slideCurve.value)),
            child: _TypeCard(
              title: title,
              subtitle: subtitle,
              icon: icon,
              color: color,
              pulseAnimation: _pulseCtrl,
              onTap: onTap,
            ),
          ),
        );
      },
    );
  }
}

class _TypeCard extends StatefulWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
  final Animation<double> pulseAnimation;
  final VoidCallback onTap;

  const _TypeCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.color,
    required this.pulseAnimation,
    required this.onTap,
  });

  @override
  State<_TypeCard> createState() => _TypeCardState();
}

class _TypeCardState extends State<_TypeCard> {
  bool _isPressed = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => setState(() => _isPressed = true),
      onTapUp: (_) => setState(() => _isPressed = false),
      onTapCancel: () => setState(() => _isPressed = false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _isPressed ? 0.96 : 1.0,
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOutCubic,
        child: Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                widget.color.withValues(alpha: 0.15),
                const Color(0xFF11161C),
              ],
            ),
            border: Border.all(
              color: widget.color.withValues(alpha: _isPressed ? 0.6 : 0.3),
              width: 1.5,
            ),
            boxShadow: [
              BoxShadow(
                color: widget.color.withValues(alpha: 0.1),
                blurRadius: 15,
                spreadRadius: 1,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            children: [
              AnimatedBuilder(
                animation: widget.pulseAnimation,
                builder: (context, child) {
                  return Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: widget.color.withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: widget.color.withValues(alpha: 0.2 * widget.pulseAnimation.value),
                          blurRadius: 12 * widget.pulseAnimation.value,
                          spreadRadius: 2 * widget.pulseAnimation.value,
                        ),
                      ],
                    ),
                    child: Icon(widget.icon, color: widget.color, size: 28),
                  );
                }
              ),
              const SizedBox(width: 18),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(widget.title,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            letterSpacing: 0.5,
                            fontWeight: FontWeight.w900)),
                    const SizedBox(height: 6),
                    Text(widget.subtitle,
                        style: TextStyle(
                            color: AppColors.textSecondary, // Note: Cannot use withValues if const, but textSecondary is a color. Removed withValues for simplicity, wait let's use color property in TextStyle properly
                            fontSize: 13,
                            fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: widget.color.withValues(alpha: 0.7), size: 28),
            ],
          ),
        ),
      ),
    );
  }
}
