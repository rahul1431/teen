import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/secure_storage.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/error_retry.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> with SingleTickerProviderStateMixin {
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  int _selectedIndex = 0;
  Map<String, dynamic>? _user;
  double _realBalance = 0;
  double _bonusBalance = 0;
  bool _loadingData = true;
  bool _hasError = false;
  late final AnimationController _wheelCtrl;

  @override
  void initState() {
    super.initState();
    _wheelCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 10))..repeat();
    _loadData();
  }

  @override
  void dispose() { _wheelCtrl.dispose(); super.dispose(); }

  Future<void> _loadData() async {
    setState(() { _loadingData = true; _hasError = false; });
    try {
      final [userRes, walletRes] = await Future.wait([
        ApiClient().dio.get('/api/users/me'),
        ApiClient().dio.get('/api/wallet/balance'),
      ]);
      if (!mounted) return;
      setState(() {
        _user = userRes.data;
        _realBalance  = double.tryParse(walletRes.data['real_balance'].toString()) ?? 0;
        _bonusBalance = double.tryParse(walletRes.data['bonus_balance'].toString()) ?? 0;
        _loadingData = false;
      });
    } catch (_) {
      if (mounted) setState(() { _loadingData = false; _hasError = true; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _scaffoldKey,
      drawer: _buildDrawer(),
      body: SafeArea(
        child: Stack(
          children: [
            RefreshIndicator(
              onRefresh: _loadData,
              color: AppColors.gold,
              backgroundColor: AppColors.surface,
              child: CustomScrollView(
                slivers: [
                  SliverToBoxAdapter(child: _buildHeader()),
                  SliverToBoxAdapter(
                    child: _loadingData
                        ? _buildBalanceShimmer()
                        : _hasError
                            ? ErrorRetry(message: 'Could not load balance', onRetry: _loadData)
                            : _buildBalanceCard(),
                  ),
                  SliverToBoxAdapter(child: _buildGamesGrid()),
                  const SliverToBoxAdapter(child: SizedBox(height: 100)),
                ],
              ),
            ),
            Positioned(bottom: 16, left: 16, child: _buildSpinWinWheel()),
          ],
        ),
      ),
      bottomNavigationBar: _buildBottomNav(),
    );
  }

  Widget _buildHeader() => Padding(
    padding: const EdgeInsets.fromLTRB(8, 12, 20, 0),
    child: Row(
      children: [
        // Hamburger — opens the full navigation drawer (top-left).
        IconButton(
          icon: const Icon(Icons.menu_rounded, color: AppColors.gold),
          tooltip: 'Menu',
          onPressed: () => _scaffoldKey.currentState?.openDrawer(),
        ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Hey, ${_user?['username'] ?? 'Player'} 👋',
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
                overflow: TextOverflow.ellipsis,
              ),
              const Text('Ready to play today?',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            ],
          ),
        ),
        IconButton(
          icon: const Icon(Icons.notifications_outlined, color: AppColors.gold),
          onPressed: () => context.push('/notifications'),
        ),
        const SizedBox(width: 4),
        GestureDetector(
          onTap: () => context.push('/profile'),
          child: CircleAvatar(
            radius: 20,
            backgroundColor: AppColors.gold,
            child: Text(
              ((_user?['username'] as String?)?.isNotEmpty == true
                  ? _user!['username'][0]
                  : 'P').toUpperCase(),
              style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _buildBalanceShimmer() => Shimmer.fromColors(
    baseColor: AppColors.surface,
    highlightColor: AppColors.cardBg,
    child: Container(
      margin: const EdgeInsets.all(20),
      height: 110,
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(20)),
    ),
  );

  Widget _buildBalanceCard() => Container(
    margin: const EdgeInsets.all(20),
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      gradient: LinearGradient(
        colors: [AppColors.cardBg, AppColors.surface],
        begin: Alignment.topLeft, end: Alignment.bottomRight,
      ),
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: AppColors.gold.withOpacity(0.35), width: 1.5),
      boxShadow: [BoxShadow(color: AppColors.gold.withOpacity(0.08), blurRadius: 20, offset: const Offset(0, 4))],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Real Balance', style: TextStyle(color: AppColors.textSecondary, fontSize: 12, letterSpacing: 1)),
        const SizedBox(height: 4),
        Text(formatCurrency(_realBalance),
          style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w900, color: AppColors.gold)),
        const SizedBox(height: 12),
        Row(
          children: [
            _chip(Icons.card_giftcard_rounded, 'Bonus', formatCurrency(_bonusBalance), AppColors.orange),
            const Spacer(),
            GestureDetector(
              onTap: () => context.push('/wallet'),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 9),
                decoration: BoxDecoration(color: AppColors.gold, borderRadius: BorderRadius.circular(24)),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.add_rounded, color: Colors.black, size: 16),
                    SizedBox(width: 4),
                    Text('Add Money', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 12)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ],
    ),
  );

  Widget _chip(IconData icon, String label, String value, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: color.withOpacity(0.12),
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: color.withOpacity(0.3)),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: color, size: 14),
        const SizedBox(width: 4),
        Text('$label: $value', style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
      ],
    ),
  );

  Widget _buildGamesGrid() => Padding(
    padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Games', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
        const SizedBox(height: 14),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 14,
          crossAxisSpacing: 14,
          childAspectRatio: 1.0,
          children: [
            _menuCard('Teen Patti', Icons.style_rounded, AppColors.teenPattiGrad,
                () => context.push('/games/teen-patti')),
            _menuCard('Aviator', Icons.flight_rounded, AppColors.aviatorGrad,
                () => context.push('/games/aviator')),
            _menuCard('Ludo', Icons.casino_rounded, AppColors.ludoGrad,
                () => context.push('/games/ludo')),
            _menuCard('Cricket Betting', Icons.sports_cricket_rounded, AppColors.cricketGrad,
                () => context.push('/games/cricket')),
            _menuCard('Matka', Icons.confirmation_number_rounded, AppColors.matkaGrad,
                () => context.push('/games/matka')),
            _menuCard('Lottery', Icons.local_activity_rounded, AppColors.lotteryGrad,
                () => context.push('/games/lottery')),
            _menuCard('Premium Table', Icons.workspace_premium_rounded, AppColors.premiumGrad,
                () => context.push('/games/teen-patti?premium=1')),
          ],
        ),
      ],
    ),
  );

  Widget _menuCard(String title, IconData icon, List<Color> gradient, VoidCallback onTap) =>
    GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: gradient),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.gold.withOpacity(0.5), width: 1.5),
          boxShadow: [BoxShadow(color: gradient.last.withOpacity(0.5), blurRadius: 16, offset: const Offset(0, 6))],
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: Colors.white,
                    shadows: [Shadow(color: Colors.black38, blurRadius: 4)])),
              Align(
                alignment: Alignment.bottomRight,
                child: Container(
                  width: 52, height: 52,
                  decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(14)),
                  child: Icon(icon, color: Colors.white.withOpacity(0.9), size: 30),
                ),
              ),
            ],
          ),
        ),
      ),
    );

  void _comingSoon(String feature) =>
    AppSnackBar.show(context, '$feature — coming soon!');

  Widget _buildSpinWinWheel() => GestureDetector(
    onTap: () => _comingSoon('Spin & Win'),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        RotationTransition(
          turns: _wheelCtrl,
          child: Container(
            width: 52, height: 52,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const SweepGradient(colors: [
                AppColors.feltRed, AppColors.gold, Color(0xFF0E5C2F),
                Color(0xFF1E3A8A), AppColors.gold, AppColors.feltRed,
              ]),
              border: Border.all(color: AppColors.gold, width: 2.5),
              boxShadow: [BoxShadow(color: AppColors.gold.withOpacity(0.4), blurRadius: 12)],
            ),
            child: const Icon(Icons.adjust_rounded, color: Colors.white, size: 22),
          ),
        ),
        const SizedBox(height: 4),
        const Text('Spin & Win',
            style: TextStyle(color: AppColors.gold, fontSize: 9, fontWeight: FontWeight.bold, letterSpacing: 0.5)),
      ],
    ),
  );

  BottomNavigationBar _buildBottomNav() => BottomNavigationBar(
    currentIndex: _selectedIndex,
    type: BottomNavigationBarType.fixed,
    showUnselectedLabels: true,
    selectedItemColor: AppColors.gold,
    unselectedItemColor: AppColors.textSecondary,
    backgroundColor: AppColors.surface,
    onTap: (i) {
      if (i == _selectedIndex) return;
      // Home stays in place; the others push so the back button returns here
      // and the footer highlight resets correctly on return.
      setState(() => _selectedIndex = i);
      const paths = ['/home', '/wallet', '/leaderboard', '/profile'];
      if (i == 0) return;
      context.push(paths[i]).then((_) {
        if (mounted) setState(() => _selectedIndex = 0);
      });
    },
    items: const [
      BottomNavigationBarItem(icon: Icon(Icons.home_rounded), label: 'Home'),
      BottomNavigationBarItem(icon: Icon(Icons.account_balance_wallet_rounded), label: 'Wallet'),
      BottomNavigationBarItem(icon: Icon(Icons.leaderboard_rounded), label: 'Leaders'),
      BottomNavigationBarItem(icon: Icon(Icons.person_rounded), label: 'Profile'),
    ],
  );

  // Full navigation drawer — every section + all games in one place.
  Widget _buildDrawer() => Drawer(
    backgroundColor: AppColors.background,
    child: SafeArea(
      child: Column(
        children: [
          // Profile / balance header.
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                  colors: [AppColors.cardBg, AppColors.surface],
                  begin: Alignment.topLeft, end: Alignment.bottomRight),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 24,
                      backgroundColor: AppColors.gold,
                      child: Text(
                        ((_user?['username'] as String?)?.isNotEmpty == true
                            ? _user!['username'][0]
                            : 'P').toUpperCase(),
                        style: const TextStyle(
                            color: Colors.black, fontWeight: FontWeight.bold, fontSize: 18),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(_user?['username'] ?? 'Player',
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 16, fontWeight: FontWeight.w900)),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text('Balance: ${formatCurrency(_realBalance)}',
                    style: const TextStyle(
                        color: AppColors.gold, fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                _drawerItem(Icons.home_rounded, 'Home', '/home'),
                _drawerItem(Icons.account_balance_wallet_rounded, 'Wallet', '/wallet'),
                _drawerItem(Icons.leaderboard_rounded, 'Leaderboard', '/leaderboard'),
                _drawerItem(Icons.notifications_rounded, 'Notifications', '/notifications'),
                _drawerItem(Icons.person_rounded, 'Profile', '/profile'),
                const Padding(
                  padding: EdgeInsets.fromLTRB(20, 14, 20, 6),
                  child: Text('GAMES',
                      style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 11,
                          letterSpacing: 1.5,
                          fontWeight: FontWeight.bold)),
                ),
                _drawerItem(Icons.style_rounded, 'Teen Patti', '/games/teen-patti'),
                _drawerItem(Icons.flight_rounded, 'Aviator', '/games/aviator'),
                _drawerItem(Icons.casino_rounded, 'Ludo', '/games/ludo'),
                _drawerItem(Icons.sports_cricket_rounded, 'Cricket Betting', '/games/cricket'),
                _drawerItem(Icons.confirmation_number_rounded, 'Matka', '/games/matka'),
                _drawerItem(Icons.local_activity_rounded, 'Lottery', '/games/lottery'),
                const Divider(color: AppColors.border, height: 24),
                ListTile(
                  leading: const Icon(Icons.logout_rounded, color: AppColors.red),
                  title: const Text('Logout',
                      style: TextStyle(color: AppColors.red)),
                  onTap: () async {
                    await SecureStorage.clearAll();
                    if (mounted) context.go('/auth/login');
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );

  Widget _drawerItem(IconData icon, String label, String route) => ListTile(
        leading: Icon(icon, color: AppColors.gold),
        title: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
        onTap: () {
          Navigator.pop(context); // close the drawer first
          if (route == '/home') return;
          context.push(route);
        },
      );
}
