import 'package:flutter/material.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';
import 'betting_history_page.dart';

/// Lottery — buy a numbered ticket for an open draw; win big on an exact match.
class LotteryPage extends StatefulWidget {
  const LotteryPage({super.key});
  @override
  State<LotteryPage> createState() => _LotteryPageState();
}

class _LotteryPageState extends State<LotteryPage> {
  List<dynamic> _draws = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiClient().dio.get('/api/betting/lottery/draws');
      if (!mounted) return;
      setState(() {
        _draws = res.data['draws'] ?? [];
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Lottery'), actions: [
        IconButton(
          icon: const Icon(Icons.receipt_long_rounded),
          tooltip: 'My Tickets',
          onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(
                  builder: (_) =>
                      const BettingHistoryPage(type: BettingType.lottery))),
        ),
      ]),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_draws.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 60),
                      child: Center(
                          child: Text('No draws open right now',
                              style: TextStyle(color: AppColors.textSecondary))),
                    ),
                  ..._draws.map(_drawCard),
                ],
              ),
            ),
    );
  }

  Widget _drawCard(dynamic d) {
    final price = double.tryParse(d['ticket_price'].toString()) ?? 0;
    final mult = double.tryParse(d['prize_multiplier'].toString()) ?? 0;
    final digits = (d['digits'] ?? 4) as int;
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
            colors: AppColors.lotteryGrad,
            begin: Alignment.topLeft,
            end: Alignment.bottomRight),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.gold.withOpacity(0.4)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(d['name'] ?? 'Lottery Draw',
                style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    color: Colors.white)),
            const SizedBox(height: 6),
            Text('Ticket ₹${price.toStringAsFixed(0)} · Win up to ₹${(price * mult).toStringAsFixed(0)}',
                style: const TextStyle(
                    color: AppColors.goldLight, fontWeight: FontWeight.bold)),
            const SizedBox(height: 2),
            Text('Draw: ${_fmt(d['draw_time'])}',
                style: TextStyle(
                    color: Colors.white.withOpacity(0.8), fontSize: 12)),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  SoundService.instance.play(Sfx.buttonTap);
                  _buySheet(d, digits, price);
                },
                style:
                    ElevatedButton.styleFrom(backgroundColor: AppColors.gold),
                child: const Text('Buy Ticket',
                    style: TextStyle(
                        color: Colors.black, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _fmt(dynamic iso) {
    final dt = DateTime.tryParse(iso?.toString() ?? '');
    if (dt == null) return 'soon';
    return '${dt.day}/${dt.month} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  void _buySheet(dynamic draw, int digits, double price) {
    final ctrl = TextEditingController();
    String? error;
    bool submitting = false;
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
              Text('${draw['name']} — Buy Ticket',
                  style:
                      const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
              const SizedBox(height: 14),
              TextField(
                controller: ctrl,
                keyboardType: TextInputType.number,
                maxLength: digits,
                decoration: InputDecoration(
                    labelText: 'Pick your $digits-digit number',
                    counterText: ''),
              ),
              const SizedBox(height: 6),
              TextButton.icon(
                onPressed: () {
                  final r = (DateTime.now().millisecondsSinceEpoch %
                          (digits == 4 ? 10000 : 1000000))
                      .toString()
                      .padLeft(digits, '0');
                  ctrl.text = r;
                },
                icon: const Icon(Icons.shuffle_rounded, size: 18),
                label: const Text('Lucky dip'),
              ),
              if (error != null)
                Text(error!, style: const TextStyle(color: AppColors.red)),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: submitting
                      ? null
                      : () async {
                          final num = ctrl.text.trim();
                          if (num.length != digits) {
                            setSheet(() => error = 'Enter $digits digits');
                            return;
                          }
                          setSheet(() {
                            submitting = true;
                            error = null;
                          });
                          try {
                            await ApiClient().dio.post(
                                '/api/betting/lottery/buy',
                                data: {
                                  'draw_id': draw['id'],
                                  'ticket_number': num
                                });
                            SoundService.instance.play(Sfx.chipBet);
                            if (!ctx.mounted) return;
                            Navigator.pop(ctx);
                            ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                    content: Text('Ticket bought! Good luck 🍀'),
                                    backgroundColor: AppColors.green));
                          } catch (e) {
                            setSheet(() {
                              submitting = false;
                              error = e.toString().contains('Insufficient')
                                  ? 'Insufficient balance'
                                  : 'Could not buy ticket';
                            });
                          }
                        },
                  style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.gold,
                      minimumSize: const Size.fromHeight(50)),
                  child: Text('Buy for ₹${price.toStringAsFixed(0)}',
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
