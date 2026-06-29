import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';

class TeenPattiHistoryPage extends StatefulWidget {
  const TeenPattiHistoryPage({super.key});

  @override
  State<TeenPattiHistoryPage> createState() => _TeenPattiHistoryPageState();
}

class _TeenPattiHistoryPageState extends State<TeenPattiHistoryPage> {
  final _api = ApiClient();
  List<dynamic> _records = [];
  bool _loading = true;
  String? _error;
  int _offset = 0;
  bool _hasMore = true;
  bool _loadingMore = false;
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _load();
    _scroll.addListener(() {
      if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 200 &&
          !_loadingMore && _hasMore) {
        _loadMore();
      }
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await _api.dio.get('/wallet/game-history',
          queryParameters: {'game_type': 'teen_patti', 'limit': 20, 'offset': 0});
      final rows = (res.data as List?) ?? [];
      setState(() {
        _records = rows;
        _offset = rows.length;
        _hasMore = rows.length >= 20;
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMore) return;
    setState(() => _loadingMore = true);
    try {
      final res = await _api.dio.get('/wallet/game-history',
          queryParameters: {'game_type': 'teen_patti', 'limit': 20, 'offset': _offset});
      final rows = (res.data as List?) ?? [];
      setState(() {
        _records.addAll(rows);
        _offset += rows.length;
        _hasMore = rows.length >= 20;
        _loadingMore = false;
      });
    } catch (_) {
      setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF060A1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0D1833),
        title: const Text('Game History',
            style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: AppColors.gold),
        elevation: 0,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : _error != null
              ? Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.error_outline, color: AppColors.red, size: 48),
                    const SizedBox(height: 12),
                    Text(_error!, style: const TextStyle(color: Colors.white54, fontSize: 13),
                        textAlign: TextAlign.center),
                    const SizedBox(height: 16),
                    TextButton(onPressed: _load,
                        child: const Text('Retry', style: TextStyle(color: AppColors.gold))),
                  ]),
                )
              : _records.isEmpty
                  ? const Center(
                      child: Text('No games played yet',
                          style: TextStyle(color: Colors.white38, fontSize: 16)))
                  : RefreshIndicator(
                      color: AppColors.gold,
                      onRefresh: _load,
                      child: ListView.builder(
                        controller: _scroll,
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        itemCount: _records.length + (_loadingMore ? 1 : 0),
                        itemBuilder: (ctx, i) {
                          if (i == _records.length) {
                            return const Padding(
                              padding: EdgeInsets.all(16),
                              child: Center(child: CircularProgressIndicator(color: AppColors.gold)),
                            );
                          }
                          return _GameHistoryCard(record: _records[i]);
                        },
                      ),
                    ),
    );
  }
}

class _GameHistoryCard extends StatelessWidget {
  final Map<String, dynamic> record;
  const _GameHistoryCard({required this.record});

  @override
  Widget build(BuildContext context) {
    final net = double.tryParse(record['net_result']?.toString() ?? '0') ?? 0;
    final entryFee = double.tryParse(record['entry_fee_deducted']?.toString() ?? '0') ?? 0;
    final prize = double.tryParse(record['prize_won']?.toString() ?? '0') ?? 0;
    final won = net > 0;
    final tied = net == 0;
    final endedAt = record['ended_at'] != null
        ? DateTime.tryParse(record['ended_at'].toString())?.toLocal()
        : null;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: BoxDecoration(
        color: const Color(0xFF0D1833),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: won
              ? AppColors.gold.withValues(alpha: 0.5)
              : tied
                  ? Colors.white24
                  : AppColors.red.withValues(alpha: 0.4),
          width: 1.2,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(children: [
          // Outcome icon
          Container(
            width: 42, height: 42,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: won
                  ? AppColors.gold.withValues(alpha: 0.15)
                  : AppColors.red.withValues(alpha: 0.15),
            ),
            child: Center(
              child: Text(won ? '🏆' : '😞', style: const TextStyle(fontSize: 20)),
            ),
          ),
          const SizedBox(width: 12),
          // Details
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                won ? 'You Won!' : 'You Lost',
                style: TextStyle(
                    color: won ? AppColors.gold : AppColors.red,
                    fontWeight: FontWeight.bold, fontSize: 14),
              ),
              const SizedBox(height: 2),
              Text(
                'Entry: ₹${entryFee.toStringAsFixed(2)}  •  Prize: ₹${prize.toStringAsFixed(2)}',
                style: const TextStyle(color: Colors.white54, fontSize: 12),
              ),
              if (endedAt != null) ...[
                const SizedBox(height: 2),
                Text(
                  _formatDate(endedAt),
                  style: const TextStyle(color: Colors.white38, fontSize: 11),
                ),
              ],
            ]),
          ),
          // Net result
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(
              '${won ? '+' : ''}₹${net.abs().toStringAsFixed(2)}',
              style: TextStyle(
                  color: won ? const Color(0xFF2ECC71) : AppColors.red,
                  fontWeight: FontWeight.bold, fontSize: 16),
            ),
            const SizedBox(height: 2),
            Text('Teen Patti',
                style: const TextStyle(color: Colors.white38, fontSize: 10)),
          ]),
        ]),
      ),
    );
  }

  String _formatDate(DateTime dt) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final h = dt.hour > 12 ? dt.hour - 12 : (dt.hour == 0 ? 12 : dt.hour);
    final ampm = dt.hour >= 12 ? 'PM' : 'AM';
    final m = dt.minute.toString().padLeft(2, '0');
    return '${dt.day} ${months[dt.month - 1]} ${dt.year} • $h:$m $ampm';
  }
}
