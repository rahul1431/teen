import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';

// ─────────────────────────────────────────────────────────────────────────────
//  Instant Lottery — Scratch Card catalog + scratch-to-reveal + My Tickets
// ─────────────────────────────────────────────────────────────────────────────
class LotteryScratchPage extends StatefulWidget {
  const LotteryScratchPage({super.key});

  @override
  State<LotteryScratchPage> createState() => _LotteryScratchPageState();
}

class _LotteryScratchPageState extends State<LotteryScratchPage> with SingleTickerProviderStateMixin {
  late final TabController _tab;
  List<dynamic> _products = [];
  List<dynamic> _myTickets = [];
  bool _loading = true;
  bool _myLoading = false;
  double _balance = 0;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 2, vsync: this);
    _tab.addListener(() {
      if (!_tab.indexIsChanging && _tab.index == 1 && _myTickets.isEmpty) _loadMyTickets();
    });
    _loadProducts();
    _loadBalance();
  }

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  Future<void> _loadProducts() async {
    setState(() => _loading = true);
    try {
      final res = await ApiClient().dio.get('/api/betting/lottery/scratch/products');
      if (!mounted) return;
      setState(() { _products = res.data['products'] ?? []; _loading = false; });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadBalance() async {
    try {
      final res = await ApiClient().dio.get('/api/wallet/balance');
      if (!mounted) return;
      setState(() => _balance = double.tryParse(res.data['real_balance'].toString()) ?? 0);
    } catch (_) {}
  }

  Future<void> _loadMyTickets() async {
    setState(() => _myLoading = true);
    try {
      final res = await ApiClient().dio.get('/api/betting/lottery/scratch/my-tickets');
      if (!mounted) return;
      setState(() { _myTickets = res.data['tickets'] ?? []; _myLoading = false; });
    } catch (_) {
      if (mounted) setState(() => _myLoading = false);
    }
  }

  Future<void> _buy(dynamic product) async {
    final price = double.tryParse(product['price']?.toString() ?? '0') ?? 0;
    if (price > _balance) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Insufficient balance — you have ₹${_balance.toStringAsFixed(0)}'),
        backgroundColor: AppColors.red,
        behavior: SnackBarBehavior.floating,
      ));
      return;
    }
    try {
      final res = await ApiClient().dio.post('/api/betting/lottery/scratch/buy',
          data: {'product_id': product['id']});
      if (!mounted) return;
      _loadBalance();
      await Navigator.push(context, MaterialPageRoute(
        builder: (_) => _ScratchRevealScreen(
          productName: product['name'] ?? 'Scratch Card',
          outcome: res.data['outcome'],
          amount: double.tryParse(res.data['amount']?.toString() ?? '0') ?? 0,
          promoCode: res.data['promo_code'],
        ),
      ));
      _loadMyTickets();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Purchase failed — please try again'),
        backgroundColor: AppColors.red,
        behavior: SnackBarBehavior.floating,
      ));
    }
  }

  double _topPrize(dynamic product) {
    final payouts = (product['payouts'] as List?) ?? [];
    double top = 0;
    for (final p in payouts) {
      if (p['outcome'] == 'cash') {
        final amt = double.tryParse(p['amount']?.toString() ?? '0') ?? 0;
        if (amt > top) top = amt;
      }
    }
    return top;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF03070A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF03070A),
        elevation: 0,
        leading: const BackButton(color: AppColors.gold),
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('✨', style: TextStyle(fontSize: 18)),
            SizedBox(width: 6),
            Text('INSTANT LOTTERY',
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.2,
                    color: AppColors.goldLight)),
          ],
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.gold.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.25)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.account_balance_wallet_rounded, size: 13, color: AppColors.gold),
                const SizedBox(width: 5),
                Text('₹${_balance.toStringAsFixed(0)}',
                    style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 12)),
              ],
            ),
          ),
        ],
        bottom: TabBar(
          controller: _tab,
          indicatorColor: AppColors.gold,
          labelColor: AppColors.gold,
          unselectedLabelColor: AppColors.textSecondary,
          labelStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
          tabs: const [Tab(text: 'Browse'), Tab(text: 'My Tickets')],
        ),
      ),
      body: TabBarView(
        controller: _tab,
        children: [_browseTab(), _myTicketsTab()],
      ),
    );
  }

  Widget _browseTab() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_products.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.auto_awesome_rounded, size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text('No scratch cards available right now',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadProducts,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: GridView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: 14,
          mainAxisSpacing: 14,
          childAspectRatio: 0.82,
        ),
        itemCount: _products.length,
        itemBuilder: (_, i) => _productCard(_products[i]),
      ),
    );
  }

  Widget _productCard(dynamic product) {
    final price = double.tryParse(product['price']?.toString() ?? '0') ?? 0;
    final topPrize = _topPrize(product);
    return InkWell(
      onTap: () {
        SoundService.instance.play(Sfx.buttonTap);
        _buy(product);
      },
      borderRadius: BorderRadius.circular(18),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          gradient: const LinearGradient(
            colors: [Color(0xFF3B0764), Color(0xFF1E1033)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          border: Border.all(color: Colors.purpleAccent.withValues(alpha: 0.3)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.auto_awesome_rounded, color: Colors.purpleAccent, size: 28),
              const Spacer(),
              Text(product['name'] ?? 'Scratch Card',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 13.5)),
              const SizedBox(height: 6),
              if (topPrize > 0)
                Text('Win up to ₹${topPrize.toStringAsFixed(0)}',
                    style: const TextStyle(color: AppColors.goldLight, fontSize: 11, fontWeight: FontWeight.w700)),
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.gold,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text('₹${price.toStringAsFixed(0)}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.black, fontWeight: FontWeight.w900, fontSize: 13)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _myTicketsTab() {
    if (_myLoading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_myTickets.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.receipt_long_outlined, size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text('No scratch cards bought yet',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadMyTickets,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        itemCount: _myTickets.length,
        itemBuilder: (_, i) => _ticketRow(_myTickets[i]),
      ),
    );
  }

  Widget _ticketRow(dynamic t) {
    final outcome = t['outcome']?.toString() ?? 'no_win';
    final amount = double.tryParse(t['amount']?.toString() ?? '0') ?? 0;
    final promoCode = t['promo_code']?.toString();
    final isWin = outcome == 'cash' || outcome == 'coupon';
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isWin ? AppColors.green.withValues(alpha: 0.06) : AppColors.cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: isWin ? AppColors.green.withValues(alpha: 0.35) : AppColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(t['product_name'] ?? 'Scratch Card',
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13.5)),
          ),
          if (outcome == 'cash')
            Text('Won ₹${amount.toStringAsFixed(0)}',
                style: const TextStyle(color: AppColors.green, fontWeight: FontWeight.w900, fontSize: 13))
          else if (outcome == 'coupon')
            Text('Coupon: ${promoCode ?? '—'}',
                style: const TextStyle(color: Colors.purpleAccent, fontWeight: FontWeight.w900, fontSize: 12))
          else
            const Text('No Win', style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Scratch Reveal Screen — result is already known; scratching is presentational
// ─────────────────────────────────────────────────────────────────────────────
class _ScratchRevealScreen extends StatefulWidget {
  const _ScratchRevealScreen({
    required this.productName,
    required this.outcome,
    required this.amount,
    required this.promoCode,
  });
  final String productName;
  final String outcome;
  final double amount;
  final String? promoCode;

  @override
  State<_ScratchRevealScreen> createState() => _ScratchRevealScreenState();
}

class _ScratchRevealScreenState extends State<_ScratchRevealScreen> {
  final List<Offset> _scratchPoints = [];
  bool _revealed = false;

  void _addScratchPoint(Offset p) {
    setState(() => _scratchPoints.add(p));
    if (!_revealed && _scratchPoints.length > 40) {
      setState(() => _revealed = true);
      if (widget.outcome == 'cash' || widget.outcome == 'coupon') {
        SoundService.instance.play(Sfx.win);
        HapticFeedback.heavyImpact();
      } else {
        HapticFeedback.lightImpact();
      }
    }
  }

  Widget _resultContent() {
    if (widget.outcome == 'cash') {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.emoji_events_rounded, color: AppColors.goldLight, size: 48),
          const SizedBox(height: 12),
          Text('You Won ₹${widget.amount.toStringAsFixed(0)}!',
              style: const TextStyle(color: AppColors.goldLight, fontSize: 22, fontWeight: FontWeight.w900)),
        ],
      );
    }
    if (widget.outcome == 'coupon') {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.card_giftcard_rounded, color: Colors.purpleAccent, size: 48),
          const SizedBox(height: 12),
          const Text('You Won a Coupon!',
              style: TextStyle(color: Colors.purpleAccent, fontSize: 20, fontWeight: FontWeight.w900)),
          const SizedBox(height: 6),
          Text(widget.promoCode ?? '',
              style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800, letterSpacing: 2)),
        ],
      );
    }
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.sentiment_dissatisfied_rounded, color: AppColors.textSecondary.withValues(alpha: 0.6), size: 48),
        const SizedBox(height: 12),
        const Text('Better Luck Next Time',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 18, fontWeight: FontWeight.w800)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF03070A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF03070A),
        elevation: 0,
        leading: const BackButton(color: AppColors.gold),
        title: Text(widget.productName,
            style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w700)),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('Scratch the card to reveal your result',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(height: 20),
              SizedBox(
                width: 300,
                height: 300,
                child: Stack(
                  children: [
                    Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(20),
                        color: const Color(0xFF11161C),
                        border: Border.all(color: AppColors.gold.withValues(alpha: 0.3)),
                      ),
                      alignment: Alignment.center,
                      child: _resultContent(),
                    ),
                    if (!_revealed)
                      GestureDetector(
                        onPanUpdate: (details) => _addScratchPoint(details.localPosition),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(20),
                          child: CustomPaint(
                            size: const Size(300, 300),
                            painter: _ScratchOverlayPainter(points: _scratchPoints),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 28),
              if (_revealed)
                ElevatedButton(
                  onPressed: () => Navigator.pop(context),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.gold,
                    foregroundColor: Colors.black,
                    minimumSize: const Size(200, 48),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Done', style: TextStyle(fontWeight: FontWeight.w900)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// Paints an opaque scratch-off layer with holes punched out at every
// dragged point — a simple, dependency-free stand-in for a real scratch
// texture. The underlying result is already rendered beneath this layer;
// scratching only reveals it, it never determines it.
class _ScratchOverlayPainter extends CustomPainter {
  final List<Offset> points;
  _ScratchOverlayPainter({required this.points});

  @override
  void paint(Canvas canvas, Size size) {
    final layerPaint = Paint();
    canvas.saveLayer(Offset.zero & size, layerPaint);

    final basePaint = Paint()
      ..shader = const LinearGradient(
        colors: [Color(0xFF9CA3AF), Color(0xFF4B5563)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ).createShader(Offset.zero & size);
    canvas.drawRect(Offset.zero & size, basePaint);

    final holePaint = Paint()
      ..blendMode = ui.BlendMode.clear
      ..style = PaintingStyle.fill;
    for (final p in points) {
      canvas.drawCircle(p, 24, holePaint);
    }

    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _ScratchOverlayPainter oldDelegate) => true;
}
