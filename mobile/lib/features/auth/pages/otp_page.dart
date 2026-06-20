import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_config.dart';
import '../../../shared/theme/app_theme.dart';

class OtpPage extends StatefulWidget {
  final String phone;
  const OtpPage({super.key, required this.phone});
  @override
  State<OtpPage> createState() => _OtpPageState();
}

class _OtpPageState extends State<OtpPage> {
  final _phoneCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();
  bool _otpSent = false;
  bool _loading = false;

  Future<void> _sendOtp() async {
    final phone = _phoneCtrl.text.trim();
    if (phone.length != 10) return _showError('Enter valid 10-digit number');
    setState(() => _loading = true);
    try {
      await Dio().post('${AppConfig.apiBaseUrl}/api/auth/send-otp', data: {'phone': phone});
      setState(() { _otpSent = true; _loading = false; });
      _showSuccess('OTP sent to +91$phone');
    } on DioException catch (e) {
      _showError(e.response?.data?['error'] ?? 'Failed to send OTP');
      setState(() => _loading = false);
    }
  }

  Future<void> _verifyAndContinue() async {
    setState(() => _loading = true);
    try {
      context.push('/auth/register?phone=${_phoneCtrl.text.trim()}&otp=${_otpCtrl.text.trim()}');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showError(String msg) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: AppColors.red));
  void _showSuccess(String msg) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: AppColors.green));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create Account')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Enter Your Mobile Number', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('We\'ll send you an OTP to verify', style: TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 32),
            TextFormField(
              controller: _phoneCtrl,
              keyboardType: TextInputType.phone,
              maxLength: 10,
              enabled: !_otpSent,
              decoration: const InputDecoration(labelText: 'Mobile Number', prefixText: '+91 '),
            ),
            if (_otpSent) ...[
              const SizedBox(height: 16),
              TextFormField(
                controller: _otpCtrl,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(labelText: 'Enter OTP'),
              ),
            ],
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _loading ? null : (_otpSent ? _verifyAndContinue : _sendOtp),
                child: _loading
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                    : Text(_otpSent ? 'Continue' : 'Send OTP'),
              ),
            ),
            if (_otpSent)
              TextButton(
                onPressed: () => setState(() => _otpSent = false),
                child: const Text('Change number', style: TextStyle(color: AppColors.textSecondary)),
              ),
          ],
        ),
      ),
    );
  }
}
