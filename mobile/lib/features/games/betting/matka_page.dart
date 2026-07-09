import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';
import 'betting_history_page.dart';

// --- MATHEMATICAL SATTA MATKA PANNA GENERATOR ---
class Panna {
  final String number;
  final String type; // 'single_panna' | 'double_panna' | 'triple_panna'
  final int ank;

  Panna(this.number, this.type, this.ank);
}

List<Panna> _cachedPannas = [];
List<Panna> getAllPannas() {
  if (_cachedPannas.isNotEmpty) return _cachedPannas;

  List<Panna> list = [];
  // i, j, k from 1 to 10 (where 10 represents 0)
  for (int i = 1; i <= 10; i++) {
    for (int j = i; j <= 10; j++) {
      for (int k = j; k <= 10; k++) {
        int d1 = i == 10 ? 0 : i;
        int d2 = j == 10 ? 0 : j;
        int d3 = k == 10 ? 0 : k;

        // Form string representation (e.g. 123, 120, 000)
        String numStr = "$d1$d2$d3";

        // Determine Panna kind
        String type;
        if (i == j && j == k) {
          type = 'triple_panna';
        } else if (i == j || j == k || i == k) {
          type = 'double_panna';
        } else {
          type = 'single_panna';
        }

        // Ank sum mod 10
        int sum = (d1 + d2 + d3) % 10;
        list.add(Panna(numStr, type, sum));
      }
    }
  }
  _cachedPannas = list;
  return list;
}

class MatkaPage extends StatefulWidget {
  const MatkaPage({super.key});
  @override
  State<MatkaPage> createState() => _MatkaPageState();
}

class _MatkaPageState extends State<MatkaPage> {
  List<dynamic> _markets = [];
  Map<String, dynamic> _multipliers = {};
  bool _loading = true;
  final Map<String, GlobalKey<_MatkaPotWidgetState>> _potKeys = {};

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

      // Trigger shake animation for active markets on load
      WidgetsBinding.instance.addPostFrameCallback((_) {
        for (var m in _markets) {
          final status = m['status'] as String? ?? 'open';
          if (status != 'settled') {
            _potKeys[m['id']]?.currentState?.shake();
          }
        }
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
              Color(0xFF2E1A47),
              Color(0xFF140B24),
              Color(0xFF07030D),
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

    // Store key for shake triggers
    final marketId = m['id'] as String;
    _potKeys.putIfAbsent(marketId, () => GlobalKey<_MatkaPotWidgetState>());

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: const Color(0xFF1B1229).withOpacity(0.85),
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
                TextButton.icon(
                  onPressed: () {
                    SoundService.instance.play(Sfx.buttonTap);
                    showDialog(
                      context: context,
                      builder: (_) => MatkaPanelChartDialog(
                        marketId: m['id'],
                        marketName: m['name'],
                      ),
                    );
                  },
                  icon: const Icon(Icons.table_chart_outlined, size: 14, color: AppColors.gold),
                  label: const Text('CHART', style: TextStyle(color: AppColors.gold, fontSize: 11, fontWeight: FontWeight.bold)),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                ),
                const SizedBox(width: 8),
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
            
            // Traditional Clay Matka Pot + Slot Reels Row
            Row(
              children: [
                Expanded(
                  flex: 3,
                  child: Center(
                    child: _buildResultSlot(openPanna, jodi, closePanna),
                  ),
                ),
                Expanded(
                  flex: 1,
                  child: Center(
                    child: MatkaPotWidget(
                      key: _potKeys[marketId],
                      color: settled ? Colors.grey : AppColors.gold,
                    ),
                  ),
                ),
              ],
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
        const SizedBox(width: 4),
        Container(height: 2, width: 8, color: Colors.white24),
        const SizedBox(width: 4),
        _slotReel(jodi, isJodi: true),
        const SizedBox(width: 4),
        Container(height: 2, width: 8, color: Colors.white24),
        const SizedBox(width: 4),
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
          margin: const EdgeInsets.symmetric(horizontal: 1.5),
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: isJodi 
                  ? [const Color(0xFFC62828), const Color(0xFF5C0000)]
                  : [const Color(0xFF2C3E50), const Color(0xFF0F171E)],
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
              fontSize: 14,
              fontWeight: FontWeight.w900,
              color: isJodi ? Colors.white : AppColors.gold,
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
      backgroundColor: const Color(0xFF140F1D),
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => _MatkaBetSheet(
        market: market,
        multipliers: _multipliers,
        onPlaced: () {
          _load();
          // Play shake on success
          _potKeys[market['id']]?.currentState?.shake();
        },
      ),
    );
  }
}

// --- CLAY MATKA POT SHAKE WIDGET ---
class MatkaPotWidget extends StatefulWidget {
  final Color color;
  const MatkaPotWidget({super.key, this.color = AppColors.gold});
  @override
  State<MatkaPotWidget> createState() => _MatkaPotWidgetState();
}

class _MatkaPotWidgetState extends State<MatkaPotWidget> with SingleTickerProviderStateMixin {
  late AnimationController _animCtrl;

