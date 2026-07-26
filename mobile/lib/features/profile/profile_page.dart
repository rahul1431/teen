import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:local_auth/local_auth.dart';
import 'package:share_plus/share_plus.dart';
import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/secure_storage.dart';
import '../../core/services/locale_service.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/error_retry.dart';
import '../onboarding/language_selection_page.dart';
import '../support/support_page.dart';
import '../wallet/transaction_history_page.dart';
import 'bank_details_page.dart';
import 'kyc_page.dart';
import 'about_us_page.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});
  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  final _api = ApiClient();
  final _picker = ImagePicker();
  final _localAuth = LocalAuthentication();
  Map<String, dynamic>? _user;
  bool _loading = true;
  bool _hasError = false;
  bool _uploadingPhoto = false;
  bool _biometricEnabled = false;

  @override
  void initState() {
    super.initState();
    _load();
    _loadPreferences();
  }

  Future<void> _loadPreferences() async {
    final prefs = await SharedPreferences.getInstance();
    if (mounted)
      setState(() {
        _biometricEnabled = prefs.getBool('biometric_enabled') ?? false;
      });
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _hasError = false;
    });
    try {
      final res = await _api.dio.get('/api/users/me');
      if (mounted)
        setState(() {
          _user = res.data;
          _loading = false;
        });
    } catch (_) {
      if (mounted)
        setState(() {
          _loading = false;
          _hasError = true;
        });
    }
  }

  Future<void> _logout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardBg,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Logout', style: TextStyle(color: Colors.white)),
        content: const Text('Are you sure you want to logout?',
            style: TextStyle(color: AppColors.textSecondary)),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel',
                  style: TextStyle(color: AppColors.textSecondary))),
          TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child:
                  const Text('Logout', style: TextStyle(color: AppColors.red))),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
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
              Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                      color: AppColors.border,
                      borderRadius: BorderRadius.circular(2))),
              const Text('Change Profile Photo',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 16),
              ListTile(
                leading:
                    const Icon(Icons.camera_alt_rounded, color: AppColors.gold),
                title: const Text('Take a photo'),
                onTap: () => Navigator.pop(ctx, ImageSource.camera),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_rounded,
                    color: AppColors.gold),
                title: const Text('Choose from gallery'),
                onTap: () => Navigator.pop(ctx, ImageSource.gallery),
              ),
            ],
          ),
        ),
      ),
    );
    if (src == null || !mounted) return;
    final picked =
        await _picker.pickImage(source: src, maxWidth: 512, imageQuality: 85);
    if (picked == null || !mounted) return;
    setState(() => _uploadingPhoto = true);
    try {
      final formData = FormData.fromMap({
        'avatar':
            await MultipartFile.fromFile(picked.path, filename: 'avatar.jpg'),
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

  Future<void> _toggleBiometric(bool val) async {
    if (val) {
      final creds = await SecureStorage.getBiometricCredentials();
      if (creds == null) {
        if (mounted)
          AppSnackBar.show(context,
              'Please logout and login again once to register biometrics.',
              error: true);
        return;
      }
      final canAuth = await _localAuth.canCheckBiometrics;
      if (!canAuth) {
        if (mounted)
          AppSnackBar.show(context, 'Biometrics not available on this device');
        return;
      }
      final authenticated = await _localAuth.authenticate(
        localizedReason: 'Verify your identity to enable biometric login',
        options: const AuthenticationOptions(stickyAuth: true),
      );
      if (!authenticated) return;
    } else {
      await SecureStorage.clearBiometricCredentials();
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('biometric_enabled', val);
    if (mounted) setState(() => _biometricEnabled = val);
    HapticFeedback.selectionClick();
  }

  String get _kycStatus => _user?['kyc_status'] ?? 'pending';
  bool get _kycApproved => _kycStatus == 'approved';

  String formatCurrency(dynamic v) {
    final amt = (v is num ? v : double.tryParse(v?.toString() ?? '0') ?? 0);
    return '₹${amt.toStringAsFixed(0)}';
  }

  // ── Build ──────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(locale.t('profile')),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _load,
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.gold))
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
                      const SizedBox(height: 20),
                      _buildStats(),
                      const SizedBox(height: 16),
                      _buildKycBanner(),
                      const SizedBox(height: 20),

                      // ── Menu Sections ──────────────────────────────────────
                      _sectionLabel('Account'),
                      _menuCard([
                        _menuItem(Icons.account_balance_rounded,
                            locale.t('bank_details'),
                            subtitle: 'Add or update bank account',
                            onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                    builder: (_) => const BankDetailsPage()))),
                        _menuItem(Icons.receipt_long_rounded,
                            locale.t('transaction_history'),
                            subtitle: 'Deposits, withdrawals, wins',
                            onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                    builder: (_) =>
                                        const TransactionHistoryPage()))),
                      ]),
                      const SizedBox(height: 12),

                      _sectionLabel('Support'),
                      _menuCard([
                        _menuItem(
                            Icons.support_agent_rounded, locale.t('support'),
                            subtitle: 'Chat with support team',
                            onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                    builder: (_) => const SupportPage()))),
                      ]),
                      const SizedBox(height: 12),

                      _sectionLabel('Preferences'),
                      _menuCard([
                        _menuItem(Icons.language_rounded, locale.t('language'),
                            subtitle: locale.current.nativeName,
                            onTap: () => Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                        builder: (_) =>
                                            const LanguageSelectionPage()))
                                .then((_) => setState(() {}))),
                        _menuToggle(
                          Icons.fingerprint_rounded,
                          locale.t('biometric_login'),
                          subtitle: locale.t('enable_biometric'),
                          value: _biometricEnabled,
                          onChanged: _toggleBiometric,
                        ),
                      ]),
                      const SizedBox(height: 12),

                      _sectionLabel('About'),
                      _menuCard([
                        _menuItem(Icons.info_outline_rounded, 'About Us',
                            subtitle: 'Version, updates & more',
                            onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                    builder: (_) => const AboutUsPage()))),
                      ]),
                      const SizedBox(height: 20),

                      _buildReferralCard(),
                      const SizedBox(height: 20),
                      _buildLogoutButton(),
                      const SizedBox(height: 32),
                    ],
                  ),
                ),
    );
  }

  Widget _sectionLabel(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8, left: 4),
        child: Text(text.toUpperCase(),
            style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 11,
                fontWeight: FontWeight.bold,
                letterSpacing: 1.2)),
      );

  Widget _menuCard(List<Widget> children) => Container(
        decoration: BoxDecoration(
          color: AppColors.cardBg,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(children: children),
      );

  Widget _menuItem(
    IconData icon,
    String title, {
    String? subtitle,
    required VoidCallback onTap,
    Color? iconColor,
  }) =>
      InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: (iconColor ?? AppColors.gold).withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: iconColor ?? AppColors.gold, size: 18),
            ),
            const SizedBox(width: 14),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(title,
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 14)),
                  if (subtitle != null)
                    Text(subtitle,
                        style: const TextStyle(
                            color: AppColors.textSecondary, fontSize: 12)),
                ])),
            const Icon(Icons.chevron_right_rounded,
                color: AppColors.textSecondary, size: 20),
          ]),
        ),
      );

  Widget _menuToggle(
    IconData icon,
    String title, {
    String? subtitle,
    required bool value,
    required void Function(bool) onChanged,
  }) =>
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppColors.gold.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: AppColors.gold, size: 18),
          ),
          const SizedBox(width: 14),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(title,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 14)),
                if (subtitle != null)
                  Text(subtitle,
                      style: const TextStyle(
                          color: AppColors.textSecondary, fontSize: 12)),
              ])),
          Switch(
            value: value,
            onChanged: onChanged,
            activeThumbColor: AppColors.gold,
            activeTrackColor: AppColors.gold.withValues(alpha: 0.3),
          ),
        ]),
      );

  Widget _buildAvatar() {
    final avatarUrl = _user?['avatar_url'] as String?;
    final initial = ((_user?['username'] as String?)?.isNotEmpty == true
            ? _user!['username'][0]
            : 'P')
        .toUpperCase();

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
                          color: AppColors.gold.withValues(alpha: 0.35),
                          blurRadius: 18,
                          spreadRadius: 2)
                    ],
                    border: Border.all(
                        color: AppColors.gold.withValues(alpha: 0.4), width: 2),
                  ),
                  child: ClipOval(
                    child: avatarUrl != null
                        ? Image.network(avatarUrl,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => Center(
                                child: Text(initial,
                                    style: const TextStyle(
                                        fontSize: 34,
                                        color: Colors.black,
                                        fontWeight: FontWeight.bold))))
                        : Center(
                            child: Text(initial,
                                style: const TextStyle(
                                    fontSize: 34,
                                    color: Colors.black,
                                    fontWeight: FontWeight.bold))),
                  ),
                ),
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
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.black))
                        : const Icon(Icons.camera_alt_rounded,
                            size: 14, color: Colors.black),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Text(_user?['username'] ?? '',
              style:
                  const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          Text('+91 ${_user?['phone'] ?? ''}',
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 14)),
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
      onTap: () => Navigator.push(
              context, MaterialPageRoute(builder: (_) => const KycPage()))
          .then((_) => _load()),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: kycColor.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: kycColor.withValues(alpha: 0.35)),
        ),
        child: Row(children: [
          Icon(kycIcon, color: kycColor, size: 22),
          const SizedBox(width: 12),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(kycTitle,
                    style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: kycColor,
                        fontSize: 13)),
                const SizedBox(height: 2),
                Text(kycSub,
                    style: const TextStyle(
                        color: AppColors.textSecondary, fontSize: 12)),
              ])),
          if (!_kycApproved)
            Icon(Icons.chevron_right_rounded, color: kycColor, size: 20),
        ]),
      ),
    );
  }

  Widget _buildStats() => Row(children: [
        _statCard(Icons.sports_esports_rounded, 'Games Played',
            _user?['total_games']?.toString() ?? '0'),
        const SizedBox(width: 12),
        _statCard(Icons.emoji_events_rounded, 'Total Winnings',
            formatCurrency(_user?['total_winnings'] ?? 0)),
      ]);

  Widget _statCard(IconData icon, String label, String value) => Expanded(
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.cardBg,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(icon, color: AppColors.gold, size: 20),
            const SizedBox(height: 8),
            Text(label,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 11)),
            const SizedBox(height: 4),
            Text(value,
                style:
                    const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
          ]),
        ),
      );

  Widget _buildReferralCard() => Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: AppColors.cardBg,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.gold.withValues(alpha: 0.3)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Row(children: [
            Icon(Icons.card_giftcard_rounded, color: AppColors.gold, size: 18),
            SizedBox(width: 8),
            Text('Referral Code',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          ]),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
                child: Text(
              _user?['referral_code'] ?? '—',
              style: const TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w900,
                  color: AppColors.gold,
                  letterSpacing: 5),
            )),
            IconButton(
              icon: const Icon(Icons.copy_rounded,
                  color: AppColors.gold, size: 20),
              onPressed: () {
                Clipboard.setData(
                    ClipboardData(text: _user?['referral_code'] ?? ''));
                AppSnackBar.show(context, 'Referral code copied!',
                    success: true);
              },
            ),
            IconButton(
              icon: const Icon(Icons.share_rounded,
                  color: AppColors.gold, size: 20),
              onPressed: () => Share.share(
                'Join MyOnlineJoker! Use my code ${_user?['referral_code']} and get ₹50 bonus. Download: https://game.myonlinejoker.com/join?ref=${_user?['referral_code']}',
              ),
            ),
          ]),
          const Text(
            'Earn ₹50 for every friend who joins and deposits!',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
          ),
        ]),
      );

  Widget _buildLogoutButton() => SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          onPressed: _logout,
          icon:
              const Icon(Icons.logout_rounded, color: AppColors.red, size: 18),
          label: Text(locale.t('logout'),
              style: const TextStyle(
                  color: AppColors.red, fontWeight: FontWeight.bold)),
          style: OutlinedButton.styleFrom(
            side: const BorderSide(color: AppColors.red),
            padding: const EdgeInsets.symmetric(vertical: 14),
          ),
        ),
      );
}
