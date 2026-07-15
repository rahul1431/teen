import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';

class LotteryDailyHistoryTab extends StatefulWidget {
  const LotteryDailyHistoryTab({super.key});

  @override
  State<LotteryDailyHistoryTab> createState() => _LotteryDailyHistoryTabState();
}

class _LotteryDailyHistoryTabState extends State<LotteryDailyHistoryTab> {
  List<dynamic> _draws = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    if (!mounted) return;
    setState(() => _loading = true);
    try {
      final res = await ApiClient().dio.get('/api/betting/lottery/daily/history');
      if (!mounted) return;
      setState(() {
        _draws = (res.data['draws'] as List<dynamic>?) ?? [];
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _loading = false);
        AppSnackBar.show(context, 'Failed to load history', error: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.gold),
      );
    }

    if (_draws.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.history_rounded, size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text(
              'No draw history yet',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              'Settled draws will appear here',
              style: TextStyle(
                color: AppColors.textSecondary.withValues(alpha: 0.6),
                fontSize: 13,
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadHistory,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        itemCount: _draws.length,
        itemBuilder: (_, i) => _DrawCard(draw: _draws[i]),
      ),
    );
  }
}

class _DrawCard extends StatelessWidget {
  final dynamic draw;

  const _DrawCard({required this.draw});

  @override
  Widget build(BuildContext context) {
    final drawDate = draw['draw_date'] ?? '—';
    final drawTime = draw['draw_time'] ?? '—';
    final winningNumber = draw['winning_number'] ?? '—';
    final status = (draw['status'] ?? 'unknown').toString().toUpperCase();
    final amount = draw['amount'] ?? 0;
    final ticketCount = draw['ticket_count'] ?? 0;

    final statusColor = status == 'SETTLED' ? AppColors.green : AppColors.gold;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: statusColor.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: statusColor.withValues(alpha: 0.2),
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Draw Date',
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '$drawDate',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: statusColor.withValues(alpha: 0.4),
                  ),
                ),
                child: Text(
                  status,
                  style: TextStyle(
                    color: statusColor,
                    fontWeight: FontWeight.w700,
                    fontSize: 11,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Draw Time
          Row(
            children: [
              Icon(Icons.schedule_rounded, size: 14, color: AppColors.textSecondary),
              const SizedBox(width: 6),
              Text(
                'Draw Time: $drawTime',
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 12,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),

          // Winning Number
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.gold.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: AppColors.gold.withValues(alpha: 0.3),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Winning Number',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  winningNumber,
                  style: const TextStyle(
                    color: AppColors.goldLight,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 2,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Tier & Ticket Count
          Row(
            children: [
              Icon(Icons.monetization_on_rounded, size: 14, color: AppColors.textSecondary),
              const SizedBox(width: 6),
              Text(
                'Tier: ₹$amount',
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 12,
                ),
              ),
              const SizedBox(width: 16),
              Icon(Icons.confirmation_num_rounded, size: 14, color: AppColors.textSecondary),
              const SizedBox(width: 6),
              Text(
                '$ticketCount tickets',
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
