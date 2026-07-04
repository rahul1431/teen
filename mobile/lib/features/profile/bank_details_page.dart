import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import '../../core/network/api_client.dart';
import '../../shared/theme/app_theme.dart';

/// View/update the payout bank account (GET/PUT /api/users/me/bank).
/// Saving resets verification — admin re-verifies changed details.
class BankDetailsPage extends StatefulWidget {
  const BankDetailsPage({super.key});
  @override
  State<BankDetailsPage> createState() => _BankDetailsPageState();
}

class _BankDetailsPageState extends State<BankDetailsPage> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _holderCtrl = TextEditingController();
  final _bankCtrl = TextEditingController();
  final _accountCtrl = TextEditingController();
  final _ifscCtrl = TextEditingController();
  final _upiCtrl = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  bool _verified = false;
  bool _hasExisting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _holderCtrl.dispose();
    _bankCtrl.dispose();
    _accountCtrl.dispose();
    _ifscCtrl.dispose();
    _upiCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final res = await _api.dio.get('/api/users/me/bank');
      final bank = res.data['bank'];
      if (bank != null && mounted) {
        _holderCtrl.text = bank['holder_name'] ?? '';
        _bankCtrl.text = bank['bank_name'] ?? '';
        _accountCtrl.text = bank['account_number'] ?? '';
        _ifscCtrl.text = bank['ifsc_code'] ?? '';
        _upiCtrl.text = bank['upi_id'] ?? '';
        _verified = bank['verified'] == true;
        _hasExisting = true;
      }
    } catch (_) {
      if (mounted) AppSnackBar.show(context, 'Could not load bank details', error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final res = await _api.dio.put('/api/users/me/bank', data: {
        'holder_name': _holderCtrl.text.trim(),
        'bank_name': _bankCtrl.text.trim(),
        'account_number': _accountCtrl.text.trim(),
        'ifsc_code': _ifscCtrl.text.trim().toUpperCase(),
        if (_upiCtrl.text.trim().isNotEmpty) 'upi_id': _upiCtrl.text.trim(),
      });
      if (!mounted) return;
      setState(() { _verified = false; _hasExisting = true; });
      AppSnackBar.show(context, res.data['message'] ?? 'Bank details saved', success: true);
    } on DioException catch (e) {
      if (mounted) {
        AppSnackBar.show(context,
            e.response?.data?['error']?.toString() ?? 'Could not save bank details',
            error: true);
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Bank Details')),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_hasExisting)
                      Container(
                        margin: const EdgeInsets.only(bottom: 18),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          color: (_verified ? AppColors.green : AppColors.orange).withOpacity(0.12),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                              color: (_verified ? AppColors.green : AppColors.orange).withOpacity(0.4)),
                        ),
                        child: Row(
                          children: [
                            Icon(_verified ? Icons.verified_rounded : Icons.hourglass_top_rounded,
                                color: _verified ? AppColors.green : AppColors.orange, size: 18),
                            const SizedBox(width: 8),
                            Text(_verified ? 'Verified' : 'Pending verification',
                                style: TextStyle(
                                  color: _verified ? AppColors.green : AppColors.orange,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                )),
                          ],
                        ),
                      ),
                    TextFormField(
                      controller: _holderCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Account Holder Name',
                        prefixIcon: Icon(Icons.person_rounded),
                      ),
                      validator: (v) => (v == null || v.trim().length < 2) ? 'Enter the account holder name' : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _bankCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Bank Name',
                        prefixIcon: Icon(Icons.account_balance_rounded),
                      ),
                      validator: (v) => (v == null || v.trim().length < 2) ? 'Enter the bank name' : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _accountCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Account Number',
                        prefixIcon: Icon(Icons.numbers_rounded),
                      ),
                      validator: (v) => (v == null || !RegExp(r'^\d{6,20}$').hasMatch(v.trim()))
                          ? 'Enter a valid account number (digits only)'
                          : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _ifscCtrl,
                      textCapitalization: TextCapitalization.characters,
                      decoration: const InputDecoration(
                        labelText: 'IFSC Code',
                        prefixIcon: Icon(Icons.qr_code_rounded),
                      ),
                      validator: (v) => (v == null ||
                              !RegExp(r'^[A-Za-z]{4}0[A-Za-z0-9]{6}$').hasMatch(v.trim()))
                          ? 'Enter a valid IFSC code (e.g. HDFC0001234)'
                          : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _upiCtrl,
                      decoration: const InputDecoration(
                        labelText: 'UPI ID (optional)',
                        prefixIcon: Icon(Icons.alternate_email_rounded),
                      ),
                    ),
                    const SizedBox(height: 26),
                    SizedBox(
                      height: 52,
                      child: ElevatedButton(
                        onPressed: _saving ? null : _save,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.gold,
                          foregroundColor: Colors.black,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                        child: _saving
                            ? const SizedBox(width: 22, height: 22,
                                child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.black))
                            : const Text('Save Bank Details',
                                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'Withdrawals are paid only to a verified account. Updating details requires re-verification by our team.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 11.5, height: 1.4),
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}
