import 'package:flutter/material.dart';
import '../../core/network/api_client.dart';
import '../../shared/theme/app_theme.dart';

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

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await _api.dio.get('/api/leaderboard/$_gameType?period=$_period');
      setState(() => _entries = res.data['entries']);
    } finally {
      setState(() => _loading = false);
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
          tabs: const [Tab(text: '🃏 Teen Patti'), Tab(text: '✈️ Aviator')],
        ),
        actions: [
          DropdownButton<String>(
            value: _period,
            dropdownColor: AppColors.surface,
            underline: const SizedBox(),
            style: const TextStyle(color: AppColors.gold),
            items: const [
              DropdownMenuItem(value: 'daily', child: Text('Daily')),
              DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
            ],
            onChanged: (v) { setState(() => _period = v!); _load(); },
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : _entries.isEmpty
              ? const Center(child: Text('No data yet', style: TextStyle(color: AppColors.textSecondary)))
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _entries.length,
                  itemBuilder: (_, i) {
                    final e = _entries[i];
                    final rank = e['rank'] as int;
                    return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: rank <= 3 ? AppColors.gold.withOpacity(0.1) : AppColors.cardBg,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: rank <= 3 ? AppColors.gold.withOpacity(0.4) : AppColors.border),
                      ),
                      child: Row(
                        children: [
                          SizedBox(
                            width: 40,
                            child: Text(
                              rank == 1 ? '🥇' : rank == 2 ? '🥈' : rank == 3 ? '🥉' : '#$rank',
                              style: const TextStyle(fontSize: 20),
                              textAlign: TextAlign.center,
                            ),
                          ),
                          const SizedBox(width: 12),
                          CircleAvatar(
                            radius: 20,
                            backgroundColor: AppColors.gold.withOpacity(0.2),
                            child: Text(e['username'][0].toUpperCase(), style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold)),
                          ),
                          const SizedBox(width: 12),
                          Expanded(child: Text(e['username'], style: const TextStyle(fontWeight: FontWeight.w600))),
                          Text('₹${double.parse(e['score'].toString()).toStringAsFixed(0)}', style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    );
                  },
                ),
    );
  }
}
