import 'package:flutter/material.dart';
import '../../core/network/api_client.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/error_retry.dart';

class LeaderboardPage extends StatefulWidget {
  const LeaderboardPage({super.key});
  @override
  State<LeaderboardPage> createState() => _LeaderboardPageState();
}

class _LeaderboardPageState extends State<LeaderboardPage> with SingleTickerProviderStateMixin {
  late final TabController _tabCtrl;
  final _api = ApiClient();
  List<dynamic> _entries = [];
  bool _loading = false;
  bool _hasError = false;
  String _gameType = 'teen_patti';
  String _period = 'daily';

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 2, vsync: this);
    _tabCtrl.addListener(() {
      if (!_tabCtrl.indexIsChanging) {
        setState(() => _gameType = _tabCtrl.index == 0 ? 'teen_patti' : 'aviator');
        _load();
      }
    });
    _load();
  }

  @override
  void dispose() { _tabCtrl.dispose(); super.dispose(); }

  Future<void> _load() async {
    setState(() { _loading = true; _hasError = false; });
    try {
      final res = await _api.dio.get('/api/leaderboard/$_gameType?period=$_period');
      if (mounted) setState(() { _entries = res.data['entries'] as List; _loading = false; });
    } catch (_) {
      if (mounted) setState(() { _loading = false; _hasError = true; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Leaderboard'),
        bottom: TabBar(
          controller: _tabCtrl,
          indicatorColor: AppColors.gold,
          labelColor: AppColors.gold,
          unselectedLabelColor: AppColors.textSecondary,
          tabs: const [
            Tab(icon: Icon(Icons.style_rounded, size: 16), text: 'Teen Patti'),
            Tab(icon: Icon(Icons.flight_rounded, size: 16), text: 'Aviator'),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: DropdownButton<String>(
              value: _period,
              dropdownColor: AppColors.surface,
              underline: const SizedBox(),
              style: const TextStyle(color: AppColors.gold, fontSize: 13),
              items: const [
                DropdownMenuItem(value: 'daily', child: Text('Daily')),
                DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
              ],
              onChanged: (v) { setState(() => _period = v!); _load(); },
            ),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : _hasError
              ? ErrorRetry(message: 'Could not load leaderboard', onRetry: _load)
              : _entries.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.leaderboard_rounded, size: 64, color: AppColors.textSecondary.withOpacity(0.4)),
                          const SizedBox(height: 12),
                          const Text('No data yet', style: TextStyle(color: AppColors.textSecondary)),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      color: AppColors.gold,
                      backgroundColor: AppColors.surface,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _entries.length,
                        itemBuilder: (_, i) => _buildRow(_entries[i], i),
                      ),
                    ),
    );
  }

  Widget _buildRow(Map<String, dynamic> e, int i) {
    final rank = e['rank'] as int;
    final isTop3 = rank <= 3;
    final medalColor = rank == 1 ? AppColors.gold
        : rank == 2 ? const Color(0xFFB0BEC5)
        : const Color(0xFFCD7F32);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: isTop3 ? AppColors.gold.withOpacity(0.07) : AppColors.cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: isTop3 ? AppColors.gold.withOpacity(0.35) : AppColors.border),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 36,
            child: isTop3
                ? Icon(Icons.emoji_events_rounded, color: medalColor, size: 26)
                : Text('#$rank', style: const TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(width: 10),
          CircleAvatar(
            radius: 18,
            backgroundColor: AppColors.gold.withOpacity(0.2),
            child: Text(
              (e['username'] as String)[0].toUpperCase(),
              style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 14),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(e['username'] as String,
                style: TextStyle(fontWeight: isTop3 ? FontWeight.w700 : FontWeight.normal)),
          ),
          Text(
            formatCurrency(e['score']),
            style: TextStyle(
              color: isTop3 ? AppColors.gold : AppColors.textPrimary,
              fontWeight: FontWeight.bold,
              fontSize: 15,
            ),
          ),
        ],
      ),
    );
  }
}
