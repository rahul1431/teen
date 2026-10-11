import 'dart:async';
import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_config.dart';
import '../../../core/services/sync_service.dart';
import '../../../core/services/firebase_auth_service.dart';
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
  String? _verificationId;
  String? _firebaseToken;

  @override
  void initState() {
    super.initState();
    SyncService.onOtpReceived = (otp) {
      if (mounted) {
        setState(() {
          _otpCtrl.text = otp;
        });
        _continueToReset();
      }
    };
  }

  @override
  void dispose() {
    SyncService.onOtpReceived = null;
    _phoneCtrl.dispose();
    _otpCtrl.dispose();
    _resendTimer?.cancel();
    super.dispose();
  }

  Future<void> _sendOtp() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _loading = true; _errorMsg = null; });
    final phone = _phoneCtrl.text.trim();

    await FirebaseAuthService.sendPhoneOtp(
      phone10Digit: phone,
      onCodeSent: (verificationId) {
        if (!mounted) return;
        setState(() {
          _verificationId = verificationId;
          _otpSent = true;
          _resendIn = 60;
          _loading = false;
        });
        _startTimer();
        AppSnackBar.show(context, 'Reset SMS OTP sent to +91$phone', success: true);
      },
      onAutoVerified: (idToken, smsCode) {
        // ⭐️ ANDROID AUTO-DETECTION: Auto verified via Google Play Services!
        if (!mounted) return;
        setState(() {
          _firebaseToken = idToken;
          if (smsCode != null && smsCode.isNotEmpty) {
            _otpCtrl.text = smsCode;
          }
          _otpSent = true;
          _loading = false;
        });
        AppSnackBar.show(context, '✅ SMS auto-detected & verified!', success: true);
        _submitResetVerification(phone, smsCode ?? '123456', idToken);
      },
      onError: (err) async {
        // Fallback to server-side send-otp
        try {
          final res = await Dio().post('${AppConfig.apiBaseUrl}/api/auth/send-otp',
              data: {'phone': phone, 'reason': 'reset'});
          final devOtp = res.data?['otp'] as String?;
          if (!mounted) return;
          if (devOtp != null) {
            _otpCtrl.text = devOtp;
          }
          setState(() { _otpSent = true; _resendIn = 60; _loading = false; });
          _startTimer();
          AppSnackBar.show(
              context,
              devOtp != null
                  ? 'OTP: $devOtp (auto-filled for testing)'
                  : 'OTP sent to +91$phone',
              success: true);
        } catch (_) {
          if (!mounted) return;
          setState(() {
            _errorMsg = err;
            _loading = false;
          });
        }
      },
    );
  }

  void _startTimer() {
    _resendTimer?.cancel();
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) { t.cancel(); return; }
      setState(() { _resendIn--; if (_resendIn <= 0) t.cancel(); });
    });
  }

  Future<void> _continueToReset() async {
    final phone = _phoneCtrl.text.trim();
    final otp = _otpCtrl.text.trim();
    if (otp.length != 6) {
      setState(() => _errorMsg = 'Enter the 6-digit OTP');
      return;
    }
    setState(() {
      _loading = true;
      _errorMsg = null;
    });

    String? fbToken = _firebaseToken;
    if (fbToken == null && _verificationId != null) {
      try {
        fbToken = await FirebaseAuthService.verifyManualOtp(
          verificationId: _verificationId!,
          smsCode: otp,
        );
      } catch (_) {}
    }

    await _submitResetVerification(phone, otp, fbToken);
  }

  Future<void> _submitResetVerification(String phone, String otp, String? fbToken) async {
    try {
      await Dio().post('${AppConfig.apiBaseUrl}/api/auth/verify-otp',
          data: {
            'phone': phone,
            if (otp.isNotEmpty) 'otp': otp,
            if (fbToken != null) 'firebase_token': fbToken,
          });
      if (!mounted) return;
      setState(() {
        _loading = false;
      });
      final tokenParam = fbToken != null ? '&firebase_token=${Uri.encodeComponent(fbToken)}' : '';
      context.push('/auth/reset-password?phone=$phone&otp=$otp$tokenParam');
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMsg = e.response?.data?['error'] ?? 'Invalid or expired OTP';
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMsg = 'Verification error: $e';
        _loading = false;
      });
    }
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
