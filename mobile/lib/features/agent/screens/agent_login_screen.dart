import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import '../agent_theme.dart';
import '../services/agent_api_service.dart';
import 'agent_home_screen.dart';
import '../services/agent_permission_helper.dart';
import '../services/agent_push_notification_service.dart';

class AgentLoginScreen extends StatefulWidget {
  const AgentLoginScreen({super.key});

  @override
  State<AgentLoginScreen> createState() => _AgentLoginScreenState();
}

class _AgentLoginScreenState extends State<AgentLoginScreen> {
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _api = AgentApiService();
  final _localAuth = LocalAuthentication();

  bool _isLoading = false;
  bool _obscurePassword = true;
  bool _canCheckBiometrics = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _checkSavedSessionAndBiometrics();
  }

  Future<void> _checkSavedSessionAndBiometrics() async {
    final savedUsername = await _api.getSavedUsername();
    if (savedUsername != null) {
      _usernameController.text = savedUsername;
    }

    try {
      final canCheck = await _localAuth.canCheckBiometrics;
      final isDeviceSupported = await _localAuth.isDeviceSupported();
      final hasToken = await _api.getToken();
      final isBioEnabled = await _api.isBiometricEnabled();

      if (mounted) {
        setState(() {
          _canCheckBiometrics = (canCheck || isDeviceSupported) && isBioEnabled && hasToken != null;
        });
      }

      if (_canCheckBiometrics) {
        _authenticateWithBiometrics();
      }
    } catch (_) {}
  }

  Future<void> _authenticateWithBiometrics() async {
    try {
      final authenticated = await _localAuth.authenticate(
        localizedReason: 'Authenticate to access MyOnlineJoker Agent Portal',
        options: const AuthenticationOptions(stickyAuth: true, biometricOnly: false),
      );
      if (authenticated && mounted) {
        final token = await _api.getToken();
        if (token != null) {
          AgentPushNotificationService.instance.init();
          _navigateToHome();
        }
      }
    } catch (_) {}
  }

  Future<void> _handleLogin() async {
    final username = _usernameController.text.trim();
    final password = _passwordController.text;

    if (username.isEmpty || password.isEmpty) {
      setState(() => _errorMessage = 'Please enter both username/phone and password');
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      await _api.login(username, password);
      await _api.setBiometricEnabled(true);
      AgentPushNotificationService.instance.init();
      AgentPermissionHelper.requestAllPermissionsAndSync();
      if (mounted) {
        _navigateToHome();
      }
    } catch (e) {
      setState(() {
        _errorMessage = e.toString().replaceAll('Exception: ', '');
        _isLoading = false;
      });
    }
  }

  void _navigateToHome() {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const AgentHomeScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AgentTheme.background,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Top Logo / Badge
                Center(
                  child: Container(
                    width: 76,
                    height: 76,
                    decoration: BoxDecoration(
                      gradient: AgentTheme.goldGradient,
                      borderRadius: BorderRadius.circular(22),
                      boxShadow: [
                        BoxShadow(
                          color: AgentTheme.gold.withOpacity(0.35),
                          blurRadius: 20,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: const Center(
                      child: Text('👥', style: TextStyle(fontSize: 38)),
                    ),
                  ),
                ),
                const SizedBox(height: 20),

                const Text(
                  'AGENT PARTNER',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: AgentTheme.gold,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.2,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  'MyOnlineJoker Master Affiliate & Agency Portal',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: AgentTheme.textMuted,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 12),

                // Perks Tag
                Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    decoration: BoxDecoration(
                      color: AgentTheme.gold.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AgentTheme.gold.withOpacity(0.3)),
                    ),
                    child: const Text(
                      '⚡ Instant Payouts · Up to 15% Commissions',
                      style: TextStyle(color: AgentTheme.goldLight, fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                  ),
                ),
                const SizedBox(height: 28),

                // Error Banner
                if (_errorMessage != null)
                  Container(
                    margin: const EdgeInsets.only(bottom: 16),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AgentTheme.crimson.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AgentTheme.crimson.withOpacity(0.4)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline, color: AgentTheme.crimson, size: 20),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _errorMessage!,
                            style: const TextStyle(color: AgentTheme.crimson, fontSize: 13),
                          ),
                        ),
                      ],
                    ),
                  ),

                // Input Card
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: AgentTheme.cardBg,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: Colors.white.withOpacity(0.08)),
                  ),
                  child: Column(
                    children: [
                      TextField(
                        controller: _usernameController,
                        style: const TextStyle(color: Colors.white),
                        decoration: const InputDecoration(
                          labelText: 'Username or Mobile Number',
                          prefixIcon: Icon(Icons.person_outline, color: AgentTheme.gold),
                          hintText: 'e.g. agent_rahul or 9876543210',
                        ),
                      ),
                      const SizedBox(height: 16),
                      TextField(
                        controller: _passwordController,
                        obscureText: _obscurePassword,
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          labelText: 'Password',
                          prefixIcon: const Icon(Icons.lock_outline, color: AgentTheme.gold),
                          suffixIcon: IconButton(
                            icon: Icon(
                              _obscurePassword ? Icons.visibility_off : Icons.visibility,
                              color: AgentTheme.textMuted,
                            ),
                            onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                          ),
                        ),
                        onSubmitted: (_) => _handleLogin(),
                      ),
                      const SizedBox(height: 24),

                      // Sign In Button
                      SizedBox(
                        width: double.infinity,
                        height: 52,
                        child: ElevatedButton(
                          onPressed: _isLoading ? null : _handleLogin,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AgentTheme.gold,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          ),
                          child: _isLoading
                              ? const SizedBox(
                                  width: 24,
                                  height: 24,
                                  child: CircularProgressIndicator(color: Colors.black, strokeWidth: 2.5),
                                )
                              : const Text(
                                  'SIGN IN TO PORTAL',
                                  style: TextStyle(
                                    color: Colors.black,
                                    fontSize: 15,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                        ),
                      ),

                      // Biometric Login Button
                      if (_canCheckBiometrics) ...[
                        const SizedBox(height: 14),
                        OutlinedButton.icon(
                          onPressed: _authenticateWithBiometrics,
                          icon: const Icon(Icons.fingerprint, color: AgentTheme.gold, size: 24),
                          label: const Text(
                            'Quick Login with Biometrics',
                            style: TextStyle(color: AgentTheme.goldLight),
                          ),
                          style: OutlinedButton.styleFrom(
                            side: BorderSide(color: AgentTheme.gold.withOpacity(0.4)),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                            minimumSize: const Size.fromHeight(48),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 24),

                // Footer Info
                Center(
                  child: Column(
                    children: [
                      Text(
                        'Need an agent account? Contact Master Admin Support',
                        style: TextStyle(color: AgentTheme.textMuted.withOpacity(0.8), fontSize: 12),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Agent Partner App v1.0',
                        style: TextStyle(color: AgentTheme.gold.withOpacity(0.7), fontSize: 11, fontWeight: FontWeight.bold),
                      ),
                    ],
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

