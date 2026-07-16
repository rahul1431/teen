import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:go_router/go_router.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/constants/app_config.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../core/services/locale_service.dart';
import '../../../shared/theme/app_theme.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _phoneCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _loading = false;
  bool _obscure = true;
  String? _errorMsg;

  bool _biometricAvailable = false;
  final _localAuth = LocalAuthentication();

  @override
  void initState() {
    super.initState();
    _checkBiometricSupport();
  }

  Future<void> _checkBiometricSupport() async {
    final prefs = await SharedPreferences.getInstance();
    final enabled = prefs.getBool('biometric_enabled') ?? false;
    if (enabled) {
      final canAuth = await _localAuth.canCheckBiometrics;
      if (canAuth) {
        final creds = await SecureStorage.getBiometricCredentials();
        if (creds != null) {
          setState(() => _biometricAvailable = true);
          // Wait a brief moment and auto-trigger
          Future.delayed(
              const Duration(milliseconds: 300), _loginWithBiometric);
        }
      }
    }
  }

  Future<void> _loginWithBiometric() async {
    try {
      final authenticated = await _localAuth.authenticate(
        localizedReason: 'Login to your account',
        options: const AuthenticationOptions(stickyAuth: true),
      );
      if (authenticated) {
        final creds = await SecureStorage.getBiometricCredentials();
        if (creds != null && mounted) {
          _phoneCtrl.text = creds['phone']!;
          _passCtrl.text = creds['password']!;
          _login();
        }
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _errorMsg = null;
    });
    try {
      final res =
          await Dio().post('${AppConfig.apiBaseUrl}/api/auth/login', data: {
        'phone': _phoneCtrl.text.trim(),
        'password': _passCtrl.text,
      });
      await SecureStorage.saveTokens(
        accessToken: res.data['access_token'],
        refreshToken: res.data['refresh_token'],
      );
      await SecureStorage.saveUser(
          userId: res.data['user']['id'],
          username: res.data['user']['username']);

      // Save credentials for biometric login
      await SecureStorage.saveBiometricCredentials(
          _phoneCtrl.text.trim(), _passCtrl.text);

      if (mounted) context.go('/home');
    } on DioException catch (e) {
      setState(() => _errorMsg =
          e.response?.data?['error'] ?? 'Login failed. Please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 32),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 24),
                Center(
                  child: Column(
                    children: [
                      Container(
                        width: 72,
                        height: 72,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                              colors: [AppColors.gold, AppColors.goldLight]),
                          borderRadius: BorderRadius.circular(18),
                          boxShadow: [
                            BoxShadow(
                                color: AppColors.gold.withValues(alpha: 0.4),
                                blurRadius: 20,
                                spreadRadius: 2)
                          ],
                        ),
                        child: const Icon(Icons.style_rounded,
                            size: 40, color: Colors.black),
                      ),
                      const SizedBox(height: 16),
                      Text(locale.t('welcome_back'),
                          style: const TextStyle(
                              fontSize: 26, fontWeight: FontWeight.w900)),
                      const SizedBox(height: 4),
                      Text(locale.t('enter_phone'),
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 14)),
                    ],
                  ),
                ),
                const SizedBox(height: 40),
                TextFormField(
                  controller: _phoneCtrl,
                  keyboardType: TextInputType.phone,
                  maxLength: 10,
                  decoration: InputDecoration(
                    labelText: locale.t('phone_number'),
                    prefixText: '+91  ',
                    prefixIcon: const Icon(Icons.phone_rounded,
                        color: AppColors.textSecondary, size: 20),
                    counterText: '',
                  ),
                  validator: (v) {
                    if ((v?.length ?? 0) != 10)
                      return 'Enter a valid 10-digit mobile number';
                    if (!RegExp(r'^[6-9]\d{9}$').hasMatch(v!))
                      return 'Enter a valid Indian mobile number';
                    return null;
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _passCtrl,
                  obscureText: _obscure,
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
                  validator: (v) =>
                      (v?.length ?? 0) >= 6 ? null : 'Min 6 characters',
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () => context.push('/auth/forgot-password'),
                    child: Text(locale.t('forgot_password'),
                        style: const TextStyle(color: AppColors.gold, fontSize: 13)),
                  ),
                ),
                if (_errorMsg != null) ...[
                  const SizedBox(height: 12),
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
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton(
                        onPressed: _loading ? null : _login,
                        child: _loading
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.black))
                            : Text(locale.t('login')),
                      ),
                    ),
                    if (_biometricAvailable) ...[
                      const SizedBox(width: 12),
                      Container(
                        height: 52,
                        width: 52,
                        decoration: BoxDecoration(
                          color: AppColors.gold.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                              color: AppColors.gold.withValues(alpha: 0.35)),
                        ),
                        child: IconButton(
                          icon: const Icon(Icons.fingerprint_rounded,
                              color: AppColors.gold, size: 28),
                          onPressed: _loading ? null : _loginWithBiometric,
                          tooltip: 'Login with Biometrics',
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(locale.t('dont_have_account') + "  ",
                        style: const TextStyle(color: AppColors.textSecondary)),
                    GestureDetector(
                      onTap: () => context.push('/auth/otp'),
                      child: Text(locale.t('register'),
                          style: const TextStyle(
                              color: AppColors.gold,
                              fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