  @override
  void initState() {
    super.initState();
    _animCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
  }

  @override
  void dispose() {
    _animCtrl.dispose();
    super.dispose();
  }

  void shake() {
    _animCtrl.forward(from: 0.0);
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animCtrl,
      builder: (context, child) {
        // Build shake rotation values
        double rotation = 0.05 * math.sin(_animCtrl.value * 5 * math.pi);
        return Transform.rotate(
          angle: rotation,
          child: child,
        );
      },
      child: GestureDetector(
        onTap: shake,
        child: SizedBox(
          width: 56,
          height: 60,
          child: CustomPaint(
            painter: MatkaPotPainter(color: widget.color),
          ),
        ),
      ),
    );
  }
}

class MatkaPotPainter extends CustomPainter {
  final Color color;
  MatkaPotPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    // Clay Shading paint
    final paint = Paint()
      ..shader = RadialGradient(
        colors: [
          const Color(0xFFFF8A65),
          const Color(0xFFD84315),
          const Color(0xFF5E1B00),
        ],
        stops: const [0.1, 0.7, 1.0],
        center: const Alignment(-0.25, -0.25),
      ).createShader(Rect.fromLTWH(0, 0, w, h))
      ..style = PaintingStyle.fill;

    // 1. Draw Pot Body (rounded clay jar)
    final path = Path();
    path.moveTo(w * 0.25, h * 0.15); // neck top left
    path.quadraticBezierTo(w * 0.1, h * 0.35, w * 0.05, h * 0.6); // outer body left
    path.quadraticBezierTo(w * 0.05, h * 0.95, w * 0.5, h * 0.98); // bottom left base
    path.quadraticBezierTo(w * 0.95, h * 0.95, w * 0.95, h * 0.6); // bottom right base
    path.quadraticBezierTo(w * 0.9, h * 0.35, w * 0.75, h * 0.15); // outer body right
    path.close();
    canvas.drawPath(path, paint);

    // 2. Rim/Mouth of the Pot
    final rimPaint = Paint()
      ..color = const Color(0xFFE64A19)
      ..style = PaintingStyle.fill;
    canvas.drawOval(
      Rect.fromLTRB(w * 0.20, h * 0.06, w * 0.80, h * 0.16),
      rimPaint,
    );

    // Gold/Decorative ribbon around neck
    final ribbonPaint = Paint()
      ..color = const Color(0xFFFFD54F)
      ..strokeWidth = 2.5
      ..style = PaintingStyle.stroke;
    canvas.drawArc(
      Rect.fromLTRB(w * 0.22, h * 0.18, w * 0.78, h * 0.28),
      0,
      math.pi,
      false,
      ribbonPaint,
    );

