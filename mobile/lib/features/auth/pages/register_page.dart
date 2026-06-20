import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_config.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../shared/theme/app_theme.dart';

class RegisterPage extends StatefulWidget {
  final String phone;
  const RegisterPage({super.key, required this.phone});
  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  final _formKey = GlobalKey<FormState>();
  final _usernameCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  final _refCtrl = TextEditingController();
  bool _loading = false;
  String? _otp;

  @override
  void initState() {
    super.initState();
    // OTP passed via route query param
    final uri = Uri.base;
    _otp = uri.queryParameters['otp'];
  }

  Future<void> _register() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      final res = await Dio().post('${AppConfig.apiBaseUrl}/api/auth/register', data: {
        'phone': widget.phone,
        'otp': _otp ?? '000000',
        'username': _usernameCtrl.text.trim(),
        'password': _passCtrl.text,
        if (_refCtrl.text.isNotEmpty) 'referral_code': _refCtrl.text.trim().toUpperCase(),
      });
      await SecureStorage.saveTokens(accessToken: res.data['access_token'], refreshToken: res.data['refresh_token']);
      await SecureStorage.saveUser(userId: res.data['user']['id'], username: res.data['user']['username']);
      if (mounted) context.go('/home');
    } on DioException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.response?.data?['error'] ?? 'Registration failed'), backgroundColor: AppColors.red));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Complete Registration')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: _usernameCtrl,
                decoration: const InputDecoration(labelText: 'Choose Username'),
                validator: (v) => (v?.length ?? 0) >= 3 ? null : 'Min 3 characters',
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _passCtrl,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Set Password'),
                validator: (v) => (v?.length ?? 0) >= 6 ? null : 'Min 6 characters',
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _refCtrl,
                decoration: const InputDecoration(labelText: 'Referral Code (optional)'),
              ),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _loading ? null : _register,
                  child: _loading ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black)) : const Text('Create Account'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
