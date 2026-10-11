import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';

/// Rummy game history — paginated list of settled Rummy games for the player,
/// backed by `/api/wallet/game-history?game_type=rummy`.
class RummyHistoryPage extends StatefulWidget {
  const RummyHistoryPage({super.key});

  @override
  State<RummyHistoryPage> createState() => _RummyHistoryPageState();
}

class _RummyHistoryPageState extends State<RummyHistoryPage> {
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
          !_loadingMore &&
          _hasMore) {
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
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await _api.dio.get(
        '/api/wallet/game-history',
        queryParameters: {'game_type': 'rummy', 'limit': 20, 'offset': 0},
      );
      final rows = (res.data as List?) ?? [];
      setState(() {
        _records = rows;
        _offset = rows.length;
        _hasMore = rows.length >= 20;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMore) return;
    setState(() => _loadingMore = true);
    try {
      final res = await _api.dio.get(
        '/api/wallet/game-history',
        queryParameters: {'game_type': 'rummy', 'limit': 20, 'offset': _offset},
      );
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
        title: const Text(
          'Rummy Game History',
          style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold),
        ),
        iconTheme: const IconThemeData(color: AppColors.gold),
        elevation: 0,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.error_outline, color: AppColors.red, size: 48),
                      const SizedBox(height: 12),
                      Text(
                        _error!,
                        style: const TextStyle(color: Colors.white54, fontSize: 13),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 16),
                      TextButton(
                        onPressed: _load,
                        child: const Text('Retry', style: TextStyle(color: AppColors.gold)),
                      ),
                    ],
                  ),
                )
              : _records.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: const [
                          Icon(Icons.style_rounded, color: Colors.white24, size: 56),
                          SizedBox(height: 12),
                          Text(
                            'No Rummy games played yet.',
                            style: TextStyle(color: Colors.white54, fontSize: 15),
                          ),
                          SizedBox(height: 4),
                          Text(
                            'Play 13-Card Rummy to see your game history & winnings here!',
                            style: TextStyle(color: Colors.white30, fontSize: 12),
                          ),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      color: AppColors.gold,
                      backgroundColor: const Color(0xFF0D1833),
                      onRefresh: _load,
                      child: ListView.builder(
                        controller: _scroll,
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        itemCount: _records.length + (_hasMore ? 1 : 0),
                        itemBuilder: (context, i) {
                          if (i >= _records.length) {
                            return const Center(
                              child: Padding(
                                padding: EdgeInsets.all(16.0),
                                child: CircularProgressIndicator(
                                  color: AppColors.gold,
                                  strokeWidth: 2,
                                ),
                              ),
                            );
                          }
                          final r = _records[i] as Map<String, dynamic>;
                          return _buildHistoryCard(r);
                        },
                      ),
                    ),
    );
  }

  Widget _buildHistoryCard(Map<String, dynamic> r) {
    final entry = double.tryParse(r['entry_fee_deducted']?.toString() ?? r['entry_fee']?.toString() ?? '0') ?? 0.0;
    final prize = double.tryParse(r['prize_won']?.toString() ?? '0') ?? 0.0;
    final finalRank = int.tryParse(r['final_rank']?.toString() ?? '0');
    final rawNet = double.tryParse(r['net_result']?.toString() ?? '0') ?? 0.0;
    final won = rawNet > 0 || prize > entry || finalRank == 1;
    final net = won ? (rawNet > 0 ? rawNet : (prize - entry > 0 ? prize - entry : prize)) : entry;
    final endedAt = r['ended_at'] != null ? DateTime.tryParse(r['ended_at'].toString()) : null;
    final dateStr = endedAt != null ? DateFormat('dd MMM yyyy, hh:mm a').format(endedAt.toLocal()) : '—';
    final roomId = r['room_id']?.toString() ?? '—';
    final shortRoomId = roomId.length > 8 ? roomId.substring(0, 8) : roomId;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: won
              ? const Color(0xFF10B981).withValues(alpha: 0.3)
              : Colors.white.withValues(alpha: 0.08),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.3),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: won
                      ? const Color(0xFF10B981).withValues(alpha: 0.15)
                      : const Color(0xFFEF4444).withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  won ? Icons.emoji_events_rounded : Icons.style_rounded,
                  color: won ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                  size: 20,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Text(
                          '13-Card Rummy',
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 14,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                          decoration: BoxDecoration(
                            color: Colors.white10,
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            '#$shortRoomId',
                            style: const TextStyle(color: Colors.white70, fontSize: 10),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      dateStr,
                      style: const TextStyle(color: Colors.white38, fontSize: 11),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    won ? '+₹${net.toStringAsFixed(2)}' : '-₹${entry.toStringAsFixed(2)}',
                    style: TextStyle(
                      color: won ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                      fontWeight: FontWeight.w900,
                      fontSize: 15,
                    ),
                  ),
                  Text(
                    won ? 'WON' : 'LOST',
                    style: TextStyle(
                      color: won ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                      fontWeight: FontWeight.bold,
                      fontSize: 10,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Divider(height: 1, color: Colors.white10),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _infoTile('Entry Fee', '₹${entry.toStringAsFixed(0)}'),
              _infoTile('Prize', prize > 0 ? '₹${prize.toStringAsFixed(0)}' : '₹0'),
              _infoTile('Status', won ? '1st (Winner)' : 'Settled',
                  valueColor: won ? const Color(0xFFFFD700) : Colors.white70),
            ],
          ),
        ],
      ),
    );
  }

  Widget _infoTile(String label, String value, {Color valueColor = Colors.white70}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: Colors.white38, fontSize: 10)),
        const SizedBox(height: 2),
        Text(
          value,
          style: TextStyle(color: valueColor, fontWeight: FontWeight.w600, fontSize: 12),
        ),
      ],
    );
  }
}
