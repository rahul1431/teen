import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';

/// Unified "My Bets" history for the betting games. [type] selects which
/// endpoint and row layout to use. Cricket has no market-odds betting
/// anymore (removed in favor of Dream11-style fantasy contests, which have
/// their own "My Contests"/"My Teams" history in cricket_page.dart).
enum BettingType { matka, lottery }

class BettingHistoryPage extends StatefulWidget {
  final BettingType type;
  const BettingHistoryPage({super.key, required this.type});
  @override
  State<BettingHistoryPage> createState() => _BettingHistoryPageState();
}

class _BettingHistoryPageState extends State<BettingHistoryPage> {
  List<dynamic> _items = [];
  bool _loading = true;

  String get _title => switch (widget.type) {
        BettingType.matka => 'My Matka Bets',
        BettingType.lottery => 'My Lottery Tickets',
      };

  String get _endpoint => switch (widget.type) {
        BettingType.matka => '/api/betting/matka/my-bets',
        BettingType.lottery => '/api/betting/lottery/my-tickets',
      };

  String get _key => widget.type == BettingType.lottery ? 'tickets' : 'bets';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiClient().dio.get(_endpoint);
      if (!mounted) return;
      setState(() {
        _items = res.data[_key] ?? [];
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_title)),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.gold))
          : RefreshIndicator(
              onRefresh: _load,
              child: _items.isEmpty
                  ? ListView(children: const [
                      Padding(
                        padding: EdgeInsets.only(top: 80),
                        child: Center(
                            child: Text('No bets yet',
                                style:
                                    TextStyle(color: AppColors.textSecondary))),
                      ),
                    ])
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 10),
                      itemBuilder: (_, i) => _row(_items[i]),
                    ),
            ),
    );
  }

  Widget _row(dynamic b) {
    final (title, subtitle, status, payout) = switch (widget.type) {
      BettingType.matka => (
          '${b['market_name']} · ${_label(b['bet_type'])}',
          'No. ${b['number']} · ${b['session']} · ₹${_n(b['amount'])}',
          b['status'] as String? ?? 'pending',
          _n(b['payout']),
        ),
      BettingType.lottery => (
          '${b['draw_name']} · #${b['ticket_number']}',
          'Win no. ${b['winning_number'] ?? '—'} · ₹${_n(b['amount'])}',
          (b['is_winner'] == true)
              ? 'won'
              : (b['draw_status'] == 'settled' ? 'lost' : 'pending'),
          _n(b['prize']),
        ),
    };

    final color = switch (status) {
      'won' => AppColors.green,
      'lost' => AppColors.red,
      'void' => AppColors.orange,
      _ => AppColors.textSecondary,
    };

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, fontSize: 14)),
                const SizedBox(height: 3),
                Text(subtitle,
                    style: const TextStyle(
                        color: AppColors.textSecondary, fontSize: 12)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(8)),
                child: Text(status.toUpperCase(),
                    style: TextStyle(
                        color: color,
                        fontSize: 10,
                        fontWeight: FontWeight.bold)),
              ),
              if (status == 'won' || status == 'void') ...[
                const SizedBox(height: 4),
                Text('+₹${payout.toStringAsFixed(0)}',
                    style: TextStyle(
                        color: color,
                        fontWeight: FontWeight.bold,
                        fontSize: 13)),
              ],
            ],
          ),
        ],
      ),
    );
  }

  double _n(dynamic v) => double.tryParse(v?.toString() ?? '0') ?? 0;
  String _label(dynamic t) => (t?.toString() ?? '').replaceAll('_', ' ');
}
