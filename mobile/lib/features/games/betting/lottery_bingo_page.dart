import 'dart:async';
import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/socket/socket_service.dart';
import '../../../shared/theme/app_theme.dart';

// ─────────────────────────────────────────────────────────────────────────────
//  Daily Lottery — 90-ball bingo: Browse / My Tickets / History
// ─────────────────────────────────────────────────────────────────────────────
class LotteryBingoPage extends StatefulWidget {
  const LotteryBingoPage({super.key});

  @override
  State<LotteryBingoPage> createState() => _LotteryBingoPageState();
}

class _LotteryBingoPageState extends State<LotteryBingoPage> with SingleTickerProviderStateMixin {
  late final TabController _tab;
  List<dynamic> _draws = [];
  List<dynamic> _myTickets = [];
  bool _loading = true;
  bool _myLoading = false;
  double _balance = 0;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 3, vsync: this);
    _tab.addListener(() {
      if (!_tab.indexIsChanging && _tab.index == 1 && _myTickets.isEmpty) _loadMyTickets();
    });
    _loadDraws();
    _loadBalance();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted) setState(() {}); });
  }

  @override
  void dispose() {
    _tab.dispose();
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _loadDraws() async {
    setState(() => _loading = true);
    try {
      final res = await ApiClient().dio.get('/api/betting/lottery/bingo/draws');
      if (!mounted) return;
      setState(() { _draws = res.data['draws'] ?? []; _loading = false; });
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
      final res = await ApiClient().dio.get('/api/betting/lottery/bingo/my-tickets');
      if (!mounted) return;
      setState(() { _myTickets = res.data['tickets'] ?? []; _myLoading = false; });
    } catch (_) {
      if (mounted) setState(() => _myLoading = false);
    }
  }

  Future<void> _buy(dynamic draw) async {
    try {
      await ApiClient().dio.post('/api/betting/lottery/bingo/buy', data: {'draw_id': draw['id']});
      if (!mounted) return;
      _loadBalance();
      _loadDraws();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Ticket purchased! Check My Tickets for your card.'),
        backgroundColor: AppColors.green,
        behavior: SnackBarBehavior.floating,
      ));
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Purchase failed — please try again'),
        backgroundColor: AppColors.red,
        behavior: SnackBarBehavior.floating,
      ));
    }
  }

  String _countdown(DateTime dt) {
    final diff = dt.difference(DateTime.now());
    if (diff.isNegative) return 'Starting…';
    final h = diff.inHours, m = diff.inMinutes % 60, s = diff.inSeconds % 60;
    if (h > 0) return '${h}h ${m}m';
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF03070A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF03070A),
        elevation: 0,
        leading: const BackButton(color: AppColors.gold),
        title: const Text('DAILY LOTTERY',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, letterSpacing: 1.2, color: AppColors.goldLight)),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.gold.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.25)),
            ),
            child: Text('₹${_balance.toStringAsFixed(0)}',
                style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 12)),
          ),
        ],
        bottom: TabBar(
          controller: _tab,
          indicatorColor: AppColors.gold,
          labelColor: AppColors.gold,
          unselectedLabelColor: AppColors.textSecondary,
          labelStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
          tabs: const [Tab(text: 'Browse'), Tab(text: 'My Tickets'), Tab(text: 'History')],
        ),
      ),
      body: TabBarView(
        controller: _tab,
        children: [_browseTab(), _myTicketsTab(), _historyTab()],
      ),
    );
  }

  Widget _browseTab() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    final open = _draws.where((d) => d['status'] == 'open').toList();
    final calling = _draws.where((d) => d['status'] == 'calling').toList();
    if (open.isEmpty && calling.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.grid_on_rounded, size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text('No bingo draws open right now',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadDraws,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        children: [...calling, ...open].map<Widget>((d) => _drawCard(d)).toList(),
      ),
    );
  }

  Widget _drawCard(dynamic d) {
    final price = double.tryParse(d['ticket_price']?.toString() ?? '0') ?? 0;
    final drawTime = DateTime.tryParse(d['draw_time']?.toString() ?? '');
    final isCalling = d['status'] == 'calling';
    final tiers = (d['prize_tiers'] as List?) ?? [];

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: isCalling ? AppColors.gold : AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(d['name'] ?? 'Bingo Draw',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 15)),
              ),
              if (isCalling)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: AppColors.gold.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(6)),
                  child: const Text('LIVE NOW', style: TextStyle(color: AppColors.gold, fontSize: 10, fontWeight: FontWeight.w900)),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text('₹${price.toStringAsFixed(0)} per ticket',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            children: tiers.map<Widget>((t) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.3), borderRadius: BorderRadius.circular(6)),
              child: Text('${(t['match_type'] as String).replaceAll('_', ' ')}: ${t['multiplier']}x',
                  style: const TextStyle(color: AppColors.goldLight, fontSize: 10, fontWeight: FontWeight.w700)),
            )).toList(),
          ),
          const SizedBox(height: 12),
          if (drawTime != null && !isCalling)
            Text('Starts in ${_countdown(drawTime)}',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
          const SizedBox(height: 10),
          Row(
            children: [
              if (!isCalling)
                Expanded(
                  child: ElevatedButton(
                    onPressed: () => _buy(d),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.gold,
                      foregroundColor: Colors.black,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('Buy Ticket', style: TextStyle(fontWeight: FontWeight.w900)),
                  ),
                ),
              if (isCalling) ...[
                const SizedBox(width: 0),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.push(context, MaterialPageRoute(
                      builder: (_) => _LiveDrawScreen(draw: d),
                    )),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.gold,
                      side: const BorderSide(color: AppColors.gold),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('Watch Live', style: TextStyle(fontWeight: FontWeight.w900)),
                  ),
                ),
              ],
            ],
          ),
        ],
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
            const Text('No bingo tickets yet', style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
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
    final drawStatus = t['draw_status']?.toString() ?? 'open';
    final tiersWon = (t['tiers_won'] as List?) ?? [];
    final prize = double.tryParse(t['prize']?.toString() ?? '0') ?? 0;
    final card = (t['card'] as List?) ?? [];
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: prize > 0 ? AppColors.green.withValues(alpha: 0.06) : AppColors.cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: prize > 0 ? AppColors.green.withValues(alpha: 0.4) : AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(t['draw_name'] ?? 'Bingo', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13.5))),
              Text(drawStatus, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 8),
          _miniCard(card),
          if (tiersWon.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 6, children: tiersWon.map<Widget>((tier) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: AppColors.green.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(6)),
              child: Text('$tier'.replaceAll('_', ' '), style: const TextStyle(color: AppColors.green, fontSize: 10, fontWeight: FontWeight.w700)),
            )).toList()),
          ],
          if (prize > 0) ...[
            const SizedBox(height: 8),
            Text('Won ₹${prize.toStringAsFixed(0)}', style: const TextStyle(color: AppColors.green, fontWeight: FontWeight.w900, fontSize: 14)),
          ],
        ],
      ),
    );
  }

  Widget _miniCard(List card) {
    return Column(
      children: card.map<Widget>((row) {
        final cells = (row as List);
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: cells.map<Widget>((cell) => Container(
            width: 22, height: 22,
            margin: const EdgeInsets.all(1),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: cell == null ? Colors.transparent : Colors.black.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(3),
            ),
            child: cell == null ? null : Text('$cell', style: const TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.w700)),
          )).toList(),
        );
      }).toList(),
    );
  }

  Widget _historyTab() {
    final settled = _draws.where((d) => d['status'] == 'settled').toList();
    if (settled.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.history_rounded, size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text('No settled draws yet', style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
          ],
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
      itemCount: settled.length,
      itemBuilder: (_, i) => _drawCard(settled[i]),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Live Draw Screen — connects to /ws/bingo, shows numbers as they're called
// ─────────────────────────────────────────────────────────────────────────────
class _LiveDrawScreen extends StatefulWidget {
  const _LiveDrawScreen({required this.draw});
  final dynamic draw;

  @override
  State<_LiveDrawScreen> createState() => _LiveDrawScreenState();
}

class _LiveDrawScreenState extends State<_LiveDrawScreen> {
  final List<int> _calledNumbers = [];
  String _status = 'calling';
  StreamSubscription? _stateSub, _numberSub, _completeSub, _tierSub;

  @override
  void initState() {
    super.initState();
    final drawId = widget.draw['id'] as String;
    BingoSocketService().connect(drawId);
    _stateSub = BingoSocketService().on('bingo:draw_state').listen((data) {
      if (!mounted) return;
      setState(() {
        _status = data['status'] ?? 'calling';
        _calledNumbers
          ..clear()
          ..addAll((data['called_numbers'] as List? ?? []).map((n) => n as int));
      });
    });
    _numberSub = BingoSocketService().on('bingo:number_called').listen((data) {
      if (!mounted) return;
      setState(() {
        _calledNumbers
          ..clear()
          ..addAll((data['called_numbers'] as List? ?? []).map((n) => n as int));
      });
    });
    _completeSub = BingoSocketService().on('bingo:draw_complete').listen((_) {
      if (!mounted) return;
      setState(() => _status = 'settled');
    });
    _tierSub = BingoSocketService().on('bingo:tier_won').listen((data) {
      if (!mounted) return;
      final tiers = (data['new_tiers'] as List? ?? []).join(', ').replaceAll('_', ' ');
      if (tiers.isEmpty) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('🎉 A ticket just won: $tiers!'),
        backgroundColor: AppColors.green,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
      ));
    });
  }

  @override
  void dispose() {
    _stateSub?.cancel();
    _numberSub?.cancel();
    _completeSub?.cancel();
    _tierSub?.cancel();
    BingoSocketService().disconnect();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lastCalled = _calledNumbers.isNotEmpty ? _calledNumbers.last : null;
    return Scaffold(
      backgroundColor: const Color(0xFF03070A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF03070A),
        elevation: 0,
        leading: const BackButton(color: AppColors.gold),
        title: Text(widget.draw['name'] ?? 'Live Draw', style: const TextStyle(color: Colors.white, fontSize: 15)),
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            if (_status == 'settled')
              const Text('Draw Complete!', style: TextStyle(color: AppColors.gold, fontSize: 20, fontWeight: FontWeight.w900))
            else ...[
              const Text('LAST NUMBER CALLED', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, letterSpacing: 2)),
              const SizedBox(height: 12),
              Container(
                width: 100, height: 100,
                decoration: BoxDecoration(color: AppColors.gold, borderRadius: BorderRadius.circular(50)),
                alignment: Alignment.center,
                child: Text(lastCalled?.toString() ?? '-',
                    style: const TextStyle(color: Colors.black, fontSize: 36, fontWeight: FontWeight.w900)),
              ),
            ],
            const SizedBox(height: 20),
            Text('${_calledNumbers.length} / 90 numbers called',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
            const SizedBox(height: 20),
            Expanded(
              child: SingleChildScrollView(
                child: Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: _calledNumbers.map((n) => Container(
                    width: 32, height: 32,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: AppColors.cardBg, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppColors.border)),
                    child: Text('$n', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
                  )).toList(),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
