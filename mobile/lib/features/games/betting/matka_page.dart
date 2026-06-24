import 'package:flutter/material.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';
import 'betting_history_page.dart';

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
      body: Container(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0, -0.2),
            radius: 1.3,
            colors: [
              Color(0xFF2E1A47), // Deep velvet purple center
              Color(0xFF140B24), // Dark deep purple
              Color(0xFF07030D), // Midnight shadow corners
            ],
            stops: [0.0, 0.6, 1.0],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              _buildAppBar(context),
              Expanded(
                child: _loading
                    ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView(
                          padding: const EdgeInsets.all(16),
                          children: [
                            if (_markets.isEmpty)
                              const Padding(
                                padding: EdgeInsets.only(top: 80),
                                child: Center(
                                    child: Text('No markets open right now',
                                        style: TextStyle(color: AppColors.textSecondary))),
                              ),
                            ..._markets.map(_marketCard),
                          ],
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAppBar(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
            onPressed: () => Navigator.of(context).pop(),
          ),
          const SizedBox(width: 4),
          const Text(
            'SATTA MATKA',
            style: TextStyle(
              color: AppColors.gold,
              fontSize: 18,
              fontWeight: FontWeight.w900,
              letterSpacing: 2,
            ),
          ),
          const Spacer(),
          IconButton(
            icon: const Icon(Icons.receipt_long_rounded, color: AppColors.gold),
            tooltip: 'My Bets',
            onPressed: () {
              SoundService.instance.play(Sfx.buttonTap);
              Navigator.push(
                  context,
                  MaterialPageRoute(
                      builder: (_) =>
                          const BettingHistoryPage(type: BettingType.matka)));
            },
          ),
        ],
      ),
    );
  }

  Widget _marketCard(dynamic m) {
    final status = m['status'] as String? ?? 'open';
    final settled = status == 'settled';
    
    final openPanna = m['open_panna']?.toString() ?? '***';
    final openDigit = m['open_digit']?.toString() ?? '*';
    final closeDigit = m['close_digit']?.toString() ?? '*';
    final closePanna = m['close_panna']?.toString() ?? '***';
    final jodi = '$openDigit$closeDigit';

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: const Color(0xFF1B1229).withOpacity(0.85), // Glassy dark purple terminal look
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: settled ? Colors.white.withOpacity(0.04) : AppColors.gold.withOpacity(0.35),
          width: settled ? 1.0 : 1.5,
        ),
        boxShadow: settled ? [] : [
          BoxShadow(
            color: AppColors.gold.withOpacity(0.05),
            blurRadius: 12,
            spreadRadius: 1,
          )
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    m['name'] ?? 'MARKET',
                    style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                        color: Colors.white,
                        letterSpacing: 0.5),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: settled ? Colors.white.withOpacity(0.08) : AppColors.green.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: settled ? Colors.white30 : AppColors.green,
                      width: 1.0,
                    ),
                  ),
                  child: Text(
                    settled ? 'CLOSED' : 'OPEN',
                    style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w900,
                        color: settled ? Colors.white60 : AppColors.green),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                const Icon(Icons.schedule_rounded, size: 13, color: AppColors.textSecondary),
                const SizedBox(width: 4),
                Text(
                  '${m['open_time']} – ${m['close_time']}',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.bold),
                ),
              ],
            ),
            const Divider(color: Colors.white10, height: 24),
            
            // Render Results inside the 3D reels
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('LATEST DRAW RESULT', 
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 9, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                  const SizedBox(height: 8),
                  _buildResultSlot(openPanna, jodi, closePanna),
                ],
              ),
            ),
            
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              height: 44,
              child: Container(
                decoration: !settled ? BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.gold.withOpacity(0.25),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ) : null,
                child: ElevatedButton(
                  onPressed: settled
                      ? null
                      : () {
                          SoundService.instance.play(Sfx.buttonTap);
                          _openBetSheet(m);
                        },
                  style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.gold,
                      foregroundColor: Colors.black,
                      disabledBackgroundColor: Colors.white.withOpacity(0.04),
                      disabledForegroundColor: Colors.white30,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      elevation: 0,
                  ),
                  child: Text(settled ? 'CLOSED FOR TODAY' : 'PLACE BET NOW',
                      style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, letterSpacing: 0.5)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildResultSlot(String panna, String jodi, String closePanna) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _slotReel(panna, isPanna: true),
        const SizedBox(width: 8),
        Container(
          height: 2, width: 12, 
          color: Colors.white24,
        ),
        const SizedBox(width: 8),
        _slotReel(jodi, isJodi: true),
        const SizedBox(width: 8),
        Container(
          height: 2, width: 12, 
          color: Colors.white24,
        ),
        const SizedBox(width: 8),
        _slotReel(closePanna, isPanna: true),
      ],
    );
  }

  Widget _slotReel(String value, {bool isPanna = false, bool isJodi = false}) {
    final chars = value.split('');
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: chars.map((char) {
        return Container(
          margin: const EdgeInsets.symmetric(horizontal: 2),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: isJodi 
                  ? [const Color(0xFFC62828), const Color(0xFF5C0000)] // Jodi gets velvet crimson
                  : [const Color(0xFF2C3E50), const Color(0xFF0F171E)], // Panna gets charcoal
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
            ),
            borderRadius: BorderRadius.circular(6),
            border: Border.all(
              color: isJodi ? const Color(0xFFFF5252).withOpacity(0.5) : const Color(0xFFFFD700).withOpacity(0.35),
              width: 1,
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.5),
                blurRadius: 3,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Text(
            char,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w900,
              color: isJodi ? Colors.white : AppColors.gold,
              letterSpacing: 0.5,
            ),
          ),
        );
      }).toList(),
    );
  }

  void _openBetSheet(dynamic market) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF140F1D), // Dark velvet matching sheet
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
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
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(color: Colors.white12, borderRadius: BorderRadius.circular(2)),
            ),
          ),
          const SizedBox(height: 16),
          Text('${widget.market['name']} · Betting Slip'.toUpperCase(),
              style:
                  const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppColors.gold, letterSpacing: 1)),
          const SizedBox(height: 14),
          const Text('Select Bet Type', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          _buildBetTypeTabs(),
          const SizedBox(height: 14),
          Row(
            children: [
              const Text('Session:  ', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.bold)),
              _buildSessionChips(),
            ],
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _numberCtrl,
            keyboardType: TextInputType.number,
            maxLength: _maxLen,
            style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16),
            decoration: InputDecoration(
              labelText: 'Enter number ($_maxLen digit${_maxLen > 1 ? 's' : ''})',
              labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
              counterText: '',
              fillColor: Colors.white.withOpacity(0.03),
            ),
          ),
          const SizedBox(height: 16),
          const Text('Bet Amount (Casino Chips)', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.bold)),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [10, 50, 100, 500].map((v) {
              return _buildPokerChip(v.toDouble());
            }).toList(),
          ),
          const SizedBox(height: 18),
          
          if (mult.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.gold.withOpacity(0.08),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.gold.withOpacity(0.3)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.stars_rounded, color: AppColors.gold, size: 16),
                  const SizedBox(width: 8),
                  Text(
                    'Potential payout: ₹${(_amount * (double.tryParse(mult) ?? 0)).toStringAsFixed(0)} (${mult}x)',
                    style: const TextStyle(
                        color: AppColors.goldLight, fontWeight: FontWeight.w900, fontSize: 12),
                  ),
                ],
              ),
            ),
            
          if (_error != null) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                const Icon(Icons.error_outline_rounded, color: AppColors.red, size: 16),
                const SizedBox(width: 6),
                Text(_error!, style: const TextStyle(color: AppColors.red, fontWeight: FontWeight.bold, fontSize: 12)),
              ],
            ),
          ],
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.gold.withOpacity(0.3),
                    blurRadius: 12,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: ElevatedButton(
                onPressed: _submitting ? null : _submit,
                style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.gold,
                    foregroundColor: Colors.black,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    elevation: 0),
                child: _submitting
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                            strokeWidth: 2.5, color: Colors.black))
                    : Text('PLACE BET OF ₹${_amount.toInt()}',
                        style: const TextStyle(
                            fontWeight: FontWeight.w900, fontSize: 14, letterSpacing: 0.5)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPokerChip(double v) {
    final sel = _amount == v;
    final color = v == 10 
        ? const Color(0xFF1E88E5) 
        : v == 50 
            ? const Color(0xFF43A047) 
            : v == 100 
                ? const Color(0xFFE53935) 
                : const Color(0xFF8E24AA);

    return GestureDetector(
      onTap: () {
        SoundService.instance.play(Sfx.buttonTap);
        setState(() => _amount = v);
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 54,
        height: 54,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: [
              Colors.white.withOpacity(0.2),
              color,
              color.withOpacity(0.85),
              Colors.black.withOpacity(0.45),
            ],
            stops: const [0.0, 0.25, 0.75, 1.0],
            center: const Alignment(-0.2, -0.2),
          ),
          border: Border.all(
            color: sel ? Colors.white : Colors.white24,
            width: sel ? 2.5 : 1.5,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.45),
              blurRadius: 4,
              offset: const Offset(1.5, 3),
            ),
            if (sel)
              BoxShadow(
                color: color.withOpacity(0.55),
                blurRadius: 10,
                spreadRadius: 1.5,
              ),
          ],
        ),
        child: Center(
          child: Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white30, width: 1.0),
            ),
            child: Center(
              child: Text(
                '₹${v.toInt()}',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                  fontSize: 12,
                  shadows: [Shadow(color: Colors.black54, blurRadius: 2, offset: Offset(0, 1))]
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildBetTypeTabs() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: _types.map((t) {
          final sel = _betType == t[0];
          return GestureDetector(
            onTap: () => setState(() {
              _betType = t[0];
              _numberCtrl.clear();
            }),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              margin: const EdgeInsets.only(right: 8),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                gradient: sel 
                    ? const LinearGradient(
                        colors: [Color(0xFFFFD54F), Color(0xFFFFA000)],
                      )
                    : null,
                color: sel ? null : Colors.white.withOpacity(0.06),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: sel ? Colors.transparent : Colors.white.withOpacity(0.05),
                ),
              ),
              child: Text(t[1],
                  style: TextStyle(
                      color: sel ? Colors.black : Colors.white70,
                      fontSize: 12,
                      fontWeight: FontWeight.bold)),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildSessionChips() {
    return Row(
      children: ['open', 'close'].map((s) {
        final sel = _session == s;
        return Padding(
          padding: const EdgeInsets.only(right: 8),
          child: GestureDetector(
            onTap: () => setState(() => _session = s),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: sel ? AppColors.gold.withOpacity(0.18) : Colors.white.withOpacity(0.04),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: sel ? AppColors.gold : Colors.white.withOpacity(0.05),
                ),
              ),
              child: Text(
                s.toUpperCase(),
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: sel ? AppColors.gold : Colors.white54,
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}
