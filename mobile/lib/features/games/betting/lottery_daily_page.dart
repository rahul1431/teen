import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../shared/theme/app_theme.dart';
import 'lottery_daily_browse_tab.dart';
import 'lottery_daily_my_tickets_tab.dart';
import 'lottery_daily_history_tab.dart';

class LotteryDailyPage extends StatefulWidget {
  const LotteryDailyPage({super.key});

  @override
  State<LotteryDailyPage> createState() => _LotteryDailyPageState();
}

class _LotteryDailyPageState extends State<LotteryDailyPage> with TickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
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
            Text('🎰', style: TextStyle(fontSize: 18)),
            SizedBox(width: 6),
            Text('DAILY LOTTERY',
                style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.5,
                    color: AppColors.goldLight)),
          ],
        ),
        bottom: TabBar(
          controller: _tabController,
          labelColor: AppColors.goldLight,
          unselectedLabelColor: Colors.grey,
          indicatorColor: AppColors.goldLight,
          tabs: const [
            Tab(text: 'Browse'),
            Tab(text: 'My Tickets'),
            Tab(text: 'History'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          LotteryDailyBrowseTab(),
          LotteryDailyMyTicketsTab(),
          LotteryDailyHistoryTab(),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }
}
