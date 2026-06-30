import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:share_plus/share_plus.dart';
import 'package:dio/dio.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/secure_storage.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/error_retry.dart';
import 'kyc_page.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});
  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  final _api = ApiClient();
  final _picker = ImagePicker();
  Map<String, dynamic>? _user;
  bool _loading = true;
  bool _hasError = false;
  bool _uploadingPhoto = false;

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

  Future<void> _changePhoto() async {
    final src = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Change Profile Photo',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 16),
              ListTile(
                leading: const Icon(Icons.camera_alt_rounded, color: AppColors.gold),
                title: const Text('Take a photo'),
                onTap: () => Navigator.pop(ctx, ImageSource.camera),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_rounded, color: AppColors.gold),
                title: const Text('Choose from gallery'),
                onTap: () => Navigator.pop(ctx, ImageSource.gallery),
              ),
            ],
          ),
        ),
      ),
    );
    if (src == null || !mounted) return;

    final picked = await _picker.pickImage(source: src, maxWidth: 512, imageQuality: 85);
    if (picked == null || !mounted) return;

    setState(() => _uploadingPhoto = true);
    try {
      final formData = FormData.fromMap({
        'avatar': await MultipartFile.fromFile(picked.path, filename: 'avatar.jpg'),
      });
      final res = await _api.dio.post('/api/users/me/avatar', data: formData);
      if (!mounted) return;
      setState(() {
        _user = {...?_user, 'avatar_url': res.data['avatar_url']};
      });
      AppSnackBar.show(context, 'Photo updated!', success: true);
    } catch (_) {
      if (mounted) AppSnackBar.show(context, 'Failed to upload photo');
    } finally {
      if (mounted) setState(() => _uploadingPhoto = false);
    }
  }

  String get _kycStatus => _user?['kyc_status'] ?? 'pending';
  bool get _kycApproved => _kycStatus == 'approved';

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

  Widget _buildAvatar() {
    final avatarUrl = _user?['avatar_url'] as String?;
    final initial = ((_user?['username'] as String?)?.isNotEmpty == true
        ? _user!['username'][0]
        : 'P').toUpperCase();

    return Center(
      child: Column(
        children: [
          GestureDetector(
            onTap: _changePhoto,
            child: Stack(
              children: [
                Container(
                  width: 90,
                  height: 90,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: avatarUrl == null
                        ? const LinearGradient(
                            colors: [AppColors.gold, AppColors.goldLight])
                        : null,
                    color: avatarUrl != null ? Colors.transparent : null,
                    boxShadow: [
                      BoxShadow(
                          color: AppColors.gold.withOpacity(0.35),
                          blurRadius: 18,
                          spreadRadius: 2)
                    ],
                    border: Border.all(color: AppColors.gold.withOpacity(0.4), width: 2),
                  ),
                  child: ClipOval(
                    child: avatarUrl != null
                        ? Image.network(
                            avatarUrl,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => Center(
                              child: Text(initial,
                                  style: const TextStyle(
                                      fontSize: 34, color: Colors.black, fontWeight: FontWeight.bold)),
                            ),
                          )
                        : Center(
                            child: Text(initial,
                                style: const TextStyle(
                                    fontSize: 34, color: Colors.black, fontWeight: FontWeight.bold)),
                          ),
                  ),
                ),
                // Camera overlay button
                Positioned(
                  bottom: 0,
                  right: 0,
                  child: Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: AppColors.gold,
                      shape: BoxShape.circle,
                      border: Border.all(color: AppColors.surface, width: 2),
                    ),
                    child: _uploadingPhoto
                        ? const Padding(
                            padding: EdgeInsets.all(4),
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black),
                          )
                        : const Icon(Icons.camera_alt_rounded, size: 14, color: Colors.black),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Text(_user?['username'] ?? '',
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          Text('+91 ${_user?['phone'] ?? ''}',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 14)),
        ],
      ),
    );
  }

  Widget _buildKycBanner() {
    final kycColor = _kycApproved
        ? AppColors.green
        : _kycStatus == 'under_review'
            ? AppColors.orange
            : _kycStatus == 'rejected'
                ? AppColors.red
                : AppColors.orange;

    final kycIcon = _kycApproved
        ? Icons.verified_rounded
        : _kycStatus == 'under_review'
            ? Icons.access_time_rounded
            : _kycStatus == 'rejected'
                ? Icons.cancel_rounded
                : Icons.warning_amber_rounded;

    final kycTitle = _kycApproved
        ? 'KYC Verified'
        : _kycStatus == 'under_review'
            ? 'KYC Under Review'
            : _kycStatus == 'rejected'
                ? 'KYC Rejected — Resubmit'
                : 'Complete KYC Verification';

    final kycSub = _kycApproved
        ? 'Your identity is verified. No withdrawal limits.'
        : _kycStatus == 'under_review'
            ? 'Documents submitted — review within 24-48 hours'
            : 'Required for withdrawals above ₹10,000';

    return GestureDetector(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const KycPage())).then((_) => _load()),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: kycColor.withOpacity(0.08),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: kycColor.withOpacity(0.35)),
        ),
        child: Row(
          children: [
            Icon(kycIcon, color: kycColor, size: 22),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(kycTitle,
                      style: TextStyle(fontWeight: FontWeight.bold, color: kycColor, fontSize: 13)),
                  const SizedBox(height: 2),
                  Text(kycSub,
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                ],
              ),
            ),
            if (!_kycApproved) Icon(Icons.chevron_right_rounded, color: kycColor, size: 20),
          ],
        ),
      ),
    );
  }

  Widget _buildStats() => Row(
    children: [
      _statCard(Icons.sports_esports_rounded, 'Games Played',
          _user?['total_games']?.toString() ?? '0'),
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
                style: const TextStyle(
                    fontSize: 26, fontWeight: FontWeight.w900,
                    color: AppColors.gold, letterSpacing: 5),
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
                'Join MyOnlineJoker! Use my code ${_user?['referral_code']} and get ₹50 bonus. Download: https://game.myonlinejoker.com/join?ref=${_user?['referral_code']}',
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
