import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/secure_storage.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/error_retry.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});
  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  final _api = ApiClient();
  Map<String, dynamic>? _user;
  bool _loading = true;
  bool _hasError = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _hasError = false; });
    try {
      final res = await _api.dio.get('/api/users/me');
      if (mounted) setState(() { _user = res.data; _loading = false; });
    } catch (_) {
      if (mounted) setState(() { _loading = false; _hasError = true; });
    }
  }

  Future<void> _logout() async {
    await SecureStorage.clearAll();
    if (mounted) context.go('/auth/login');
  }

  bool get _kycApproved => _user?['kyc_status'] == 'approved';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : _hasError
              ? ErrorRetry(message: 'Could not load profile', onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  color: AppColors.gold,
                  backgroundColor: AppColors.surface,
                  child: ListView(
                    padding: const EdgeInsets.all(20),
                    children: [
                      _buildAvatar(),
                      const SizedBox(height: 24),
                      _buildStats(),
                      const SizedBox(height: 16),
                      _buildKycBanner(),
                      const SizedBox(height: 16),
                      _buildReferralCard(),
                      const SizedBox(height: 24),
                      _buildLogoutButton(),
                      const SizedBox(height: 32),
                    ],
                  ),
                ),
    );
  }

  Widget _buildAvatar() => Center(
    child: Column(
      children: [
        Container(
          width: 80, height: 80,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: const LinearGradient(colors: [AppColors.gold, AppColors.goldLight]),
            boxShadow: [BoxShadow(color: AppColors.gold.withOpacity(0.4), blurRadius: 20, spreadRadius: 2)],
          ),
          child: Center(
            child: Text(
              ((_user?['username'] as String?)?.isNotEmpty == true ? _user!['username'][0] : 'P').toUpperCase(),
              style: const TextStyle(fontSize: 34, color: Colors.black, fontWeight: FontWeight.bold),
            ),
          ),
        ),
        const SizedBox(height: 14),
        Text(_user?['username'] ?? '', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
        const SizedBox(height: 4),
        Text('+91 ${_user?['phone'] ?? ''}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 14)),
      ],
    ),
  );

  Widget _buildKycBanner() => GestureDetector(
    onTap: _kycApproved ? null : () => AppSnackBar.show(context, 'KYC verification coming soon'),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: (_kycApproved ? AppColors.green : AppColors.orange).withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: (_kycApproved ? AppColors.green : AppColors.orange).withOpacity(0.4)),
      ),
      child: Row(
        children: [
          Icon(
            _kycApproved ? Icons.verified_rounded : Icons.warning_amber_rounded,
            color: _kycApproved ? AppColors.green : AppColors.orange,
            size: 20,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _kycApproved ? 'KYC Verified' : 'KYC Pending',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: _kycApproved ? AppColors.green : AppColors.orange,
                    fontSize: 13,
                  ),
                ),
                if (!_kycApproved)
                  const Text('Complete KYC to enable withdrawals', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              ],
            ),
          ),
          if (!_kycApproved)
            Icon(Icons.chevron_right_rounded, color: AppColors.orange, size: 20),
        ],
      ),
    ),
  );

  Widget _buildStats() => Row(
    children: [
      _statCard(Icons.sports_esports_rounded, 'Games Played', _user?['total_games']?.toString() ?? '0'),
      const SizedBox(width: 12),
      _statCard(Icons.emoji_events_rounded, 'Total Winnings',
          formatCurrency(_user?['total_winnings'] ?? 0)),
    ],
  );

  Widget _statCard(IconData icon, String label, String value) => Expanded(
    child: Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: AppColors.gold, size: 20),
          const SizedBox(height: 8),
          Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
        ],
      ),
    ),
  );

  Widget _buildReferralCard() => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: AppColors.cardBg,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: AppColors.gold.withOpacity(0.3)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Row(
          children: [
            Icon(Icons.card_giftcard_rounded, color: AppColors.gold, size: 18),
            SizedBox(width: 8),
            Text('Referral Code', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: Text(
                _user?['referral_code'] ?? '—',
                style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: AppColors.gold, letterSpacing: 5),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.copy_rounded, color: AppColors.gold, size: 20),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: _user?['referral_code'] ?? ''));
                AppSnackBar.show(context, 'Referral code copied!', success: true);
              },
            ),
            IconButton(
              icon: const Icon(Icons.share_rounded, color: AppColors.gold, size: 20),
              onPressed: () => Share.share(
                'Join MyOnlineJoker! Use my code ${_user?['referral_code']} and get ₹50 bonus. Download: https://game.myonlinejoker.com',
              ),
            ),
          ],
        ),
        const Text(
          'Earn ₹50 for every friend who joins and deposits!',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
        ),
      ],
    ),
  );

  Widget _buildLogoutButton() => SizedBox(
    width: double.infinity,
    child: OutlinedButton.icon(
      onPressed: _logout,
      icon: const Icon(Icons.logout_rounded, color: AppColors.red, size: 18),
      label: const Text('Logout', style: TextStyle(color: AppColors.red, fontWeight: FontWeight.bold)),
      style: OutlinedButton.styleFrom(
        side: const BorderSide(color: AppColors.red),
        padding: const EdgeInsets.symmetric(vertical: 14),
      ),
    ),
  );
}
