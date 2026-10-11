import 'package:flutter/material.dart';
import '../../../../shared/theme/app_theme.dart';
import 'data/cricket_api.dart';
import 'data/cricket_models.dart';
import 'screens/fixtures_tab.dart';
import 'screens/history_tab.dart';

/// Premium Cricket Hub — Traditional Match Winner Odds & Session Betting.
/// 2-tab shell: Fixtures / History.
class CricketPage extends StatefulWidget {
  const CricketPage({super.key});
  @override
  State<CricketPage> createState() => _CricketPageState();
}

class _CricketPageState extends State<CricketPage> with SingleTickerProviderStateMixin {
  final _api = CricketApi();
  late final TabController _tabs;
  List<CricketMatch> _matches = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final matches = await _api.fetchMatches();
    if (!mounted) return;
    setState(() {
      _matches = matches;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Sports Betting', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
        bottom: TabBar(
          controller: _tabs,
          indicatorColor: AppColors.pitchGreenLight,
          indicatorWeight: 3,
          labelColor: AppColors.pitchGreenLight,
          unselectedLabelColor: AppColors.textSecondary,
          labelPadding: const EdgeInsets.symmetric(horizontal: 4),
          labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
          tabs: const [
            Tab(icon: Icon(Icons.sports_soccer_rounded, size: 18), text: 'Fixtures'),
            Tab(icon: Icon(Icons.history_rounded, size: 18), text: 'Bet History'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : TabBarView(
              controller: _tabs,
              children: [
                FixturesTab(matches: _matches, onRefresh: _load),
                const HistoryTab(),
              ],
            ),
    );
  }
}
