import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';
import '../../../shared/services/lottery_daily_service.dart';

class LotteryDailyMyTicketsTab extends StatefulWidget {
  const LotteryDailyMyTicketsTab({super.key});

  @override
  State<LotteryDailyMyTicketsTab> createState() => _LotteryDailyMyTicketsTabState();
}

class _LotteryDailyMyTicketsTabState extends State<LotteryDailyMyTicketsTab> {
  late final LotteryDailyService _service;
  List<dynamic> _tickets = [];
  List<dynamic> _draws = [];
  Map<String, dynamic> _tiersMap = {};
  bool _loading = true;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _service = LotteryDailyService(ApiClient().dio);
    _loadData();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() => _loading = true);
    try {
      final ticketsRes = await _service.getMyTickets();
      final drawsRes = await _service.getDraws();
      final tiersRes = await _service.getTiers();

      if (!mounted) return;

      // Build tier map for quick lookup
      final tMap = <String, dynamic>{};
      for (final tier in tiersRes) {
        tMap[tier['id']?.toString() ?? ''] = tier;
      }

      // Filter for only open draws
      final openDraws = (drawsRes as List)
          .where((d) {
            final drawTime = DateTime.tryParse(d['draw_time']?.toString() ?? '');
            if (drawTime == null) return false;
            return drawTime.isAfter(DateTime.now());
          })
          .toList();

      setState(() {
        _tickets = ticketsRes as List;
        _draws = openDraws;
        _tiersMap = tMap;
        _loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  String _countdown(DateTime? dt) {
    if (dt == null) return '--:--:--';
    final diff = dt.difference(DateTime.now());
    if (diff.isNegative) return 'Drawing Now!';
    final h = diff.inHours;
    final m = diff.inMinutes % 60;
    final s = diff.inSeconds % 60;
    if (h > 0) {
      return '${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
    }
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  String _fmtDt(DateTime dt) {
    final now = DateTime.now();
    final prefix = (dt.day == now.day && dt.month == now.month) ? 'Today' : '${dt.day}/${dt.month}';
    return '$prefix ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  // Group tickets by tier
  Map<String, List<dynamic>> _groupedByTier() {
    final groups = <String, List<dynamic>>{};
    for (final ticket in _tickets) {
      final tierId = ticket['tier_id']?.toString() ?? 'unknown';
      groups.putIfAbsent(tierId, () => []).add(ticket);
    }
    return groups;
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    }

    if (_tickets.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.confirmation_num_outlined,
                size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text('No tickets yet',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Buy a ticket from Browse',
                style: TextStyle(color: AppColors.textSecondary.withValues(alpha: 0.45), fontSize: 12)),
            const SizedBox(height: 24),
            TextButton.icon(
              onPressed: _loadData,
              icon: const Icon(Icons.refresh_rounded, size: 16),
              label: const Text('Refresh'),
              style: TextButton.styleFrom(
                foregroundColor: AppColors.gold,
                side: BorderSide(color: AppColors.gold.withValues(alpha: 0.35)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              ),
            ),
          ],
        ),
      );
    }

    final grouped = _groupedByTier();

    return RefreshIndicator(
      onRefresh: _loadData,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        itemCount: grouped.length,
        itemBuilder: (_, i) {
          final tierId = grouped.keys.elementAt(i);
          final tierTickets = grouped[tierId]!;
          final tierInfo = _tiersMap[tierId];
          return _tierSection(tierId, tierInfo, tierTickets);
        },
      ),
    );
  }

  Widget _tierSection(String tierId, dynamic tierInfo, List<dynamic> tickets) {
    final tierName = tierInfo?['name']?.toString() ?? 'Tier $tierId';
    final tierColor = _getTierColor(tierId);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Tier Header
        Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: tierColor.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: tierColor.withValues(alpha: 0.35)),
          ),
          child: Row(
            children: [
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  color: tierColor,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Text(tierName,
                  style: TextStyle(
                      color: tierColor,
                      fontWeight: FontWeight.w900,
                      fontSize: 13,
                      letterSpacing: 0.5)),
              const Spacer(),
              Text('${tickets.length} ticket${tickets.length != 1 ? 's' : ''}',
                  style: TextStyle(
                      color: tierColor.withValues(alpha: 0.7),
                      fontWeight: FontWeight.w600,
                      fontSize: 11)),
            ],
          ),
        ),
        // Tickets in this tier
        ...tickets.map((ticket) => _ticketCard(ticket)).toList(),
        const SizedBox(height: 16),
      ],
    );
  }

  Widget _ticketCard(dynamic ticket) {
    final ticketNum = ticket['ticket_number']?.toString() ?? '';
    final drawId = ticket['draw_id']?.toString() ?? '';
    final drawTime = DateTime.tryParse(ticket['draw_time']?.toString() ?? '');
    final isWinner = ticket['is_winner'] == true;
    final isLoser = ticket['is_winner'] == false;
    final status = ticket['status']?.toString() ?? 'pending';
    final prize = double.tryParse(ticket['prize']?.toString() ?? '0') ?? 0;

    // Find draw info
    final draw = _draws.cast<Map>().firstWhere(
      (d) => d['id'].toString() == drawId,
      orElse: () => <String, dynamic>{},
    );

    final drawName = draw['name']?.toString() ?? 'Daily Lottery';

    Color statusColor;
    String statusLabel;
    IconData statusIcon;

    if (isWinner && prize > 0) {
      statusColor = AppColors.green;
      statusLabel = 'WON';
      statusIcon = Icons.emoji_events_rounded;
    } else if (isLoser) {
      statusColor = AppColors.textSecondary;
      statusLabel = 'LOST';
      statusIcon = Icons.close_rounded;
    } else if (status == 'pending' || status == 'active') {
      statusColor = AppColors.gold;
      statusLabel = 'PENDING';
      statusIcon = Icons.schedule_rounded;
    } else {
      statusColor = const Color(0xFF2DD4BF);
      statusLabel = 'WAITING';
      statusIcon = Icons.hourglass_bottom_rounded;
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        boxShadow: isWinner
            ? [BoxShadow(color: AppColors.green.withValues(alpha: 0.1), blurRadius: 8, offset: const Offset(0, 3))]
            : [BoxShadow(color: Colors.black.withValues(alpha: 0.1), blurRadius: 8, offset: const Offset(0, 3))],
      ),
      child: Container(
        decoration: BoxDecoration(
          color: isWinner ? AppColors.green.withValues(alpha: 0.04) : AppColors.cardBg,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: isWinner
                ? AppColors.green.withValues(alpha: 0.4)
                : isLoser
                    ? AppColors.border.withValues(alpha: 0.4)
                    : AppColors.gold.withValues(alpha: 0.15),
            width: isWinner ? 1.5 : 1.0,
          ),
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(drawName,
                          style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 12.5,
                              color: Colors.white)),
                      const SizedBox(height: 4),
                      Text('Ticket: $ticketNum',
                          style: TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 15,
                              color: isWinner ? AppColors.green : AppColors.goldLight,
                              letterSpacing: 1.2)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: statusColor.withValues(alpha: 0.35)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(statusIcon, color: statusColor, size: 13),
                      const SizedBox(width: 4),
                      Text(statusLabel,
                          style: TextStyle(
                              color: statusColor,
                              fontSize: 10,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 0.5)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            // Countdown or result
            if (drawTime != null)
              Row(
                children: [
                  Icon(
                    isWinner || isLoser ? Icons.check_circle_rounded : Icons.av_timer_rounded,
                    size: 12,
                    color: isWinner ? AppColors.green : (isLoser ? AppColors.textSecondary : AppColors.gold),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      isWinner || isLoser
                          ? 'Draw: ${_fmtDt(drawTime)}'
                          : 'Closes in ${_countdown(drawTime)}',
                      style: TextStyle(
                          color: AppColors.textSecondary.withValues(alpha: 0.65),
                          fontSize: 11,
                          fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            // Prize if won
            if (isWinner && prize > 0) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AppColors.green.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.green.withValues(alpha: 0.3)),
                ),
                child: Text(
                  'Won ₹${prize.toStringAsFixed(0)}! 🎉',
                  style: const TextStyle(
                      color: AppColors.green,
                      fontWeight: FontWeight.w900,
                      fontSize: 12),
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Color _getTierColor(String tierId) {
    // Map tier IDs to colors for visual distinction
    final tierInfo = _tiersMap[tierId];
    if (tierInfo == null) return AppColors.gold;

    final tierName = tierInfo['name']?.toString().toLowerCase() ?? '';
    if (tierName.contains('gold') || tierName.contains('premium')) return AppColors.gold;
    if (tierName.contains('silver')) return const Color(0xFFC0C0C0);
    if (tierName.contains('bronze')) return const Color(0xFFCD7F32);
    if (tierName.contains('diamond')) return const Color(0xFF2DD4BF);
    if (tierName.contains('platinum')) return const Color(0xFFE5E4E2);

    // Fallback to tier order
    return [
      AppColors.gold,
      const Color(0xFF2DD4BF),
      const Color(0xFF0D9488),
    ][int.tryParse(tierId) ?? 0 % 3];
  }
}
