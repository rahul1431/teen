import 'package:flutter/material.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';

/// Satta Matka — pick a market, bet single/jodi/panna numbers, view your bets.
class MatkaPage extends StatefulWidget {
  const MatkaPage({super.key});
  @override
  State<MatkaPage> createState() => _MatkaPageState();
}

class _MatkaPageState extends State<MatkaPage> {
  List<dynamic> _markets = [];
  Map<String, dynamic> _multipliers = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiClient().dio.get('/api/betting/matka/markets');
      if (!mounted) return;
      setState(() {
        _markets = res.data['markets'] ?? [];
        _multipliers = Map<String, dynamic>.from(res.data['multipliers'] ?? {});
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Matka')),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_markets.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 60),
                      child: Center(
                          child: Text('No markets open right now',
                              style: TextStyle(color: AppColors.textSecondary))),
                    ),
                  ..._markets.map(_marketCard),
                ],
              ),
            ),
    );
  }

  Widget _marketCard(dynamic m) {
    final status = m['status'] as String? ?? 'open';
    final settled = status == 'settled';
    final result = m['jodi'] != null
        ? 'Result: ${m['open_panna'] ?? '***'}-${m['open_digit'] ?? '*'}${m['close_digit'] ?? '*'}-${m['close_panna'] ?? '***'}'
        : m['open_panna'] != null
            ? 'Open: ${m['open_panna']}-${m['open_digit']}'
            : 'Betting open';
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
            colors: AppColors.matkaGrad,
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
            Row(
              children: [
                Expanded(
                  child: Text(m['name'] ?? 'Market',
                      style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                          color: Colors.white)),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                      color: settled ? Colors.black38 : AppColors.green,
                      borderRadius: BorderRadius.circular(8)),
                  child: Text(settled ? 'CLOSED' : 'OPEN',
                      style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: Colors.white)),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text('${m['open_time']} – ${m['close_time']}',
                style: TextStyle(
                    color: Colors.white.withOpacity(0.8), fontSize: 12)),
            const SizedBox(height: 8),
            Text(result,
                style: const TextStyle(
                    color: AppColors.goldLight,
                    fontWeight: FontWeight.bold,
                    fontSize: 14)),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: settled
                    ? null
                    : () {
                        SoundService.instance.play(Sfx.buttonTap);
                        _openBetSheet(m);
                      },
                style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.gold,
                    disabledBackgroundColor: Colors.white24),
                child: Text(settled ? 'Closed for today' : 'Place Bet',
                    style: const TextStyle(
                        color: Colors.black, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _openBetSheet(dynamic market) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _MatkaBetSheet(
        market: market,
        multipliers: _multipliers,
        onPlaced: _load,
      ),
    );
  }
}

class _MatkaBetSheet extends StatefulWidget {
  final dynamic market;
  final Map<String, dynamic> multipliers;
  final VoidCallback onPlaced;
  const _MatkaBetSheet(
      {required this.market, required this.multipliers, required this.onPlaced});
  @override
  State<_MatkaBetSheet> createState() => _MatkaBetSheetState();
}

class _MatkaBetSheetState extends State<_MatkaBetSheet> {
  String _betType = 'single';
  String _session = 'open';
  final _numberCtrl = TextEditingController();
  double _amount = 10;
  bool _submitting = false;
  String? _error;

  final _types = const [
    ['single', 'Single (0-9)'],
    ['jodi', 'Jodi (00-99)'],
    ['single_panna', 'Single Panna'],
    ['double_panna', 'Double Panna'],
    ['triple_panna', 'Triple Panna'],
  ];

  int get _maxLen => _betType == 'single' ? 1 : _betType == 'jodi' ? 2 : 3;

  Future<void> _submit() async {
    final number = _numberCtrl.text.trim();
    if (number.length != _maxLen) {
      setState(() => _error = 'Enter a $_maxLen-digit number');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient().dio.post('/api/betting/matka/bet', data: {
        'market_id': widget.market['id'],
        'bet_type': _betType,
        'session': _session,
        'number': number,
        'amount': _amount,
      });
      SoundService.instance.play(Sfx.chipBet);
      if (!mounted) return;
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Bet placed!'), backgroundColor: AppColors.green));
      widget.onPlaced();
    } catch (e) {
      setState(() {
        _submitting = false;
        _error = e.toString().contains('Insufficient')
            ? 'Insufficient balance'
            : 'Could not place bet';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final mult = widget.multipliers[_betType]?.toString() ?? '';
    return Padding(
      padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 18,
          bottom: MediaQuery.of(context).viewInsets.bottom + 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${widget.market['name']} — Place Bet',
              style:
                  const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
          const SizedBox(height: 14),
          const Text('Bet Type', style: TextStyle(color: AppColors.textSecondary)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _types.map((t) {
              final sel = _betType == t[0];
              return GestureDetector(
                onTap: () => setState(() {
                  _betType = t[0];
                  _numberCtrl.clear();
                }),
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: sel ? AppColors.gold : Colors.white10,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(t[1],
                      style: TextStyle(
                          color: sel ? Colors.black : Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w600)),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 14),
          Row(children: [
            const Text('Session: ', style: TextStyle(color: AppColors.textSecondary)),
            ...['open', 'close'].map((s) => Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(s),
                    selected: _session == s,
                    onSelected: (_) => setState(() => _session = s),
                  ),
                )),
          ]),
          const SizedBox(height: 14),
          TextField(
            controller: _numberCtrl,
            keyboardType: TextInputType.number,
            maxLength: _maxLen,
            decoration: InputDecoration(
              labelText: 'Number ($_maxLen digit${_maxLen > 1 ? 's' : ''})',
              counterText: '',
            ),
          ),
          const SizedBox(height: 10),
          const Text('Amount', style: TextStyle(color: AppColors.textSecondary)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [10, 50, 100, 500].map((v) {
              final sel = _amount == v.toDouble();
              return ChoiceChip(
                label: Text('₹$v'),
                selected: sel,
                onSelected: (_) => setState(() => _amount = v.toDouble()),
              );
            }).toList(),
          ),
          const SizedBox(height: 12),
          if (mult.isNotEmpty)
            Text('Potential win: ₹${(_amount * (double.tryParse(mult) ?? 0)).toStringAsFixed(0)} (${mult}x)',
                style: const TextStyle(
                    color: AppColors.goldLight, fontWeight: FontWeight.bold)),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: AppColors.red)),
          ],
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _submitting ? null : _submit,
              style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.gold,
                  minimumSize: const Size.fromHeight(50)),
              child: _submitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.black))
                  : Text('Bet ₹${_amount.toInt()}',
                      style: const TextStyle(
                          color: Colors.black, fontWeight: FontWeight.bold)),
            ),
          ),
        ],
      ),
    );
  }
}
