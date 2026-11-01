import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import '../agent_theme.dart';
import '../services/agent_api_service.dart';

class AgentTopUpScreen extends StatefulWidget {
  final double currentBalance;
  final String? preselectedPlayer;

  const AgentTopUpScreen({
    super.key,
    required this.currentBalance,
    this.preselectedPlayer,
  });

  @override
  State<AgentTopUpScreen> createState() => _AgentTopUpScreenState();
}

class _AgentTopUpScreenState extends State<AgentTopUpScreen> {
  final _searchController = TextEditingController();
  final _amountController = TextEditingController();
  final _notesController = TextEditingController();
  final _api = AgentApiService();

  List<Map<String, dynamic>> _searchResults = [];
  Map<String, dynamic>? _selectedPlayer;
  bool _isSearching = false;
  bool _isSubmitting = false;
  String? _errorMessage;

  final List<double> _presetAmounts = [100, 500, 1000, 2000, 5000];

  @override
  void initState() {
    super.initState();
    if (widget.preselectedPlayer != null) {
      _searchController.text = widget.preselectedPlayer!;
      _performSearch(widget.preselectedPlayer!);
    }
  }

  Future<void> _performSearch(String query) async {
    if (query.trim().length < 2) {
      setState(() => _searchResults = []);
      return;
    }
    setState(() => _isSearching = true);
    try {
      final results = await _api.searchPlayer(query.trim());
      if (mounted) {
        setState(() {
          _searchResults = results;
          _isSearching = false;
          if (results.length == 1 && widget.preselectedPlayer != null) {
            _selectedPlayer = results.first;
          }
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isSearching = false);
    }
  }

  Future<void> _executeTopUp() async {
    if (_selectedPlayer == null) {
      setState(() => _errorMessage = 'Please select a player to credit chips');
      return;
    }

    final amount = double.tryParse(_amountController.text.trim());
    if (amount == null || amount < 10) {
      setState(() => _errorMessage = 'Minimum transfer amount is ₹10');
      return;
    }

    if (amount > widget.currentBalance) {
      setState(() => _errorMessage = 'Insufficient balance in your agent wallet');
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AgentTheme.cardBg,
        title: const Text('Confirm Chip Transfer', style: TextStyle(color: AgentTheme.gold)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Player: ${_selectedPlayer!['username']}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            Text('Amount: ₹${amount.toStringAsFixed(2)}', style: const TextStyle(color: AgentTheme.emerald, fontSize: 18, fontWeight: FontWeight.w900)),
            const SizedBox(height: 10),
            const Text('Chips will be credited immediately to the player wallet.', style: TextStyle(color: AgentTheme.textMuted, fontSize: 13)),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AgentTheme.gold),
            child: const Text('Transfer Now', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      final res = await _api.topUpPlayer(
        playerIdentifier: _selectedPlayer!['username'] ?? _selectedPlayer!['phone'],
        amount: amount,
        notes: _notesController.text.trim(),
      );

      if (mounted) {
        setState(() => _isSubmitting = false);
        _showSuccessReceipt(res, amount);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _errorMessage = e.toString().replaceAll('Exception: ', '');
        });
      }
    }
  }

  void _showSuccessReceipt(Map<String, dynamic> res, double amount) {
    final txnId = res['transaction_id'] ?? 'TXN';
    final player = res['player'] as Map<String, dynamic>? ?? {};
    final username = player['username'] ?? 'Player';

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: AgentTheme.cardBg,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AgentTheme.emerald.withOpacity(0.15),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.check_circle, color: AgentTheme.emerald, size: 48),
            ),
            const SizedBox(height: 16),
            const Text(
              'TRANSFER SUCCESSFUL',
              style: TextStyle(color: AgentTheme.gold, fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              '₹${amount.toStringAsFixed(2)}',
              style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 4),
            Text('Credited to $username', style: const TextStyle(color: AgentTheme.textMuted, fontSize: 13)),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AgentTheme.surface,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Txn ID:', style: TextStyle(color: AgentTheme.textMuted, fontSize: 11)),
                      Text('$txnId', style: const TextStyle(color: Colors.white, fontSize: 11, fontFamily: 'monospace')),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Status:', style: TextStyle(color: AgentTheme.textMuted, fontSize: 11)),
                      const Text('Completed', style: TextStyle(color: AgentTheme.emerald, fontSize: 11, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      final receipt = '🃏 *MyOnlineJoker Chip Transfer Receipt*\n\n'
                          '✅ Status: SUCCESS\n'
                          '👤 Player: $username\n'
                          '💰 Amount: ₹${amount.toStringAsFixed(2)}\n'
                          '🆔 Reference: $txnId\n\n'
                          'Play now at https://game.myonlinejoker.com';
                      Share.share(receipt, subject: 'MyOnlineJoker Deposit Receipt');
                    },
                    icon: const Icon(Icons.share, size: 18, color: AgentTheme.gold),
                    label: const Text('Share Receipt', style: TextStyle(color: AgentTheme.gold)),
                    style: OutlinedButton.styleFrom(side: BorderSide(color: AgentTheme.gold.withOpacity(0.5))),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.pop(ctx);
                      Navigator.pop(context, true);
                    },
                    style: ElevatedButton.styleFrom(backgroundColor: AgentTheme.gold),
                    child: const Text('Done', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AgentTheme.background,
      appBar: AppBar(
        title: const Text('Top Up Player Chips'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Available Balance Reminder
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: AgentTheme.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Colors.white.withOpacity(0.08)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Agent Balance:', style: TextStyle(color: AgentTheme.textMuted)),
                  Text(
                    '₹${widget.currentBalance.toStringAsFixed(2)}',
                    style: const TextStyle(color: AgentTheme.gold, fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),

            // Error Message
            if (_errorMessage != null)
              Container(
                margin: const EdgeInsets.only(bottom: 14),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AgentTheme.crimson.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AgentTheme.crimson.withOpacity(0.4)),
                ),
                child: Text(_errorMessage!, style: const TextStyle(color: AgentTheme.crimson, fontSize: 13)),
              ),

            // Step 1: Search Player
            const Text(
              '1. SELECT PLAYER',
              style: TextStyle(color: AgentTheme.gold, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 0.8),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _searchController,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: 'Search player username or mobile number...',
                prefixIcon: const Icon(Icons.search, color: AgentTheme.gold),
                suffixIcon: _isSearching
                    ? const Padding(
                        padding: EdgeInsets.all(12.0),
                        child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AgentTheme.gold)),
                      )
                    : null,
              ),
              onChanged: (val) => _performSearch(val),
            ),

