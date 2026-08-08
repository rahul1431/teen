import 'dart:async';
import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_config.dart';
import '../../../core/services/locale_service.dart';
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
  int _resendIn = 0;
  Timer? _timer;
  String? _errorMsg;

  @override
  void initState() {
    super.initState();
    _phoneCtrl.text = widget.phone;
  }

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _otpCtrl.dispose();
    _timer?.cancel();
    super.dispose();
  }

  void _startResendTimer() {
    _resendIn = 60;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      setState(() {
        _resendIn--;
        if (_resendIn <= 0) t.cancel();
      });
    });
  }

  Future<void> _sendOtp() async {
    final phone = _phoneCtrl.text.trim();
    if (phone.length != 10 || !RegExp(r'^[6-9]\d{9}$').hasMatch(phone)) {
      setState(() => _errorMsg = 'Enter a valid 10-digit Indian mobile number');
      return;
    }
    setState(() {
      _loading = true;
      _errorMsg = null;
    });
    try {
      final res = await Dio().post('${AppConfig.apiBaseUrl}/api/auth/send-otp',
          data: {'phone': phone});
      final devOtp = res.data?['otp'] as String?;
      setState(() {
        _otpSent = true;
        _loading = false;
        _otpCtrl.text = devOtp ?? '123456';
      });
      _startResendTimer();
      AppSnackBar.show(
          context,
          devOtp != null
              ? 'OTP: $devOtp (auto-filled for testing)'
              : 'OTP sent to +91$phone',
          success: true);
    } on DioException catch (e) {
      setState(() {
        _errorMsg = e.response?.data?['error'] ?? 'Failed to send OTP';
        _loading = false;
      });
    }
  }

  void _verifyAndContinue() {
    final phone = _phoneCtrl.text.trim();
    final otp = _otpCtrl.text.trim();
    if (otp.length != 6) {
      setState(() => _errorMsg = 'Enter the 6-digit OTP');
      return;
    }
    context.push('/auth/register?phone=$phone&otp=$otp');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(locale.t('create_account'))),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(locale.t('verify_mobile'),
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
              const SizedBox(height: 6),
              Text(
                _otpSent
                    ? 'OTP sent to +91 ${_phoneCtrl.text.trim()}'
                    : 'Enter your mobile number to get started',
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 14),
              ),
              const SizedBox(height: 32),
              TextFormField(
                controller: _phoneCtrl,
                keyboardType: TextInputType.phone,
                maxLength: 10,
                enabled: !_otpSent,
                decoration: InputDecoration(
                  labelText: locale.t('phone_number'),
                  prefixText: '+91  ',
                  prefixIcon: const Icon(Icons.phone_rounded,
                      color: AppColors.textSecondary, size: 20),
                  counterText: '',
                ),
              ),
              if (_otpSent) ...[
                const SizedBox(height: 16),
                TextFormField(
                  controller: _otpCtrl,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  autofocus: true,
                  decoration: InputDecoration(
                    labelText: locale.t('enter_otp'),
                    prefixIcon: const Icon(Icons.lock_open_rounded,
                        color: AppColors.textSecondary, size: 20),
                    counterText: '',
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    if (_resendIn > 0)
                      Text('Resend in ${_resendIn}s',
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 13))
                    else
                      GestureDetector(
                        onTap: _loading ? null : _sendOtp,
                        child: Text(locale.t('resend_otp'),
                            style: const TextStyle(
                                color: AppColors.gold,
                                fontWeight: FontWeight.bold,
                                fontSize: 13)),
                      ),
                  ],
                ),
              ],
              if (_errorMsg != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.red.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                    border:
                        Border.all(color: AppColors.red.withValues(alpha: 0.3)),
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
                  onPressed: _loading
                      ? null
                      : (_otpSent ? _verifyAndContinue : _sendOtp),
                  child: _loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.black))
                      : Text(_otpSent ? locale.t('continue') : locale.t('send_otp')),
                ),
              ),
              if (_otpSent) ...[
                const SizedBox(height: 12),
                Center(
                  child: TextButton(
                    onPressed: () => setState(() {
                      _otpSent = false;
                      _errorMsg = null;
                      _timer?.cancel();
                    }),
                    child: const Text('Change number',
                        style: TextStyle(color: AppColors.textSecondary)),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
