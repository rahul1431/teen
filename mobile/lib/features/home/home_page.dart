import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:go_router/go_router.dart';
import '../../core/constants/app_config.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/secure_storage.dart';
import '../../shared/theme/app_theme.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int _selectedIndex = 0;
  Map<String, dynamic>? _user;
  String _realBalance = '0.00';
  String _bonusBalance = '0.00';

  @override
  void initState() {
    super.initState();
    _loadUserData();
  }

  Future<void> _loadUserData() async {
    try {
      final [userRes, walletRes] = await Future.wait([
        ApiClient().dio.get('/api/users/me'),
        ApiClient().dio.get('/api/wallet/balance'),
      ]);
      setState(() {
        _user = userRes.data;
        _realBalance = double.parse(walletRes.data['real_balance'].toString()).toStringAsFixed(2);
        _bonusBalance = double.parse(walletRes.data['bonus_balance'].toString()).toStringAsFixed(2);
      });
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(child: _buildHeader()),
            SliverToBoxAdapter(child: _buildBalanceCard()),
            SliverToBoxAdapter(child: _buildGamesSection()),
          ],
        ),
      ),
      bottomNavigationBar: _buildBottomNav(),
    );
  }

  Widget _buildHeader() => Padding(
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
    child: Row(
      children: [
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Hey, ${_user?['username'] ?? 'Player'}! 👋', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          const Text('Ready to play?', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        ]),
        const Spacer(),
        GestureDetector(
          onTap: () => context.push('/profile'),
          child: CircleAvatar(
            backgroundColor: AppColors.gold,
            child: Text((_user?['username']?[0] ?? 'P').toUpperCase(), style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
          ),
        ),
      ],
    ),
  );

  Widget _buildBalanceCard() => Container(
    margin: const EdgeInsets.all(20),
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      gradient: const LinearGradient(colors: [Color(0xFF1A2035), Color(0xFF0D1117)], begin: Alignment.topLeft, end: Alignment.bottomRight),
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: AppColors.gold.withOpacity(0.3)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Total Balance', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        const SizedBox(height: 4),
        Text('₹$_realBalance', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: AppColors.gold)),
        const SizedBox(height: 8),
        Row(
          children: [
            _balanceChip('Bonus', '₹$_bonusBalance', Colors.orange),
            const Spacer(),
            GestureDetector(
              onTap: () => context.push('/wallet'),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(color: AppColors.gold, borderRadius: BorderRadius.circular(20)),
                child: const Text('Add Money', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 12)),
              ),
            ),
          ],
        ),
      ],
    ),
  );

  Widget _balanceChip(String label, String value, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
    decoration: BoxDecoration(color: color.withOpacity(0.15), borderRadius: BorderRadius.circular(20), border: Border.all(color: color.withOpacity(0.4))),
    child: Text('$label: $value', style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
  );

  Widget _buildGamesSection() => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Games', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 16),
        _gameCard('🃏 Teen Patti', 'Multiplayer card game', 'Live tables available', AppColors.teenPattiGreen, () => context.push('/games/teen-patti')),
        const SizedBox(height: 12),
        _gameCard('✈️ Aviator', 'Crash game - cash out before it crashes!', 'Round starting soon...', AppColors.aviatorBlue, () => context.push('/games/aviator')),
        const SizedBox(height: 80),
      ],
    ),
  );

  Widget _gameCard(String title, String subtitle, String badge, Color color, VoidCallback onTap) => GestureDetector(
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 56, height: 56,
            decoration: BoxDecoration(color: color.withOpacity(0.2), borderRadius: BorderRadius.circular(14)),
            child: Center(child: Text(title.split(' ')[0], style: const TextStyle(fontSize: 28))),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title.split(' ').skip(1).join(' '), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
              Text(subtitle, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
            ]),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(color: AppColors.green.withOpacity(0.15), borderRadius: BorderRadius.circular(10)),
            child: const Text('PLAY', style: TextStyle(color: AppColors.green, fontSize: 11, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    ),
  );

  BottomNavigationBar _buildBottomNav() => BottomNavigationBar(
    currentIndex: _selectedIndex,
    onTap: (i) {
      setState(() => _selectedIndex = i);
      ['/home', '/wallet', '/leaderboard', '/profile'][i].let((path) => context.go(path));
    },
    items: const [
      BottomNavigationBarItem(icon: Icon(Icons.home_rounded), label: 'Home'),
      BottomNavigationBarItem(icon: Icon(Icons.account_balance_wallet), label: 'Wallet'),
      BottomNavigationBarItem(icon: Icon(Icons.leaderboard), label: 'Leaders'),
      BottomNavigationBarItem(icon: Icon(Icons.person), label: 'Profile'),
    ],
  );
}

extension StringLet<T> on T {
  R let<R>(R Function(T) block) => block(this);
}