            // Search Results List
            if (_searchResults.isNotEmpty && _selectedPlayer == null) ...[
              const SizedBox(height: 8),
              Container(
                decoration: BoxDecoration(
                  color: AgentTheme.cardBg,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.white12),
                ),
                child: ListView.separated(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: _searchResults.length,
                  separatorBuilder: (_, __) => const Divider(color: Colors.white12, height: 1),
                  itemBuilder: (_, i) {
                    final p = _searchResults[i];
                    return ListTile(
                      title: Text(p['username'] ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                      subtitle: Text(p['phone'] ?? '', style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
                      trailing: ElevatedButton(
                        onPressed: () {
                          setState(() {
                            _selectedPlayer = p;
                            _searchResults = [];
                          });
                        },
                        style: ElevatedButton.styleFrom(backgroundColor: AgentTheme.gold, padding: const EdgeInsets.symmetric(horizontal: 12)),
                        child: const Text('Select', style: TextStyle(color: Colors.black, fontSize: 12, fontWeight: FontWeight.bold)),
                      ),
                    );
                  },
                ),
              ),
            ],

            // Selected Player Card
            if (_selectedPlayer != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AgentTheme.emerald.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AgentTheme.emerald.withOpacity(0.4)),
                ),
                child: Row(
                  children: [
                    const CircleAvatar(
                      backgroundColor: AgentTheme.emerald,
                      child: Icon(Icons.person, color: Colors.black),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_selectedPlayer!['username'] ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                          Text('Mobile: ${_selectedPlayer!['phone'] ?? "N/A"}', style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
                          Text('Current Balance: ₹${(_selectedPlayer!['real_balance'] as num?)?.toStringAsFixed(2) ?? "0.00"}',
                              style: const TextStyle(color: AgentTheme.emerald, fontSize: 12, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.white70),
                      onPressed: () => setState(() => _selectedPlayer = null),
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 24),

            // Step 2: Amount
            const Text(
              '2. ENTER CHIPS AMOUNT (₹)',
              style: TextStyle(color: AgentTheme.gold, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 0.8),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _amountController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold),
              decoration: const InputDecoration(
                prefixText: '₹ ',
                prefixStyle: TextStyle(color: AgentTheme.gold, fontSize: 22, fontWeight: FontWeight.bold),
                hintText: '500',
              ),
            ),
            const SizedBox(height: 12),

            // Quick Chips
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _presetAmounts.map((amt) {
                return ActionChip(
                  label: Text('+₹${amt.toInt()}'),
                  backgroundColor: AgentTheme.surface,
                  labelStyle: const TextStyle(color: AgentTheme.goldLight, fontWeight: FontWeight.bold),
                  side: BorderSide(color: Colors.white.withOpacity(0.1)),
                  onPressed: () {
                    _amountController.text = amt.toInt().toString();
                  },
                );
              }).toList(),
            ),

            const SizedBox(height: 28),

            // Transfer Button
            SizedBox(
              height: 54,
              child: ElevatedButton.icon(
                onPressed: _isSubmitting ? null : _executeTopUp,
                icon: const Icon(Icons.send_rounded, color: Colors.black),
                label: _isSubmitting
                    ? const CircularProgressIndicator(color: Colors.black, strokeWidth: 2.5)
                    : const Text(
                        'TRANSFER CHIPS INSTANTLY',
                        style: TextStyle(color: Colors.black, fontSize: 15, fontWeight: FontWeight.bold),
                      ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AgentTheme.gold,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

