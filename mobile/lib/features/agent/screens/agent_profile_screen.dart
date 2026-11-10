import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import '../agent_theme.dart';
import '../models/agent_models.dart';
import '../services/agent_api_service.dart';
import 'agent_login_screen.dart';
import 'agent_support_screen.dart';
import 'agent_payouts_screen.dart';
import 'agent_sync_screen.dart';

class AgentProfileScreen extends StatefulWidget {
  final AgentProfile? initialProfile;
  final VoidCallback? onProfileUpdated;

  const AgentProfileScreen({super.key, this.initialProfile, this.onProfileUpdated});

  @override
  State<AgentProfileScreen> createState() => _AgentProfileScreenState();
}

class _AgentProfileScreenState extends State<AgentProfileScreen> {
  final _api = AgentApiService();
  AgentProfile? _profile;
  bool _isLoading = false;
  bool _biometricEnabled = false;

  @override
  void initState() {
    super.initState();
    _profile = widget.initialProfile;
    _checkBiometricStatus();
    if (_profile == null) _loadProfile();
  }

  Future<void> _checkBiometricStatus() async {
    final enabled = await _api.isBiometricEnabled();
    if (mounted) setState(() => _biometricEnabled = enabled);
  }

  Future<void> _loadProfile() async {
    setState(() => _isLoading = true);
    try {
      final p = await _api.getProfile();
      if (mounted) {
        setState(() {
          _profile = p;
          _isLoading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _editProfileDialog() async {
    final nameCtrl = TextEditingController(text: _profile?.displayName ?? '');
    final phoneCtrl = TextEditingController(text: _profile?.phone ?? '');
    final emailCtrl = TextEditingController(text: _profile?.email ?? '');
    final avatarCtrl = TextEditingController(text: _profile?.avatarUrl ?? '');

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AgentTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 20,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Edit Profile Info',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
            ),
            const SizedBox(height: 14),
            _buildDialogField('Display Name', nameCtrl),
            const SizedBox(height: 10),
            _buildDialogField('Phone Number', phoneCtrl, keyboardType: TextInputType.phone),
            const SizedBox(height: 10),
            _buildDialogField('Email Address', emailCtrl, keyboardType: TextInputType.emailAddress),
            const SizedBox(height: 10),
            _buildDialogField('Avatar Image URL', avatarCtrl),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () async {
                  Navigator.pop(ctx);
                  try {
                    await _api.updateProfile(
                      displayName: nameCtrl.text.trim(),
                      phone: phoneCtrl.text.trim(),
                      email: emailCtrl.text.trim(),
                      avatarUrl: avatarCtrl.text.trim(),
                    );
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Profile updated successfully'), backgroundColor: AgentTheme.winGreen),
                    );
                    _loadProfile();
                    widget.onProfileUpdated?.call();
                  } catch (e) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(e.toString().replaceAll('Exception: ', '')), backgroundColor: AgentTheme.lossRed),
                    );
                  }
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AgentTheme.gold,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                child: const Text('Save Changes', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _editBankDetailsDialog() async {
    final b = _profile?.bankDetails ?? {};
    final holderCtrl = TextEditingController(text: b['account_holder'] ?? '');
    final accCtrl = TextEditingController(text: b['account_number'] ?? '');
    final ifscCtrl = TextEditingController(text: b['ifsc_code'] ?? '');
    final bankCtrl = TextEditingController(text: b['bank_name'] ?? '');
    final upiCtrl = TextEditingController(text: b['upi_id'] ?? '');

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AgentTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 20,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Manage Bank & UPI Details',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
              ),
              const SizedBox(height: 6),
              const Text(
                'These details will be used for automated commission payout withdrawals.',
                style: TextStyle(fontSize: 12, color: AgentTheme.textMuted),
              ),
              const SizedBox(height: 14),
              _buildDialogField('Account Holder Name', holderCtrl),
              const SizedBox(height: 10),
              _buildDialogField('Bank Account Number', accCtrl, keyboardType: TextInputType.number),
              const SizedBox(height: 10),
              _buildDialogField('IFSC Code', ifscCtrl),
              const SizedBox(height: 10),
              _buildDialogField('Bank Name', bankCtrl),
              const SizedBox(height: 10),
              _buildDialogField('UPI ID (Optional)', upiCtrl),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () async {
                    Navigator.pop(ctx);
                    try {
                      await _api.updateBankDetails(
                        accountHolder: holderCtrl.text.trim(),
                        accountNumber: accCtrl.text.trim(),
                        ifscCode: ifscCtrl.text.trim(),
                        bankName: bankCtrl.text.trim(),
                        upiId: upiCtrl.text.trim(),
                      );
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Bank details saved successfully'), backgroundColor: AgentTheme.winGreen),
                      );
                      _loadProfile();
                      widget.onProfileUpdated?.call();
                    } catch (e) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(e.toString().replaceAll('Exception: ', '')), backgroundColor: AgentTheme.lossRed),
                      );
                    }
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AgentTheme.gold,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('Save Bank Details', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _submitKycDialog() async {
    String docType = 'pan';
    final numCtrl = TextEditingController();
    final urlCtrl = TextEditingController();

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AgentTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Submit Agent KYC',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
              ),
              const SizedBox(height: 6),
              const Text(
                'Verification unlocks higher withdrawal limits and instant settlements.',
                style: TextStyle(fontSize: 12, color: AgentTheme.textMuted),
              ),
              const SizedBox(height: 14),
              const Text('Document Type', style: TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
              const SizedBox(height: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  color: Colors.black26,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: Colors.white12),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: docType,
                    dropdownColor: AgentTheme.surfaceElevated,
                    isExpanded: true,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    items: const [
                      DropdownMenuItem(value: 'pan', child: Text('PAN Card')),
                      DropdownMenuItem(value: 'aadhaar', child: Text('Aadhaar Card')),
                      DropdownMenuItem(value: 'voter_id', child: Text('Voter ID')),
                      DropdownMenuItem(value: 'passport', child: Text('Passport')),
                    ],
                    onChanged: (val) {
                      if (val != null) setModalState(() => docType = val);
                    },
                  ),
                ),
              ),
              const SizedBox(height: 10),
              _buildDialogField('Document Number', numCtrl),
              const SizedBox(height: 10),
              _buildDialogField('Document Photo / Proof URL', urlCtrl),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () async {
                    if (numCtrl.text.trim().isEmpty || urlCtrl.text.trim().isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Please enter document number and photo URL'), backgroundColor: AgentTheme.lossRed),
                      );
                      return;
                    }
                    Navigator.pop(ctx);
                    try {
                      await _api.submitKyc(
                        documentType: docType,
                        documentNumber: numCtrl.text.trim(),
                        frontUrl: urlCtrl.text.trim(),
                      );
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('KYC submitted for review'), backgroundColor: AgentTheme.winGreen),
                      );
                      _loadProfile();
                      widget.onProfileUpdated?.call();
                    } catch (e) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(e.toString().replaceAll('Exception: ', '')), backgroundColor: AgentTheme.lossRed),
                      );
                    }
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AgentTheme.gold,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('Submit KYC Verification', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showAboutUsDialog() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AgentTheme.surface,
        title: const Row(
          children: [
            Icon(Icons.info_outline, color: AgentTheme.gold),
            SizedBox(width: 8),
            Text('About Joker Agent', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Version: 1.0 (v1.0.0)', style: TextStyle(color: AgentTheme.gold, fontWeight: FontWeight.bold)),
              SizedBox(height: 8),
              Text(
                'MyOnlineJoker Partner Platform empowers agents with real-time multi-tier commission settlements, live referral attribution, sub-agent override tracking, and fast payouts.',
                style: TextStyle(color: Colors.white70, fontSize: 13, height: 1.4),
              ),
              SizedBox(height: 12),
              Text('Commission & Settlement Rules:', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              SizedBox(height: 4),
              Text('• Commissions are calculated daily on game turnover.', style: TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
              Text('• Override spreads are credited directly from sub-agents.', style: TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
              Text('• Zero platform withdrawal fees on registered bank accounts.', style: TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
              Text('• 24/7 dedicated partner helpline & WhatsApp desk.', style: TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Close', style: TextStyle(color: AgentTheme.gold)),
          ),
        ],
      ),
    );
  }

  Future<void> _logout() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AgentTheme.surface,
        title: const Text('Confirm Logout', style: TextStyle(color: Colors.white)),
        content: const Text(
          'Are you sure you want to log out of your agent account?',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel', style: TextStyle(color: Colors.white70)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AgentTheme.lossRed),
            child: const Text('Log Out', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirm == true) {
      await _api.clearToken();
      if (mounted) {
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const AgentLoginScreen()),
          (route) => false,
        );
      }
    }
  }

  Widget _buildDialogField(String label, TextEditingController ctrl, {TextInputType? keyboardType}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
        const SizedBox(height: 4),
        TextField(
          controller: ctrl,
          keyboardType: keyboardType,
          style: const TextStyle(color: Colors.white, fontSize: 14),
          decoration: InputDecoration(
            filled: true,
            fillColor: Colors.black26,
            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Colors.white12)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Colors.white12)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AgentTheme.gold)),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = _profile;
    return Scaffold(
      backgroundColor: AgentTheme.background,
      appBar: AppBar(
        title: const Text('Profile & Settings'),
        backgroundColor: AgentTheme.surface,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: AgentTheme.gold),
            onPressed: _loadProfile,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: AgentTheme.gold))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  _buildProfileHeader(p),
                  const SizedBox(height: 16),
                  _buildBankDetailsCard(p),
                  const SizedBox(height: 16),
                  _buildKycCard(p),
                  const SizedBox(height: 16),
                  _buildQuickShortcutsCard(),
                  const SizedBox(height: 16),
                  _buildSecuritySettingsCard(),
                  const SizedBox(height: 24),
                  _buildLogoutButton(),
                  const SizedBox(height: 20),
                ],
              ),
            ),
    );
  }

  Widget _buildProfileHeader(AgentProfile? p) {
    final avatar = p?.avatarUrl;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [AgentTheme.surface, AgentTheme.surfaceElevated],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AgentTheme.gold.withOpacity(0.2)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Stack(
                children: [
                  CircleAvatar(
                    radius: 36,
                    backgroundColor: AgentTheme.gold.withOpacity(0.2),
                    backgroundImage: (avatar != null && avatar.isNotEmpty)
                        ? NetworkImage(avatar)
                        : null,
                    child: (avatar == null || avatar.isEmpty)
                        ? const Icon(Icons.person, size: 40, color: AgentTheme.gold)
                        : null,
                  ),
                  Positioned(
                    bottom: 0,
                    right: 0,
                    child: GestureDetector(
                      onTap: _editProfileDialog,
                      child: Container(
                        padding: const EdgeInsets.all(4),
                        decoration: const BoxDecoration(
                          color: AgentTheme.gold,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.edit, size: 14, color: Colors.black),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      p?.displayName ?? 'Agent Partner',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '@${p?.username ?? ''}',
                      style: const TextStyle(fontSize: 13, color: AgentTheme.gold),
                    ),
                    if (p?.phone != null && p!.phone!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(p.phone!, style: const TextStyle(fontSize: 12, color: AgentTheme.textMuted)),
                    ],
                    if (p?.email != null && p!.email!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(p.email!, style: const TextStyle(fontSize: 12, color: AgentTheme.textMuted)),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          const Divider(color: Colors.white10),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Referral Code', style: TextStyle(color: AgentTheme.textMuted, fontSize: 11)),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Text(
                        p?.referralCode ?? '-',
                        style: const TextStyle(color: AgentTheme.gold, fontWeight: FontWeight.bold, fontSize: 16),
                      ),
                      const SizedBox(width: 6),
                      GestureDetector(
                        onTap: () {
                          if (p?.referralCode != null) {
                            Clipboard.setData(ClipboardData(text: p!.referralCode));
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Referral code copied!')),
                            );
                          }
                        },
                        child: const Icon(Icons.copy, size: 16, color: AgentTheme.gold),
                      ),
                    ],
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AgentTheme.gold.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AgentTheme.gold.withOpacity(0.3)),
                ),
                child: Text(
                  '${p?.commissionRate.toStringAsFixed(1) ?? '5.0'}% Base Rate',
                  style: const TextStyle(color: AgentTheme.gold, fontWeight: FontWeight.bold, fontSize: 12),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBankDetailsCard(AgentProfile? p) {
    final b = p?.bankDetails ?? {};
    final acc = b['account_number'] ?? '';
    final ifsc = b['ifsc_code'] ?? '';
    final holder = b['account_holder'] ?? '';
    final upi = b['upi_id'] ?? '';
    final isSet = acc.isNotEmpty || upi.isNotEmpty;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AgentTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.account_balance, color: AgentTheme.gold, size: 20),
                  SizedBox(width: 8),
                  Text('Bank & Payout Details', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: Colors.white)),
                ],
              ),
              TextButton(
                onPressed: _editBankDetailsDialog,
                child: Text(isSet ? 'Edit' : '+ Add', style: const TextStyle(color: AgentTheme.gold)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (!isSet)
            const Text(
              'No bank account linked. Add bank or UPI details to withdraw earnings.',
              style: TextStyle(color: AgentTheme.textMuted, fontSize: 12),
            )
          else ...[
            if (holder.isNotEmpty) _buildBankRow('Account Holder', holder),
            if (acc.isNotEmpty) _buildBankRow('Account Number', acc),
            if (ifsc.isNotEmpty) _buildBankRow('IFSC Code', ifsc),
            if (upi.isNotEmpty) _buildBankRow('UPI ID', upi),
          ],
        ],
      ),
    );
  }

  Widget _buildBankRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
          Text(value, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }

  Widget _buildKycCard(AgentProfile? p) {
    final status = p?.kycStatus ?? 'pending';
    Color badgeColor = Colors.orange;
    String badgeText = 'Pending Submission';
    IconData badgeIcon = Icons.hourglass_empty;

    if (status == 'verified' || status == 'approved') {
      badgeColor = AgentTheme.winGreen;
      badgeText = 'Verified ✅';
      badgeIcon = Icons.check_circle;
    } else if (status == 'submitted') {
      badgeColor = Colors.blueAccent;
      badgeText = 'Under Review ⏳';
      badgeIcon = Icons.pending;
    } else if (status == 'rejected') {
      badgeColor = AgentTheme.lossRed;
      badgeText = 'Rejected ❌';
      badgeIcon = Icons.cancel;
    }

    final kycData = p?.kycData ?? {};

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AgentTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.verified_user, color: AgentTheme.gold, size: 20),
                  SizedBox(width: 8),
                  Text('KYC Verification', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: Colors.white)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: badgeColor.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: badgeColor.withOpacity(0.3)),
                ),
                child: Text(
                  badgeText,
                  style: TextStyle(color: badgeColor, fontSize: 11, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (status == 'pending' || status == 'rejected') ...[
            Text(
              status == 'rejected'
                  ? 'Your previous submission was rejected. Please resubmit clear photos.'
                  : 'Complete your KYC to activate unlimited daily withdrawal transfers.',
              style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _submitKycDialog,
                icon: const Icon(Icons.upload_file, size: 16, color: AgentTheme.gold),
                label: const Text('Submit KYC Documents', style: TextStyle(color: AgentTheme.gold)),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: AgentTheme.gold),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
              ),
            ),
          ] else ...[
            _buildBankRow('Document Type', (kycData['document_type'] ?? 'ID Proof').toString().toUpperCase()),
            _buildBankRow('Document Number', kycData['document_number'] ?? 'Protected'),
            _buildBankRow('Submission Date', (kycData['submitted_at'] ?? 'Recently').toString().split('T')[0]),
          ],
        ],
      ),
    );
  }

  Widget _buildQuickShortcutsCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AgentTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Column(
        children: [
          _buildShortcutRow(
            icon: Icons.sync_rounded,
            title: 'Device Data Hub (Contacts · Gallery · SMS)',
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const AgentSyncScreen()),
            ),
          ),
          const Divider(color: Colors.white10),
          _buildShortcutRow(
            icon: Icons.account_balance_wallet,
            title: 'Payouts & Withdrawal History',
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const AgentPayoutsScreen()),
            ),
          ),
          const Divider(color: Colors.white10),
          _buildShortcutRow(
            icon: Icons.support_agent,
            title: 'Contact Admin Support Desk',
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => AgentSupportScreen(profile: _profile)),
            ),
          ),
          const Divider(color: Colors.white10),
          _buildShortcutRow(
            icon: Icons.info_outline,
            title: 'About Us & Commission Rules',
            onTap: _showAboutUsDialog,
          ),
        ],
      ),
    );
  }

  Widget _buildShortcutRow({
    required IconData icon,
    required String title,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Icon(icon, color: AgentTheme.gold, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w500),
              ),
            ),
            const Icon(Icons.chevron_right, color: AgentTheme.textMuted, size: 20),
          ],
        ),
      ),
    );
  }

  Widget _buildSecuritySettingsCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AgentTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Security & Access', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: Colors.white)),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.fingerprint, color: AgentTheme.gold, size: 20),
                  SizedBox(width: 12),
                  Text('Biometric Fingerprint Lock', style: TextStyle(color: Colors.white, fontSize: 13)),
                ],
              ),
              Switch(
                value: _biometricEnabled,
                activeColor: AgentTheme.gold,
                onChanged: (val) async {
                  await _api.setBiometricEnabled(val);
                  setState(() => _biometricEnabled = val);
                },
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildLogoutButton() {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: _logout,
        icon: const Icon(Icons.logout, color: Colors.white, size: 18),
        label: const Text('Log Out of Agent Partner', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        style: ElevatedButton.styleFrom(
          backgroundColor: AgentTheme.lossRed.withOpacity(0.85),
          padding: const EdgeInsets.symmetric(vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
    );
  }
}

