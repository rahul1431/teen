import 'dart:async';
import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_config.dart';
import '../../../shared/theme/app_theme.dart';

/// Step 1 of password recovery: enter phone, receive OTP, enter OTP.
/// Hands off to ResetPasswordPage which verifies the OTP server-side
/// together with the new password (POST /auth/reset-password).
class ForgotPasswordPage extends StatefulWidget {
  const ForgotPasswordPage({super.key});
  @override
  State<ForgotPasswordPage> createState() => _ForgotPasswordPageState();
}

class _ForgotPasswordPageState extends State<ForgotPasswordPage> {
  final _formKey = GlobalKey<FormState>();
  final _phoneCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();
  bool _loading = false;
  bool _otpSent = false;
  int _resendIn = 0;
  Timer? _resendTimer;
  String? _errorMsg;

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _otpCtrl.dispose();
    _resendTimer?.cancel();
    super.dispose();
  }

  Future<void> _sendOtp() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _loading = true; _errorMsg = null; });
    try {
      await Dio().post('${AppConfig.apiBaseUrl}/api/auth/send-otp',
          data: {'phone': _phoneCtrl.text.trim()});
      setState(() { _otpSent = true; _resendIn = 60; });
      _resendTimer?.cancel();
      _resendTimer = Timer.periodic(const Duration(seconds: 1), (t) {
        if (!mounted) { t.cancel(); return; }
        setState(() { _resendIn--; if (_resendIn <= 0) t.cancel(); });
      });
    } on DioException catch (e) {
      setState(() => _errorMsg = e.response?.data?['error'] ?? 'Could not send OTP. Please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _continueToReset() {
    final otp = _otpCtrl.text.trim();
    if (otp.length != 6) {
      setState(() => _errorMsg = 'Enter the 6-digit OTP');
      return;
    }
    context.push('/auth/reset-password?phone=${_phoneCtrl.text.trim()}&otp=$otp');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Forgot Password')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 32),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Reset your password',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
                const SizedBox(height: 6),
                const Text('We\'ll send a 6-digit OTP to your registered mobile number.',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                const SizedBox(height: 28),
                TextFormField(
                  controller: _phoneCtrl,
                  enabled: !_otpSent,
                  keyboardType: TextInputType.phone,
                  maxLength: 10,
                  decoration: const InputDecoration(
                    labelText: 'Mobile Number',
                    counterText: '',
                    prefixText: '+91  ',
                    prefixIcon: Icon(Icons.phone_android_rounded),
                  ),
                  validator: (v) => (v == null || !RegExp(r'^\d{10}$').hasMatch(v.trim()))
                      ? 'Enter a valid 10-digit mobile number'
                      : null,
                ),
                if (_otpSent) ...[
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _otpCtrl,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    decoration: const InputDecoration(
                      labelText: 'OTP',
                      counterText: '',
                      prefixIcon: Icon(Icons.lock_clock_rounded),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const Text('Didn\'t receive it?',
                          style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                      const SizedBox(width: 8),
                      if (_resendIn > 0)
                        Text('Resend in ${_resendIn}s',
                            style: const TextStyle(color: AppColors.textSecondary, fontSize: 13))
                      else
                        GestureDetector(
                          onTap: _loading ? null : _sendOtp,
                          child: const Text('Resend OTP',
                              style: TextStyle(color: AppColors.gold, fontSize: 13, fontWeight: FontWeight.bold)),
                        ),
                    ],
                  ),
                ],
                if (_errorMsg != null) ...[
                  const SizedBox(height: 14),
                  Text(_errorMsg!, style: const TextStyle(color: AppColors.red, fontSize: 13)),
                ],
                const SizedBox(height: 28),
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    onPressed: _loading ? null : (_otpSent ? _continueToReset : _sendOtp),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.gold,
                      foregroundColor: Colors.black,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    ),
                    child: _loading
                        ? const SizedBox(width: 22, height: 22,
                            child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.black))
                        : Text(_otpSent ? 'Continue' : 'Send OTP',
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
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
