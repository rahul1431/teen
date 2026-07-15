import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/audio/sound_service.dart';
import '../../../shared/theme/app_theme.dart';
import 'lottery_daily_buy_sheet.dart';

class LotteryDailyBrowseTab extends StatefulWidget {
  const LotteryDailyBrowseTab({super.key});

  @override
  State<LotteryDailyBrowseTab> createState() => _LotteryDailyBrowseTabState();
}

class _LotteryDailyBrowseTabState extends State<LotteryDailyBrowseTab> {
  List<dynamic> _tiers = [];
  List<dynamic> _draws = [];
  double _balance = 0;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadTiers();
  }

  Future<void> _loadTiers() async {
    if (!mounted) return;
    setState(() => _loading = true);
    try {
      final res = await ApiClient().dio.get('/api/betting/lottery/daily/tiers');
      if (!mounted) return;
      final tiers = (res.data['tiers'] as List<dynamic>?) ?? [];

      // Load draws to get next draw times
      final drawsRes = await ApiClient().dio.get('/api/betting/lottery/daily/draws');
      final draws = (drawsRes.data['draws'] as List<dynamic>?) ?? [];

      // Load balance
      final balanceRes = await ApiClient().dio.get('/api/wallet/balance');
      final balance = double.tryParse(balanceRes.data['real_balance'].toString()) ?? 0;

      setState(() {
        _tiers = tiers;
        _draws = draws;
        _balance = balance;
        _loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() => _loading = false);
        AppSnackBar.show(context, 'Failed to load tiers', error: true);
      }
    }
  }

  String? _getNextDrawTime(String tierId) {
    try {
      final tierDraws = _draws
          .where((d) => d['tier_id'] == tierId && (d['status'] == 'open' || d['status'] == 'calling'))
          .toList();

      if (tierDraws.isEmpty) return null;

      final draw = tierDraws.first;
      final drawTime = DateTime.parse(draw['draw_time'].toString());
      final now = DateTime.now();

      if (drawTime.isBefore(now)) return null;

      final duration = drawTime.difference(now);

      if (duration.inHours > 0) {
        return '${duration.inHours}h ${duration.inMinutes % 60}m';
      } else if (duration.inMinutes > 0) {
        return '${duration.inMinutes}m ${duration.inSeconds % 60}s';
      } else {
        return '${duration.inSeconds}s';
      }
    } catch (_) {
      return null;
    }
  }

  String? _getCurrentDrawId(String tierId) {
    try {
      final tierDraws = _draws
          .where((d) => d['tier_id'] == tierId && (d['status'] == 'open' || d['status'] == 'calling'))
          .toList();

      if (tierDraws.isEmpty) return null;
      return tierDraws.first['id'];
    } catch (_) {
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.gold),
      );
    }

    if (_tiers.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.auto_awesome_rounded, size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text(
              'No lottery tiers available',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: _loadTiers,
              child: const Text('Refresh'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadTiers,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: GridView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 1,
          childAspectRatio: 1.2,
          mainAxisSpacing: 16,
        ),
        itemCount: _tiers.length,
        itemBuilder: (_, i) => _TierCard(
          tier: _tiers[i],
          nextDrawTime: _getNextDrawTime(_tiers[i]['id']),
          drawId: _getCurrentDrawId(_tiers[i]['id']),
          onBuy: () => _showBuySheet(_tiers[i]),
        ),
      ),
    );
  }

  void _showBuySheet(dynamic tier) {
    SoundService.instance.play(Sfx.buttonTap);
    final drawId = _getCurrentDrawId(tier['id']);
    final draw = _draws.firstWhere(
      (d) => d['id'] == drawId,
      orElse: () => {'id': drawId, 'name': 'Daily Lottery'},
    );
    final price = double.tryParse(tier['amount']?.toString() ?? '0') ?? 0;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF03070A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => LotteryDailyBuySheet(
        draw: draw,
        price: price,
        balance: _balance,
        onPurchased: () {
          _loadTiers();
        },
      ),
    );
  }
}

class _TierCard extends StatelessWidget {
  final dynamic tier;
  final String? nextDrawTime;
  final String? drawId;
  final VoidCallback onBuy;

  const _TierCard({
    required this.tier,
    required this.nextDrawTime,
    required this.drawId,
    required this.onBuy,
  });

  @override
  Widget build(BuildContext context) {
    final amount = tier['amount'] ?? 0;
    final prizeTiers = (tier['default_prize_tiers'] as List<dynamic>?) ?? [];

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        gradient: const LinearGradient(
          colors: [Color(0xFF0D5F5F), Color(0xFF072A4A)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(
          color: AppColors.gold.withValues(alpha: 0.3),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.gold.withValues(alpha: 0.1),
            blurRadius: 12,
            spreadRadius: 0,
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Tier Amount Header
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Ticket Price',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '₹$amount',
                      style: const TextStyle(
                        fontSize: 36,
                        fontWeight: FontWeight.w900,
                        color: AppColors.goldLight,
                        letterSpacing: 1.2,
                      ),
                    ),
                  ],
                ),
                Icon(
                  Icons.auto_awesome_rounded,
                  color: AppColors.goldLight,
                  size: 40,
                ),
              ],
            ),
            const SizedBox(height: 16),

            // Next Draw Countdown
            if (nextDrawTime != null) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: AppColors.gold.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: AppColors.gold.withValues(alpha: 0.3),
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.schedule_rounded,
                      color: AppColors.goldLight,
                      size: 16,
                    ),
                    const SizedBox(width: 8),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Next Draw In',
                          style: TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          nextDrawTime!,
                          style: const TextStyle(
                            color: AppColors.goldLight,
                            fontSize: 13,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],

            // Prize Tiers
            if (prizeTiers.isNotEmpty) ...[
              const Text(
                'Prize Tiers',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: prizeTiers
                    .map((pt) => _PrizeBadge(prizeTier: pt))
                    .toList(),
              ),
              const SizedBox(height: 16),
            ],

            // Buy Button
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: drawId != null ? onBuy : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.gold,
                  foregroundColor: Colors.black,
                  disabledBackgroundColor: AppColors.textSecondary.withValues(alpha: 0.3),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  elevation: 2,
                ),
                child: const Text(
                  'Buy Ticket',
                  style: TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 15,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PrizeBadge extends StatelessWidget {
  final dynamic prizeTier;

  const _PrizeBadge({required this.prizeTier});

  @override
  Widget build(BuildContext context) {
    final matchType = _formatMatchType(prizeTier['match_type'] ?? 'unknown');
    final multiplier = prizeTier['multiplier'] ?? 1;
    final outcomeType = prizeTier['outcome_type'] ?? 'cash';

    final bgColor = outcomeType == 'cash' ? AppColors.green : AppColors.orange;
    final displayText = multiplier is int
        ? '$matchType: ${multiplier}x'
        : '$matchType: ${multiplier.toStringAsFixed(1)}x';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: bgColor.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: bgColor.withValues(alpha: 0.4),
          width: 1,
        ),
      ),
      child: Text(
        displayText,
        style: TextStyle(
          color: bgColor,
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.3,
        ),
      ),
    );
  }

  String _formatMatchType(String type) {
    final map = {
      'exact': 'Exact',
      'last_3': 'Last 3',
      'last_2': 'Last 2',
      'last_1': 'Last 1',
    };
    return map[type] ?? type;
  }
}
