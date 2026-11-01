import 'package:flutter/material.dart';
import '../agent_theme.dart';
import '../models/agent_models.dart';
import '../services/agent_api_service.dart';

class AgentPayoutsScreen extends StatefulWidget {
  const AgentPayoutsScreen({super.key});

  @override
  State<AgentPayoutsScreen> createState() => _AgentPayoutsScreenState();
}

class _AgentPayoutsScreenState extends State<AgentPayoutsScreen> {
  final _api = AgentApiService();
  final _amountCtrl = TextEditingController();
  final _upiCtrl = TextEditingController();
  final _bankAccCtrl = TextEditingController();
  final _ifscCtrl = TextEditingController();
  final _holderCtrl = TextEditingController();

  List<AgentPayoutItem> _payouts = [];
  bool _isLoading = true;
  bool _isSubmitting = false;
  bool _useUpi = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadPayouts();
  }

  Future<void> _loadPayouts() async {
    setState(() => _isLoading = true);
    try {
      final list = await _api.getPayouts();
      if (mounted) {
        setState(() {
          _payouts = list;
          _isLoading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _submitPayout() async {
    final amount = double.tryParse(_amountCtrl.text.trim());
    if (amount == null || amount < 100) {
      setState(() => _error = 'Minimum withdrawal amount is ₹100');
      return;
    }

    if (_useUpi && _upiCtrl.text.trim().isEmpty) {
      setState(() => _error = 'Please enter your UPI ID');
      return;
    }

    if (!_useUpi && (_bankAccCtrl.text.trim().isEmpty || _ifscCtrl.text.trim().isEmpty)) {
      setState(() => _error = 'Please enter complete bank details');
      return;
    }

    setState(() {
      _isSubmitting = true;
      _error = null;
    });

    try {
      final res = await _api.requestPayout(
        amount: amount,
        upiId: _useUpi ? _upiCtrl.text.trim() : null,
        bankAccount: !_useUpi ? _bankAccCtrl.text.trim() : null,
        ifsc: !_useUpi ? _ifscCtrl.text.trim() : null,
        accountHolder: !_useUpi ? _holderCtrl.text.trim() : null,
      );

      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _amountCtrl.clear();
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(res['message'] ?? 'Payout requested successfully!')),
        );
        _loadPayouts();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _error = e.toString().replaceAll('Exception: ', '');
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          Container(
            color: AgentTheme.surface,
            child: const TabBar(
              indicatorColor: AgentTheme.gold,
              labelColor: AgentTheme.gold,
              unselectedLabelColor: AgentTheme.textMuted,
              tabs: [
                Tab(icon: Icon(Icons.arrow_upward), text: 'Withdraw Earnings'),
                Tab(icon: Icon(Icons.history), text: 'Payout History'),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _buildWithdrawTab(),
                _buildHistoryTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWithdrawTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null)
            Container(
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: AgentTheme.crimson.withOpacity(0.15),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AgentTheme.crimson.withOpacity(0.3)),
              ),
              child: Text(_error!, style: const TextStyle(color: AgentTheme.crimson, fontSize: 13)),
            ),

          // Payout Mode Toggle
          Row(
            children: [
              Expanded(
                child: ChoiceChip(
                  label: const Center(child: Text('UPI Transfer')),
                  selected: _useUpi,
                  selectedColor: AgentTheme.gold,
                  labelStyle: TextStyle(
                    color: _useUpi ? Colors.black : Colors.white70,
                    fontWeight: FontWeight.bold,
                  ),
                  onSelected: (val) => setState(() => _useUpi = true),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ChoiceChip(
                  label: const Center(child: Text('Bank Account')),
                  selected: !_useUpi,
                  selectedColor: AgentTheme.gold,
                  labelStyle: TextStyle(
                    color: !_useUpi ? Colors.black : Colors.white70,
                    fontWeight: FontWeight.bold,
                  ),
                  onSelected: (val) => setState(() => _useUpi = false),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),

          // Amount Field
          TextField(
            controller: _amountCtrl,
            keyboardType: TextInputType.number,
            style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
            decoration: const InputDecoration(
              labelText: 'Withdrawal Amount',
              prefixText: '₹ ',
              prefixStyle: TextStyle(color: AgentTheme.gold, fontSize: 20, fontWeight: FontWeight.bold),
              hintText: '500',
            ),
          ),
          const SizedBox(height: 16),

          if (_useUpi) ...[
            TextField(
              controller: _upiCtrl,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'UPI VPA / PhonePe / GPay',
                prefixIcon: Icon(Icons.qr_code, color: AgentTheme.gold),
                hintText: 'e.g. mobile@ybl or username@oksbi',
              ),
            ),
          ] else ...[
            TextField(
              controller: _holderCtrl,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(labelText: 'Account Holder Name'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _bankAccCtrl,
              keyboardType: TextInputType.number,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(labelText: 'Bank Account Number'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _ifscCtrl,
              textCapitalization: TextCapitalization.characters,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(labelText: 'Bank IFSC Code'),
            ),
          ],

          const SizedBox(height: 24),

          // Security Note
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AgentTheme.surface,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Row(
              children: [
                Icon(Icons.shield_outlined, color: AgentTheme.gold, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Protected by Argus AI Compliance. Payouts are routed directly to your bank account within 24 hours.',
                    style: TextStyle(color: AgentTheme.textMuted, fontSize: 11),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          SizedBox(
            height: 52,
            child: ElevatedButton(
              onPressed: _isSubmitting ? null : _submitPayout,
              style: ElevatedButton.styleFrom(
                backgroundColor: AgentTheme.gold,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: _isSubmitting
                  ? const CircularProgressIndicator(color: Colors.black, strokeWidth: 2.5)
                  : const Text('SUBMIT WITHDRAWAL REQUEST', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 14)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHistoryTab() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: AgentTheme.gold));
    }

    if (_payouts.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.receipt_long_outlined, color: AgentTheme.textMuted.withOpacity(0.4), size: 56),
            const SizedBox(height: 12),
            const Text('No payout requests yet', style: TextStyle(color: AgentTheme.textMuted)),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _payouts.length,
      itemBuilder: (ctx, i) {
        final p = _payouts[i];
        final isPaid = p.status == 'paid';
        final isRejected = p.status == 'rejected';

        final statusColor = isPaid
            ? AgentTheme.emerald
            : isRejected
                ? AgentTheme.crimson
                : Colors.amber;

        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AgentTheme.cardBg,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white.withOpacity(0.08)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '₹${p.amount.toStringAsFixed(2)}',
                    style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    p.reference != null ? 'Ref: ${p.reference}' : 'Date: ${p.requestedAt?.split('T')[0] ?? "Today"}',
                    style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: statusColor.withOpacity(0.4)),
                ),
                child: Text(
                  p.status.toUpperCase(),
                  style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