    // Traditional Dots
    final dotPaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;
    canvas.drawCircle(Offset(w * 0.32, h * 0.45), 2, dotPaint);
    canvas.drawCircle(Offset(w * 0.50, h * 0.50), 3, dotPaint);
    canvas.drawCircle(Offset(w * 0.68, h * 0.45), 2, dotPaint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// --- KALYAN STYLE WEEKLY PANEL CHART DIALOG ---
class MatkaPanelChartDialog extends StatefulWidget {
  final String marketId;
  final String marketName;
  const MatkaPanelChartDialog({super.key, required this.marketId, required this.marketName});
  @override
  State<MatkaPanelChartDialog> createState() => _MatkaPanelChartDialogState();
}

class _MatkaPanelChartDialogState extends State<MatkaPanelChartDialog> {
  List<dynamic> _weeks = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiClient().dio.get('/api/betting/matka/markets/${widget.marketId}/chart');
      if (!mounted) return;
      setState(() {
        _weeks = res.data['chart'] ?? [];
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: const Color(0xFF1B1229),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      insetPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 24),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${widget.marketName} Panel Chart'.toUpperCase(),
                    style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.w900, fontSize: 15, letterSpacing: 0.5),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: Colors.white60),
                  onPressed: () => Navigator.pop(context),
                )
              ],
            ),
            const Divider(color: Colors.white12),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
                  : _weeks.isEmpty
                      ? const Center(child: Text('No historical results found', style: TextStyle(color: Colors.white38)))
                      : SingleChildScrollView(
                          scrollDirection: Axis.vertical,
                          child: SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: Table(
                              border: TableBorder.all(color: Colors.white12, width: 1),
                              defaultColumnWidth: const FixedColumnWidth(60),
                              children: [
                                // Table Header row
                                TableRow(
                                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.04)),
                                  children: ['Date', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) {
                                    return Padding(
                                      padding: const EdgeInsets.symmetric(vertical: 8),
                                      child: Center(
                                        child: Text(
                                          day,
                                          style: const TextStyle(
                                            color: AppColors.gold,
                                            fontWeight: FontWeight.w900,
                                            fontSize: 10,
                                          ),
                                        ),
                                      ),
                                    );
                                  }).toList(),
                                ),
                                // Weekly Rows
                                ..._weeks.map((week) {
                                  return TableRow(
                                    children: [
                                      // Date block
                                      Padding(
                                        padding: const EdgeInsets.all(4.0),
                                        child: Center(
                                          child: Text(
                                            week['week_start']?.substring(5) ?? '', // MM-DD
                                            style: const TextStyle(color: Colors.white54, fontSize: 9, fontWeight: FontWeight.bold),
                                          ),
                                        ),
                                      ),
                                      ...['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((dayKey) {
                                        final result = week[dayKey];
                                        if (result == null) {
                                          return const Padding(
                                            padding: EdgeInsets.all(6.0),
                                            child: Center(child: Text('-', style: TextStyle(color: Colors.white24))),
                                          );
                                        }
                                        final isRed = result['open_digit'] == result['close_digit'] && result['jodi'] != '**';
                                        return Padding(
                                          padding: const EdgeInsets.symmetric(vertical: 4.0),
                                          child: Column(
                                            mainAxisSize: MainAxisSize.min,
                                            children: [
                                              Text(result['open_panna'] ?? '***', style: const TextStyle(color: Colors.white38, fontSize: 8)),
                                              const SizedBox(height: 1.5),
                                              Text(
                                                result['jodi'] ?? '**',
                                                style: TextStyle(
                                                  color: isRed ? const Color(0xFFFF5252) : AppColors.gold,
                                                  fontWeight: FontWeight.w900,
                                                  fontSize: 11,
                                                ),
                                              ),
                                              const SizedBox(height: 1.5),
                                              Text(result['close_panna'] ?? '***', style: const TextStyle(color: Colors.white38, fontSize: 8)),
                                            ],
                                          ),
                                        );
                                      }).toList(),
                                    ],
                                  );
                                }),
                              ],
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

