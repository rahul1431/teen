import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/secure_storage.dart';
import '../../shared/theme/app_theme.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});
  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  final _api = ApiClient();
  Map<String, dynamic>? _user;

  @override
  void initState() {
    super.initState();
    _api.dio.get('/api/users/me').then((r) => setState(() => _user = r.data)).catchError((_) {});
  }

  Future<void> _logout() async {
    await SecureStorage.clearAll();
    if (mounted) context.go('/auth/login');
  }

  @override
  Widget build(BuildContext context) {
    if (_user == null) return const Scaffold(body: Center(child: CircularProgressIndicator(color: AppColors.gold)));

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // Avatar + name
          Center(
            child: Column(
              children: [
                CircleAvatar(
                  radius: 40,
                  backgroundColor: AppColors.gold,
                  child: Text((_user!['username']?[0] ?? 'P').toUpperCase(), style: const TextStyle(fontSize: 32, color: Colors.black, fontWeight: FontWeight.bold)),
                ),
                const SizedBox(height: 12),
                Text(_user!['username'] ?? '', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                Text('+91${_user!['phone'] ?? ''}', style: const TextStyle(color: AppColors.textSecondary)),
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: _user!['kyc_status'] == 'approved' ? AppColors.green.withOpacity(0.15) : Colors.orange.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    _user!['kyc_status'] == 'approved' ? '✓ KYC Verified' : '⚠ KYC Pending',
                    style: TextStyle(color: _user!['kyc_status'] == 'approved' ? AppColors.green : Colors.orange, fontSize: 12),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Stats
          Row(
            children: [
              _statCard('Games\nPlayed', _user!['total_games']?.toString() ?? '0'),
              const SizedBox(width: 12),
              _statCard('Total\nWinnings', '₹${double.parse((_user!['total_winnings'] ?? 0).toString()).toStringAsFixed(0)}'),
            ],
          ),
          const SizedBox(height: 24),

          // Referral
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: AppColors.cardBg, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppColors.border)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Referral Code', style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Text(_user!['referral_code'] ?? '-', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: AppColors.gold, letterSpacing: 4)),
                    const Spacer(),
                    IconButton(icon: const Icon(Icons.copy, color: AppColors.gold), onPressed: () {
                      Clipboard.setData(ClipboardData(text: _user!['referral_code'] ?? ''));
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Code copied!')));
                    }),
                    IconButton(icon: const Icon(Icons.share, color: AppColors.gold), onPressed: () {
                      Share.share('Join me on MyOnlineJoker! Use code ${_user!['referral_code']} and get ₹50 bonus. Download: http://game.myonlinejoker.com');
                    }),
                  ],
                ),
                const Text('Earn ₹50 for every friend who joins and deposits!', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Logout
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _logout,
              icon: const Icon(Icons.logout, color: AppColors.red),
              label: const Text('Logout', style: TextStyle(color: AppColors.red)),
              style: OutlinedButton.styleFrom(side: const BorderSide(color: AppColors.red), padding: const EdgeInsets.symmetric(vertical: 14)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _statCard(String label, String value) => Expanded(
    child: Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: AppColors.cardBg, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppColors.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
        ],
      ),
    ),
  );
}
