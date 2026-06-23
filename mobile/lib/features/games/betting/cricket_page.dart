import 'package:flutter/material.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';
import 'betting_history_page.dart';

/// Cricket betting — IPL / T20 / ICC and more. Each match exposes markets
/// (match winner, top batsman, …) with odds; tap an option to place a bet.
class CricketPage extends StatefulWidget {
  const CricketPage({super.key});
  @override
  State<CricketPage> createState() => _CricketPageState();
}

class _CricketPageState extends State<CricketPage> {
  List<dynamic> _matches = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiClient().dio.get('/api/betting/cricket/matches');
      if (!mounted) return;
      setState(() {
        _matches = res.data['matches'] ?? [];
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Cricket Betting'), actions: [
        IconButton(
          icon: const Icon(Icons.receipt_long_rounded),
          tooltip: 'My Bets',
          onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(
                  builder: (_) =>
                      const BettingHistoryPage(type: BettingType.cricket))),
        ),
      ]),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_matches.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 60),
                      child: Center(
                          child: Text('No matches available right now',
                              style: TextStyle(color: AppColors.textSecondary))),
                    ),
                  ..._matches.map(_matchCard),
                ],
              ),
            ),
    );
  }

  Widget _matchCard(dynamic m) {
    final markets = (m['markets'] as List?) ?? [];
    final live = m['status'] == 'live';
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.green.withOpacity(0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                  colors: AppColors.cricketGrad,
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight),
              borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${m['series']} · ${(m['format'] ?? '').toString().toUpperCase()}',
                          style: TextStyle(
                              color: Colors.white.withOpacity(0.85),
                              fontSize: 11)),
                      const SizedBox(height: 4),
                      Text('${m['team_a']}  vs  ${m['team_b']}',
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 16,
                              fontWeight: FontWeight.w900)),
                      const SizedBox(height: 2),
                      Text(_fmt(m['start_time']),
                          style: TextStyle(
                              color: Colors.white.withOpacity(0.8),
                              fontSize: 11)),
                    ],
                  ),
                ),
                if (live)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                        color: AppColors.red,
                        borderRadius: BorderRadius.circular(8)),
                    child: const Text('LIVE',
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 10,
                            fontWeight: FontWeight.bold)),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: markets.map<Widget>((mk) => _market(m, mk)).toList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _market(dynamic match, dynamic mk) {
    final options = (mk['options'] as List?) ?? [];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(mk['label'] ?? '',
            style: const TextStyle(
                fontWeight: FontWeight.w700, fontSize: 13)),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: options.map<Widget>((o) {
            return GestureDetector(
              onTap: () {
                SoundService.instance.play(Sfx.buttonTap);
                _betSheet(match, mk, o);
              },
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.white10,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.green.withOpacity(0.5)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(o['label'] ?? '',
                        style: const TextStyle(
                            color: Colors.white, fontWeight: FontWeight.w600)),
                    const SizedBox(width: 8),
                    Text('${o['odds']}',
                        style: const TextStyle(
                            color: AppColors.goldLight,
                            fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
            );
          }).toList(),
        ),
        const SizedBox(height: 14),
      ],
    );
  }

  String _fmt(dynamic iso) {
    final dt = DateTime.tryParse(iso?.toString() ?? '');
    if (dt == null) return '';
    return '${dt.day}/${dt.month} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  void _betSheet(dynamic match, dynamic market, dynamic option) {
    double amount = 50;
    bool submitting = false;
    String? error;
    final odds = double.tryParse(option['odds'].toString()) ?? 1;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 18,
              bottom: MediaQuery.of(ctx).viewInsets.bottom + 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${match['team_a']} vs ${match['team_b']}',
                  style: const TextStyle(
                      fontSize: 15, fontWeight: FontWeight.w900)),
              const SizedBox(height: 4),
              Text('${market['label']} → ${option['label']}  @ ${option['odds']}',
                  style: const TextStyle(color: AppColors.textSecondary)),
              const SizedBox(height: 16),
              const Text('Stake', style: TextStyle(color: AppColors.textSecondary)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [50, 100, 500, 1000].map((v) {
                  return ChoiceChip(
                    label: Text('₹$v'),
                    selected: amount == v.toDouble(),
                    onSelected: (_) => setSheet(() => amount = v.toDouble()),
                  );
                }).toList(),
              ),
              const SizedBox(height: 12),
              Text('Potential return: ₹${(amount * odds).toStringAsFixed(0)}',
                  style: const TextStyle(
                      color: AppColors.goldLight, fontWeight: FontWeight.bold)),
              if (error != null) ...[
                const SizedBox(height: 8),
                Text(error!, style: const TextStyle(color: AppColors.red)),
              ],
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: submitting
                      ? null
                      : () async {
                          setSheet(() {
                            submitting = true;
                            error = null;
                          });
                          try {
                            await ApiClient().dio.post(
                                '/api/betting/cricket/bet',
                                data: {
                                  'market_id': market['id'],
                                  'option_key': option['key'],
                                  'amount': amount,
                                });
                            SoundService.instance.play(Sfx.chipBet);
                            if (!ctx.mounted) return;
                            Navigator.pop(ctx);
                            ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                    content: Text('Bet placed!'),
                                    backgroundColor: AppColors.green));
                          } catch (e) {
                            setSheet(() {
                              submitting = false;
                              error = e.toString().contains('Insufficient')
                                  ? 'Insufficient balance'
                                  : 'Could not place bet';
                            });
                          }
                        },
                  style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.gold,
                      minimumSize: const Size.fromHeight(50)),
                  child: Text('Bet ₹${amount.toInt()}',
                      style: const TextStyle(
                          color: Colors.black, fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