// --- REDESIGNED TABBED SATTA MATKA BET SLIP SHEET ---
class _MatkaBetSheet extends StatefulWidget {
  final dynamic market;
  final Map<String, dynamic> multipliers;
  final VoidCallback onPlaced;
  const _MatkaBetSheet({required this.market, required this.multipliers, required this.onPlaced});
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

  // Tabs structure:
  // - single: Single Digit (Ank)
  // - jodi: Jodi (00-99)
  // - panna: Single/Double/Triple Pannas
  // - sangam: Half/Full Sangams
  final _tabs = const [
    ['single', 'Single Ank'],
    ['jodi', 'Jodi'],
    ['panna', 'Panna'],
    ['sangam', 'Sangam'],
  ];

  // Subsections inside Panna
  String _pannaSubtype = 'single_panna'; // single_panna | double_panna | triple_panna
  int _selectedPannaAnk = 1; // 0-9

  // Subsections inside Sangam
  String _sangamSubtype = 'half_sangam_a'; // half_sangam_a | half_sangam_b | full_sangam
  String _sangamOpenPanna = '';
  int _sangamOpenPannaAnk = 1;
  String _sangamClosePanna = '';
  int _sangamClosePannaAnk = 1;
  int _sangamOpenAnk = 1;
  int _sangamCloseAnk = 1;

  @override
  void initState() {
    super.initState();
    _rebuildBetType();
  }

  void _rebuildBetType() {
    _error = null;
    if (_betType == 'single') {
      _numberCtrl.text = '';
    } else if (_betType == 'jodi') {
      _numberCtrl.text = '';
      _session = 'close';
    } else if (_betType == 'panna') {
      _numberCtrl.text = '';
    } else if (_betType == 'sangam') {
      _numberCtrl.text = '';
      _session = 'close';
      _sangamOpenPanna = '';
      _sangamClosePanna = '';
    }
  }

  Future<void> _submit() async {
    final number = _numberCtrl.text.trim();
    final currentType = _betType == 'panna' 
        ? _pannaSubtype 
        : _betType == 'sangam' 
            ? _sangamSubtype 
            : _betType;

    if (number.isEmpty) {
      setState(() => _error = 'Please select a number');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await ApiClient().dio.post('/api/betting/matka/bet', data: {
        'market_id': widget.market['id'],
        'bet_type': currentType,
        'session': _session,
        'number': number,
        'amount': _amount,
      });
      SoundService.instance.play(Sfx.chipBet);
      if (!mounted) return;
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Bet placed successfully! 🎯'), backgroundColor: AppColors.green));
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
    final currentType = _betType == 'panna' 
        ? _pannaSubtype 
        : _betType == 'sangam' 
            ? _sangamSubtype 
            : _betType;
    final mult = widget.multipliers[currentType]?.toString() ?? '';

    return Padding(
      padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 14,
          bottom: MediaQuery.of(context).viewInsets.bottom + 20),
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
          const SizedBox(height: 12),
          Text('${widget.market['name']} · Betting Slip'.toUpperCase(),
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: AppColors.gold, letterSpacing: 0.5)),
          const SizedBox(height: 12),
          
          // Main Bidding Mode Tabs
          _buildMainTabs(),
          const SizedBox(height: 12),

          // Session Chips (hidden for Jodi & Sangam, as they require Close results)
          if (_betType != 'jodi' && _betType != 'sangam') ...[
            Row(
              children: [
                const Text('Session:  ', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.bold)),
                _buildSessionChips(),
              ],
            ),
            const SizedBox(height: 12),
          ],

