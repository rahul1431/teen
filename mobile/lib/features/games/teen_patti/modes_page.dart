import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';

class TeenPattiModesPage extends StatefulWidget {
  const TeenPattiModesPage({super.key});
  @override
  State<TeenPattiModesPage> createState() => _TeenPattiModesPageState();
}

class _TeenPattiModesPageState extends State<TeenPattiModesPage> {
  String? _balance;

  @override
  void initState() {
    super.initState();
    _loadBalance();
  }

  Future<void> _loadBalance() async {
    try {
      final res = await ApiClient().dio.get('/api/wallet/balance');
      if (!mounted) return;
      setState(() => _balance =
          double.parse(res.data['real_balance'].toString()).toStringAsFixed(0));
    } catch (_) {/* offline / no auth — leave as '—' */}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Teen Patti'),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                decoration: BoxDecoration(
                  color: AppColors.feltDark,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppColors.gold.withValues(alpha: 0.6)),
                ),
                child: Text('₹${_balance ?? '—'}',
                    style: const TextStyle(
                        color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 13)),
              ),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text('Choose a Mode',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          const Text('Pick how you want to play',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          const SizedBox(height: 20),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 14,
            crossAxisSpacing: 14,
            childAspectRatio: 0.92,
            children: [
              _modeCard(
                title: 'Classic',
                subtitle: 'Standard Teen Patti',
                icon: Icons.style_rounded,
                gradient: AppColors.teenPattiGrad,
                onTap: () => context.push('/games/teen-patti/lobby?variation=classic'),
              ),
              _modeCard(
                title: 'AK47',
                subtitle: 'A · K · 4 · 7 are jokers',
                icon: Icons.auto_awesome_rounded,
                gradient: AppColors.premiumGrad,
                onTap: () => context.push('/games/teen-patti/lobby?variation=ak47'),
              ),
              _modeCard(
                title: 'Practice',
                subtitle: 'Play vs bots · free',
                icon: Icons.smart_toy_rounded,
                gradient: AppColors.variationsGrad,
                onTap: () => context.push('/games/teen-patti/demo'),
              ),
              _modeCard(
                title: 'Friends',
                subtitle: 'Private table',
                icon: Icons.group_rounded,
                gradient: AppColors.aviatorGrad,
                onTap: () => AppSnackBar.show(context, 'Private tables — coming soon!'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _modeCard({
    required String title,
    required String subtitle,
    required IconData icon,
    required List<Color> gradient,
    required VoidCallback onTap,
  }) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
                begin: Alignment.topLeft, end: Alignment.bottomRight, colors: gradient),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.gold.withValues(alpha: 0.5), width: 1.5),
            boxShadow: [
              BoxShadow(color: gradient.last.withValues(alpha: 0.5), blurRadius: 16, offset: const Offset(0, 6)),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 48, height: 48,
                  decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(14)),
                  child: Icon(icon, color: Colors.white.withValues(alpha: 0.9), size: 28),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w900, color: Colors.white,
                            shadows: [Shadow(color: Colors.black38, blurRadius: 4)])),
                    const SizedBox(height: 2),
                    Text(subtitle,
                        style: TextStyle(fontSize: 11, color: Colors.white.withValues(alpha: 0.85))),
                  ],
                ),
              ],
            ),
          ),
        ),
      );
}
