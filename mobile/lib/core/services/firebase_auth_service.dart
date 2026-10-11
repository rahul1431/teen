import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';

class FirebaseAuthService {
  static final FirebaseAuth _auth = FirebaseAuth.instance;

  /// Sends Firebase Phone OTP and registers callbacks for Android auto-retrieval.
  static Future<void> sendPhoneOtp({
    required String phone10Digit,
    required Function(String verificationId) onCodeSent,
    required Function(String idToken, String? smsCode) onAutoVerified,
    required Function(String error) onError,
    int? resendToken,
  }) async {
    final cleanPhone = phone10Digit.replaceAll(RegExp(r'\D'), '');
    final formattedPhone = '+91$cleanPhone';

    try {
      await _auth.verifyPhoneNumber(
        phoneNumber: formattedPhone,
        timeout: const Duration(seconds: 60),
        forceResendingToken: resendToken,
        // ⭐️ ANDROID AUTO-DETECTION:
        // Triggered automatically on Android when SMS is received via Google Play Services SMS Retriever.
        verificationCompleted: (PhoneAuthCredential credential) async {
          try {
            final userCredential = await _auth.signInWithCredential(credential);
            final idToken = await userCredential.user?.getIdToken();
            if (idToken != null) {
              onAutoVerified(idToken, credential.smsCode);
            }
          } catch (e) {
            onError('Auto-detection sign-in failed: $e');
          }
        },
        verificationFailed: (FirebaseAuthException e) {
          onError(e.message ?? 'Firebase SMS Verification failed');
        },
        codeSent: (String verificationId, int? resendToken) {
          onCodeSent(verificationId);
        },
        codeAutoRetrievalTimeout: (String verificationId) {
          // Auto retrieval timed out, manual OTP submission still works
        },
      );
    } catch (e) {
      onError('Failed to initiate phone verification: $e');
    }
  }

  /// Manually verify 6-digit OTP entered by user
  static Future<String?> verifyManualOtp({
    required String verificationId,
    required String smsCode,
  }) async {
    final credential = PhoneAuthProvider.credential(
      verificationId: verificationId,
      smsCode: smsCode.trim(),
    );
    final userCredential = await _auth.signInWithCredential(credential);
    return await userCredential.user?.getIdToken();
  }
}