          // Dynamic Panel Content based on selected mode
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.02),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.white10),
            ),
            child: _buildBiddingPanel(),
          ),
          
          const SizedBox(height: 10),
          _buildPayoutDisplay(mult),
          
          if (_error != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.error_outline_rounded, color: AppColors.red, size: 16),
                const SizedBox(width: 6),
                Text(_error!, style: const TextStyle(color: AppColors.red, fontWeight: FontWeight.bold, fontSize: 11)),
              ],
            ),
          ],
          
          const SizedBox(height: 12),
          const Text('Bet Amount (Chips)', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [10, 50, 100, 500].map((v) => _buildPokerChip(v.toDouble())).toList(),
          ),
          
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            height: 46,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.gold.withOpacity(0.3),
                    blurRadius: 10,
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
                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                    : Text(
                        _numberCtrl.text.isEmpty
                            ? 'SELECT A NUMBER TO BID'
                            : 'PLACE BET OF ₹${_amount.toInt()} ON ${_numberCtrl.text}',
                        style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, letterSpacing: 0.5)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // Render main tab bars
  Widget _buildMainTabs() {
    return Row(
      children: _tabs.map((t) {
        final sel = _betType == t[0];
        return Expanded(
          child: GestureDetector(
            onTap: () => setState(() {
              _betType = t[0];
              _rebuildBetType();
            }),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              margin: const EdgeInsets.symmetric(horizontal: 2.5),
              padding: const EdgeInsets.symmetric(vertical: 8),
              decoration: BoxDecoration(
                gradient: sel ? const LinearGradient(colors: [Color(0xFFFFD54F), Color(0xFFFFA000)]) : null,
                color: sel ? null : Colors.white.withOpacity(0.04),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: sel ? Colors.transparent : Colors.white.withOpacity(0.04)),
              ),
              child: Center(
                child: Text(t[1],
                    style: TextStyle(
                        color: sel ? Colors.black : Colors.white70,
                        fontSize: 11,
                        fontWeight: FontWeight.w900)),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildSessionChips() {
    return Row(
      children: ['open', 'close'].map((s) {
        final sel = _session == s;
        return Padding(
          padding: const EdgeInsets.only(right: 6),
          child: GestureDetector(
            onTap: () => setState(() => _session = s),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: sel ? AppColors.gold.withOpacity(0.18) : Colors.white.withOpacity(0.03),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: sel ? AppColors.gold : Colors.white.withOpacity(0.04)),
              ),
              child: Text(
                s.toUpperCase(),
                style: TextStyle(
                  fontSize: 10,
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

  // Helper to draw the panel contents
  Widget _buildBiddingPanel() {
    if (_betType == 'single') {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Tap to select Single Ank (0-9)', style: TextStyle(color: Colors.white70, fontSize: 10, fontWeight: FontWeight.bold)),
          const SizedBox(height: 10),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: 10,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 5,
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              childAspectRatio: 1.0,
            ),
            itemBuilder: (context, index) {
              final val = index.toString();
              final sel = _numberCtrl.text == val;
              return _circleButton(val, sel, () {
                setState(() => _numberCtrl.text = val);
              });
            },
          ),
        ],
      );
    }

    if (_betType == 'jodi') {
      final openVal = _numberCtrl.text.isNotEmpty ? _numberCtrl.text[0] : '';
      final closeVal = _numberCtrl.text.length == 2 ? _numberCtrl.text[1] : '';
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Select Open Ank', style: TextStyle(color: Colors.white70, fontSize: 10, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          _buildRowSelector(openVal, (val) {
            final close = _numberCtrl.text.length == 2 ? _numberCtrl.text[1] : '0';
            setState(() => _numberCtrl.text = "$val$close");
          }),
          const SizedBox(height: 12),
          const Text('Select Close Ank', style: TextStyle(color: Colors.white70, fontSize: 10, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          _buildRowSelector(closeVal, (val) {
            final open = _numberCtrl.text.isNotEmpty ? _numberCtrl.text[0] : '0';
            setState(() => _numberCtrl.text = "$open$val");
          }),
        ],
      );
    }

    if (_betType == 'panna') {
      // 1. Sub-tab between SP, DP, and TP
      // 2. Ank selector
      // 3. Grid of math-generated Pannas
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _subtypeChip('single_panna', 'Single (SP)'),
              const SizedBox(width: 6),
              _subtypeChip('double_panna', 'Double (DP)'),
              const SizedBox(width: 6),
              _subtypeChip('triple_panna', 'Triple (TP)'),
            ],
          ),
          const SizedBox(height: 12),
          if (_pannaSubtype != 'triple_panna') ...[
            const Text('Filter by Ending Ank (0-9)', style: TextStyle(color: Colors.white60, fontSize: 10, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            _buildRowSelector(_selectedPannaAnk.toString(), (val) {
              setState(() {
                _selectedPannaAnk = int.parse(val);
                _numberCtrl.text = ''; // Clear selected panna
              });
            }),
            const SizedBox(height: 12),
          ],
          const Text('Select Panna Card', style: TextStyle(color: Colors.white70, fontSize: 10, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          _buildPannaSelectionGrid(),
        ],
      );
    }

    if (_betType == 'sangam') {
      // Toggle between Half Sangam A, B and Full Sangam
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _sangamChip('half_sangam_a', 'Half Sangam A'),
              const SizedBox(width: 6),
              _sangamChip('half_sangam_b', 'Half Sangam B'),
              const SizedBox(width: 6),
              _sangamChip('full_sangam', 'Full Sangam'),
            ],
          ),
          const SizedBox(height: 12),
          _buildSangamPanel(),
        ],
      );
    }

    return const SizedBox();
  }

  Widget _buildRowSelector(String currentVal, Function(String) onSelect) {
    return SizedBox(
      height: 32,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        itemCount: 10,
        itemBuilder: (context, index) {
          final val = index.toString();
          final sel = currentVal == val;
          return Padding(
            padding: const EdgeInsets.only(right: 6),
            child: GestureDetector(
              onTap: () {
                SoundService.instance.play(Sfx.buttonTap);
                onSelect(val);
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                width: 32,
                decoration: BoxDecoration(
                  color: sel ? AppColors.gold : Colors.white.withOpacity(0.04),
                  shape: BoxShape.circle,
                  border: Border.all(color: sel ? Colors.transparent : Colors.white10),
                ),
                child: Center(
                  child: Text(
                    val,
                    style: TextStyle(
                      color: sel ? Colors.black : Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _subtypeChip(String val, String label) {
    final sel = _pannaSubtype == val;
    return GestureDetector(
      onTap: () => setState(() {
        _pannaSubtype = val;
        _rebuildBetType();
      }),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: sel ? AppColors.gold.withOpacity(0.2) : Colors.white.withOpacity(0.02),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: sel ? AppColors.gold : Colors.white10),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: sel ? AppColors.gold : Colors.white54,
            fontSize: 9,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
    );
  }

  Widget _sangamChip(String val, String label) {
    final sel = _sangamSubtype == val;
    return GestureDetector(
      onTap: () => setState(() {
        _sangamSubtype = val;
        _rebuildBetType();
      }),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: sel ? AppColors.gold.withOpacity(0.2) : Colors.white.withOpacity(0.02),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: sel ? AppColors.gold : Colors.white10),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: sel ? AppColors.gold : Colors.white54,
            fontSize: 9,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
    );
  }

  Widget _buildPannaSelectionGrid() {
    // Generate all pannas, filter by current subtype and selected ending Ank
    final pannas = getAllPannas().where((p) {
      if (p.type != _pannaSubtype) return false;
      if (_pannaSubtype == 'triple_panna') return true; // Triple has 1 Panna per Ank, show all at once
      return p.ank == _selectedPannaAnk;
    }).toList();

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: pannas.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        crossAxisSpacing: 6,
        mainAxisSpacing: 6,
        childAspectRatio: 2.2,
      ),
      itemBuilder: (context, index) {
        final p = pannas[index];
        final sel = _numberCtrl.text == p.number;
        return GestureDetector(
          onTap: () {
            SoundService.instance.play(Sfx.buttonTap);
            setState(() => _numberCtrl.text = p.number);
          },
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            decoration: BoxDecoration(
              color: sel ? AppColors.gold : Colors.white.withOpacity(0.03),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: sel ? Colors.transparent : Colors.white10),
            ),
            child: Center(
              child: Text(
                p.number,
                style: TextStyle(
                  color: sel ? Colors.black : Colors.white,
                  fontWeight: FontWeight.w900,
                  fontSize: 12,
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildSangamPanel() {
    if (_sangamSubtype == 'half_sangam_a') {
      // Open Panna + Close Ank
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Select Open Panna Ending Ank', style: TextStyle(color: Colors.white60, fontSize: 9)),
          const SizedBox(height: 4),
          _buildRowSelector(_sangamOpenPannaAnk.toString(), (val) {
            setState(() {
              _sangamOpenPannaAnk = int.parse(val);
              _sangamOpenPanna = '';
              _numberCtrl.text = '';
            });
          }),
          const SizedBox(height: 8),
          const Text('Select Open Panna', style: TextStyle(color: Colors.white60, fontSize: 9)),
          const SizedBox(height: 4),
          _buildPannaRowSelector(_sangamOpenPanna, (p) {
            setState(() {
              _sangamOpenPanna = p;
              _numberCtrl.text = '${_sangamOpenPanna}${_sangamCloseAnk}';
            });
          }, _sangamOpenPannaAnk),
          const SizedBox(height: 8),
          const Text('Select Close Ank', style: TextStyle(color: Colors.white70, fontSize: 10, fontWeight: FontWeight.bold)),
          const SizedBox(height: 6),
          _buildRowSelector(_sangamCloseAnk.toString(), (val) {
            setState(() {
              _sangamCloseAnk = int.parse(val);
              if (_sangamOpenPanna.isNotEmpty) {
                _numberCtrl.text = '${_sangamOpenPanna}${_sangamCloseAnk}';
              }
            });
          }),
        ],
      );
    }

    if (_sangamSubtype == 'half_sangam_b') {
      // Open Ank + Close Panna
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Select Open Ank', style: TextStyle(color: Colors.white70, fontSize: 10, fontWeight: FontWeight.bold)),
          const SizedBox(height: 6),
          _buildRowSelector(_sangamOpenAnk.toString(), (val) {
            setState(() {
              _sangamOpenAnk = int.parse(val);
              if (_sangamClosePanna.isNotEmpty) {
                _numberCtrl.text = '${_sangamOpenAnk}${_sangamClosePanna}';
              }
            });
          }),
          const SizedBox(height: 8),
          const Text('Select Close Panna Ending Ank', style: TextStyle(color: Colors.white60, fontSize: 9)),
          const SizedBox(height: 4),
          _buildRowSelector(_sangamClosePannaAnk.toString(), (val) {
            setState(() {
              _sangamClosePannaAnk = int.parse(val);
              _sangamClosePanna = '';
              _numberCtrl.text = '';
            });
          }),
          const SizedBox(height: 8),
          const Text('Select Close Panna', style: TextStyle(color: Colors.white60, fontSize: 9)),
          const SizedBox(height: 4),
          _buildPannaRowSelector(_sangamClosePanna, (p) {
            setState(() {
              _sangamClosePanna = p;
              _numberCtrl.text = '${_sangamOpenAnk}${_sangamClosePanna}';
            });
          }, _sangamClosePannaAnk),
        ],
      );
    }

    if (_sangamSubtype == 'full_sangam') {
      // Open Panna + Close Panna
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Select Open Panna Ending Ank', style: TextStyle(color: Colors.white60, fontSize: 9)),
          const SizedBox(height: 4),
          _buildRowSelector(_sangamOpenPannaAnk.toString(), (val) {
            setState(() {
              _sangamOpenPannaAnk = int.parse(val);
              _sangamOpenPanna = '';
              _numberCtrl.text = '';
            });
          }),
          const SizedBox(height: 6),
          _buildPannaRowSelector(_sangamOpenPanna, (p) {
            setState(() {
              _sangamOpenPanna = p;
              if (_sangamClosePanna.isNotEmpty) {
                _numberCtrl.text = '${_sangamOpenPanna}${_sangamClosePanna}';
              }
            });
          }, _sangamOpenPannaAnk),
          const Divider(color: Colors.white10, height: 16),
          const Text('Select Close Panna Ending Ank', style: TextStyle(color: Colors.white60, fontSize: 9)),
          const SizedBox(height: 4),
          _buildRowSelector(_sangamClosePannaAnk.toString(), (val) {
            setState(() {
              _sangamClosePannaAnk = int.parse(val);
              _sangamClosePanna = '';
              _numberCtrl.text = '';
            });
          }),
          const SizedBox(height: 6),
          _buildPannaRowSelector(_sangamClosePanna, (p) {
            setState(() {
              _sangamClosePanna = p;
              if (_sangamOpenPanna.isNotEmpty) {
                _numberCtrl.text = '${_sangamOpenPanna}${_sangamClosePanna}';
              }
            });
          }, _sangamClosePannaAnk),
        ],
      );
    }
    return const SizedBox();
  }

  Widget _buildPannaRowSelector(String currentPanna, Function(String) onSelect, int ank) {
    // Show only SP/DP Pannas for this Ank horizontally
    final list = getAllPannas().where((p) => p.ank == ank && p.type != 'triple_panna').toList();
    return SizedBox(
      height: 30,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        itemCount: list.length,
        itemBuilder: (context, index) {
          final p = list[index];
          final sel = currentPanna == p.number;
          return Padding(
            padding: const EdgeInsets.only(right: 6),
            child: GestureDetector(
              onTap: () {
                SoundService.instance.play(Sfx.buttonTap);
                onSelect(p.number);
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(
                  color: sel ? AppColors.gold : Colors.white.withOpacity(0.04),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: sel ? Colors.transparent : Colors.white10),
                ),
                child: Center(
                  child: Text(
                    p.number,
                    style: TextStyle(
                      color: sel ? Colors.black : Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _circleButton(String val, bool sel, VoidCallback onTap) {
    return GestureDetector(
      onTap: () {
        SoundService.instance.play(Sfx.buttonTap);
        onTap();
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        decoration: BoxDecoration(
          color: sel ? AppColors.gold : Colors.white.withOpacity(0.03),
          shape: BoxShape.circle,
          border: Border.all(color: sel ? Colors.transparent : Colors.white10, width: 1),
        ),
        child: Center(
          child: Text(
            val,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w900,
              color: sel ? Colors.black : Colors.white,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPayoutDisplay(String mult) {
    if (mult.isEmpty) return const SizedBox();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.gold.withOpacity(0.06),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.gold.withOpacity(0.2)),
      ),
      child: Row(
        children: [
          const Icon(Icons.stars_rounded, color: AppColors.gold, size: 14),
          const SizedBox(width: 6),
          Text(
            'Potential payout: ₹${(_amount * (double.tryParse(mult) ?? 0)).toStringAsFixed(0)} (${mult}x)',
            style: const TextStyle(
                color: AppColors.goldLight, fontWeight: FontWeight.w900, fontSize: 11),
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
        width: 46,
        height: 46,
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
                blurRadius: 8,
                spreadRadius: 1.0,
              ),
          ],
        ),
        child: Center(
          child: Container(
            width: 38,
            height: 38,
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
                  fontSize: 10,
                  shadows: [Shadow(color: Colors.black54, blurRadius: 2, offset: Offset(0, 1))]
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
