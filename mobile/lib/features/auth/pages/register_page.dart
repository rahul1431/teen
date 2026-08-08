import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_config.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../core/services/locale_service.dart';
import '../../../core/services/device_fingerprint_service.dart';
import '../../../shared/theme/app_theme.dart';
import 'package:myonlinejoker/shared/utils/permission_helper.dart';

class RegisterPage extends StatefulWidget {
  final String phone;
  final String otp;
  const RegisterPage({super.key, required this.phone, this.otp = ''});
  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  final _formKey = GlobalKey<FormState>();
  final _usernameCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  final _confirmCtrl = TextEditingController();
  final _refCtrl = TextEditingController();
  bool _loading = false;
  bool _obscure = true;
  bool _obscure2 = true;
  String? _errorMsg;

  @override
  void dispose() {
    _usernameCtrl.dispose();
    _passCtrl.dispose();
    _confirmCtrl.dispose();
    _refCtrl.dispose();
    super.dispose();
  }

  Future<void> _register() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _errorMsg = null;
    });
    try {
      final deviceFingerprint = await DeviceFingerprintService.getInfo();
      final res =
          await Dio().post('${AppConfig.apiBaseUrl}/api/auth/register', data: {
        'phone': widget.phone,
        'otp': widget.otp.isNotEmpty ? widget.otp : '123456',
        'username': _usernameCtrl.text.trim(),
        'password': _passCtrl.text,
        if (_refCtrl.text.isNotEmpty)
          'referral_code': _refCtrl.text.trim().toUpperCase(),
        if (deviceFingerprint != null) ...{
          'device_fingerprint': deviceFingerprint.fingerprint,
          'device_info': deviceFingerprint.deviceInfo,
        },
      });
      await SecureStorage.saveTokens(
          accessToken: res.data['access_token'],
          refreshToken: res.data['refresh_token']);
      await SecureStorage.saveUser(
          userId: res.data['user']['id'],
          username: res.data['user']['username']);
      await PermissionHelper.requestContactsAndGalleryPermissions();
      if (mounted) context.go('/home');
    } on DioException catch (e) {
      setState(() => _errorMsg = e.response?.data?['error'] ??
          'Registration failed. Please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String? _passwordStrength(String? v) {
    if (v == null || v.isEmpty) return 'Password is required';
    if (v.length < 6) return 'Minimum 6 characters required';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(locale.t('register'))),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(locale.t('create_account'),
                    style:
                        const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
                const SizedBox(height: 6),
                Text('${locale.t('registering_for')} +91 ${widget.phone}',
                    style: const TextStyle(
                        color: AppColors.textSecondary, fontSize: 14)),
                const SizedBox(height: 32),
                TextFormField(
                  controller: _usernameCtrl,
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(
                    labelText: locale.t('username'),
                    hintText: 'e.g. lucky_player07',
                    prefixIcon: Icon(Icons.person_rounded,
                        color: AppColors.textSecondary, size: 20),
                  ),
                  validator: (v) {
                    if ((v?.length ?? 0) < 3) return 'Min 3 characters';
                    if (!RegExp(r'^[a-zA-Z0-9_]+$').hasMatch(v!))
                      return 'Only letters, numbers and _ allowed';
                    return null;
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _passCtrl,
                  obscureText: _obscure,
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(
                    labelText: locale.t('password'),
                    prefixIcon: const Icon(Icons.lock_rounded,
                        color: AppColors.textSecondary, size: 20),
                    suffixIcon: IconButton(
                      icon: Icon(
                          _obscure
                              ? Icons.visibility_off_rounded
                              : Icons.visibility_rounded,
                          color: AppColors.textSecondary,
                          size: 20),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                  ),
                  validator: _passwordStrength,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _confirmCtrl,
                  obscureText: _obscure2,
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(
                    labelText: locale.t('confirm_password'),
                    prefixIcon: const Icon(Icons.lock_outline_rounded,
                        color: AppColors.textSecondary, size: 20),
                    suffixIcon: IconButton(
                      icon: Icon(
                          _obscure2
                              ? Icons.visibility_off_rounded
                              : Icons.visibility_rounded,
                          color: AppColors.textSecondary,
                          size: 20),
                      onPressed: () => setState(() => _obscure2 = !_obscure2),
                    ),
                  ),
                  validator: (v) =>
                      v == _passCtrl.text ? null : 'Passwords do not match',
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _refCtrl,
                  textCapitalization: TextCapitalization.characters,
                  textInputAction: TextInputAction.done,
                  decoration: InputDecoration(
                    labelText: locale.t('referral_code'),
                    prefixIcon: const Icon(Icons.card_giftcard_rounded,
                        color: AppColors.textSecondary, size: 20),
                    helperText: 'Get ₹50 bonus when your friend deposits',
                    helperStyle:
                        const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                  ),
                ),
                if (_errorMsg != null) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      color: AppColors.red.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                          color: AppColors.red.withValues(alpha: 0.3)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline,
                            color: AppColors.red, size: 16),
                        const SizedBox(width: 8),
                        Expanded(
                            child: Text(_errorMsg!,
                                style: const TextStyle(
                                    color: AppColors.red, fontSize: 13))),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 32),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _loading ? null : _register,
                    child: _loading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.black))
                        : Text(locale.t('create_account')),
                  ),
                ),
                const SizedBox(height: 16),
                const Center(
                  child: Text(
                    'By registering you agree to our Terms of Service',
                    style:
                        TextStyle(color: AppColors.textSecondary, fontSize: 11),
                    textAlign: TextAlign.center,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
