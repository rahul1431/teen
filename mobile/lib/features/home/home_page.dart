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

class _HomePageState extends State<HomePage> with SingleTickerProviderStateMixin {
  int _selectedIndex = 0;
  Map<String, dynamic>? _user;
  String _realBalance = '0.00';
  String _bonusBalance = '0.00';
  late final AnimationController _wheelCtrl;

  @override
  void initState() {
    super.initState();
    _wheelCtrl = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 8),
    )..repeat();
    _loadUserData();
  }

  @override
  void dispose() {
    _wheelCtrl.dispose();
    super.dispose();
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
        child: Stack(
          children: [
            CustomScrollView(
              slivers: [
                SliverToBoxAdapter(child: _buildHeader()),
                SliverToBoxAdapter(child: _buildBalanceCard()),
                SliverToBoxAdapter(child: _buildGamesGrid()),
              ],
            ),
            Positioned(bottom: 16, left: 16, child: _buildSpinWinWheel()),
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
        IconButton(
          icon: const Icon(Icons.notifications_outlined, color: AppColors.gold),
          onPressed: () => context.push('/notifications'),
          tooltip: 'Notifications',
        ),
        const SizedBox(width: 4),
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

  Widget _buildGamesGrid() => Padding(
    padding: const EdgeInsets.fromLTRB(20, 0, 20, 100),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Games', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 16),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 14,
          crossAxisSpacing: 14,
          childAspectRatio: 0.95,
          children: [
            _menuCard('Teen Patti', '🃏', const [Color(0xFFB11226), Color(0xFF7A0C1A)],
                () => context.push('/games/teen-patti')),
            _menuCard('Aviator', '✈️', const [Color(0xFF1E3A8A), Color(0xFF0B1E52)],
                () => context.push('/games/aviator')),
            _menuCard('Premium Table', '👑', const [Color(0xFFD4AF37), Color(0xFF8A6D1E)],
                () => context.push('/games/teen-patti?premium=1')),
            _menuCard('Variations', '🎲', const [Color(0xFF0E5C2F), Color(0xFF08401F)],
                () => _comingSoon('Variations')),
          ],
        ),
      ],
    ),
  );

  Widget _menuCard(String title, String icon, List<Color> gradient, VoidCallback onTap) => GestureDetector(
    onTap: onTap,
    child: Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: gradient),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.gold.withOpacity(0.6), width: 2),
        boxShadow: [
          BoxShadow(color: gradient.last.withOpacity(0.55), blurRadius: 16, offset: const Offset(0, 6)),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    color: Colors.white,
                    shadows: [Shadow(color: Colors.black54, blurRadius: 4)])),
            Align(
              alignment: Alignment.bottomRight,
              child: Container(
                width: 64,
                height: 64,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.black26,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(icon, style: const TextStyle(fontSize: 38)),
              ),
            ),
          ],
        ),
      ),
    ),
  );

  void _comingSoon(String feature) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$feature — coming soon'), behavior: SnackBarBehavior.floating),
    );
  }

  /// Decorative Spin & Win wheel — animates, taps to "coming soon".
  Widget _buildSpinWinWheel() => GestureDetector(
    onTap: () => _comingSoon('Spin & Win'),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        RotationTransition(
          turns: _wheelCtrl,
          child: Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const SweepGradient(
                colors: [
                  Color(0xFFB11226),
                  Color(0xFFD4AF37),
                  Color(0xFF0E5C2F),
                  Color(0xFF1E3A8A),
                  Color(0xFFD4AF37),
                  Color(0xFFB11226),
                ],
              ),
              border: Border.all(color: AppColors.gold, width: 3),
              boxShadow: [
                BoxShadow(color: AppColors.gold.withOpacity(0.5), blurRadius: 12, spreadRadius: 1),
              ],
            ),
            child: const Center(
              child: Text('🎯', style: TextStyle(fontSize: 22)),
            ),
          ),
        ),
        const SizedBox(height: 4),
        const Text('Spin & Win',
            style: TextStyle(color: AppColors.gold, fontSize: 10, fontWeight: FontWeight.bold)),
      ],
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
