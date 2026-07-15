import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/network/api_client.dart';
import '../../../core/audio/sound_service.dart';
import '../../../shared/theme/app_theme.dart';

class LotteryDailyBuySheet extends StatefulWidget {
  final dynamic draw;
  final double price;
  final double balance;
  final VoidCallback onPurchased;

  const LotteryDailyBuySheet({
    required this.draw,
    required this.price,
    required this.balance,
    required this.onPurchased,
  });

  @override
  State<LotteryDailyBuySheet> createState() => _LotteryDailyBuySheetState();
}

class _LotteryDailyBuySheetState extends State<LotteryDailyBuySheet> {
  final List<TextEditingController> _digitControllers = List.generate(4, (_) => TextEditingController());
  final List<FocusNode> _focusNodes = List.generate(4, (_) => FocusNode());
  bool _loading = false;
  String? _errorMessage;
  static const int _totalNumbers = 10000;

  @override
  void initState() {
    super.initState();
    // Setup auto-tab on digit entry
    for (int i = 0; i < 4; i++) {
      _digitControllers[i].addListener(() {
        if (_digitControllers[i].text.isNotEmpty && i < 3) {
          FocusScope.of(context).requestFocus(_focusNodes[i + 1]);
        }
      });
    }
  }

  List<String> get _reserved {
    final resTickets = widget.draw['reserved_tickets'];
    if (resTickets is List) {
      return resTickets.map((t) => t.toString().trim()).toList();
    }
    return [];
  }

  void _quickPick() {
    SoundService.instance.play(Sfx.buttonTap);
    final reserved = _reserved.toSet();
    String candidate;
    var attempts = 0;
    do {
      candidate = math.Random().nextInt(10000).toString().padLeft(4, '0');
      attempts++;
    } while (reserved.contains(candidate) && attempts < 200);
    _fillNumber(candidate);
  }

  void _fillNumber(String number) {
    for (var i = 0; i < 4; i++) {
      _digitControllers[i].text = number[i];
    }
    setState(() => _errorMessage = null);
  }

  Future<void> _buy() async {
    // Validate input
    final ticketNumber = _digitControllers.map((c) => c.text).join();
    if (ticketNumber.length != 4 || !RegExp(r'^\d{4}$').hasMatch(ticketNumber)) {
      setState(() => _errorMessage = 'Please pick all 4 digits');
      return;
    }

    if (_reserved.contains(ticketNumber)) {
      setState(() => _errorMessage = 'This number is already taken for this draw');
      return;
    }

    if (widget.price > widget.balance) {
      setState(() => _errorMessage =
          'Insufficient balance — you have ₹${widget.balance.toStringAsFixed(0)}');
      return;
    }

    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      await ApiClient().dio.post(
        '/api/betting/lottery/daily/buy',
        data: {
          'draw_id': widget.draw['id'],
          'ticket_number': ticketNumber,
        },
      );

      if (!mounted) return;

      SoundService.instance.play(Sfx.win);
      HapticFeedback.heavyImpact();

      if (!mounted) return;
      Navigator.pop(context);
      widget.onPurchased();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Ticket "$ticketNumber" purchased! Good luck 🍀'),
        backgroundColor: AppColors.green,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ));
    } catch (e) {
      if (!mounted) return;

      String errorMsg = 'Purchase failed — please try again';
      if (e is Exception) {
        final errorStr = e.toString();
        if (errorStr.contains('Insufficient balance')) {
          errorMsg = 'Insufficient wallet balance';
        } else if (errorStr.contains('invalid_ticket')) {
          errorMsg = 'Ticket already purchased';
        } else if (errorStr.contains('draw_not_active')) {
          errorMsg = 'Draw is no longer active';
        }
      }

      setState(() {
        _loading = false;
        _errorMessage = errorMsg;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
          color: Color(0xFF0D1117),
          borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
          boxShadow: [
            BoxShadow(color: Colors.black54, blurRadius: 20, spreadRadius: 5)
          ]),
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Align(
              alignment: Alignment.center,
              child: Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(top: 8, bottom: 18),
                decoration: BoxDecoration(
                    color: AppColors.border,
                    borderRadius: BorderRadius.circular(2)),
              ),
            ),
            Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF0D9488), Color(0xFF064E45)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.confirmation_num_rounded,
                      color: Colors.white, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(widget.draw['name'] ?? 'Daily Lottery',
                            style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w900,
                                color: Colors.white)),
                        Text(
                            '₹${widget.price.toStringAsFixed(0)} per ticket · 4-digit number',
                            style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 11,
                                fontWeight: FontWeight.w600)),
                      ]),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppColors.gold.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                        color: AppColors.gold.withValues(alpha: 0.25)),
                  ),
                  child: Column(children: [
                    Text('Balance',
                        style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.55),
                            fontSize: 9,
                            fontWeight: FontWeight.bold)),
                    Text('₹${widget.balance.toStringAsFixed(0)}',
                        style: const TextStyle(
                            color: AppColors.gold,
                            fontWeight: FontWeight.bold,
                            fontSize: 12)),
                  ]),
                ),
              ],
            ),
            const SizedBox(height: 20),
            const Divider(color: AppColors.border, height: 1),
            const SizedBox(height: 16),

            Row(
              children: [
                const Icon(Icons.info_outline_rounded,
                    size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 5),
                Text(
                    '${_reserved.length} / $_totalNumbers numbers taken for this draw',
                    style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 12,
                        fontWeight: FontWeight.w600)),
              ],
            ),
            const SizedBox(height: 18),

            const Text("Pick Your 4-Digit Number",
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),

            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(children: [
                  for (var i = 0; i < 4; i++) ...[
                    _digitBox(i),
                    if (i < 3) const SizedBox(width: 8),
                  ],
                ]),
                OutlinedButton.icon(
                  onPressed: _loading ? null : _quickPick,
                  icon: const Text('🎲', style: TextStyle(fontSize: 16)),
                  label: const Text('Quick Pick'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.gold,
                    side: const BorderSide(color: AppColors.gold),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
                "Numbers are exclusive — first to buy a number reserves it for this draw.",
                style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11,
                    fontWeight: FontWeight.w500)),

            if (_errorMessage != null) ...[
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.red.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(10),
                  border:
                      Border.all(color: AppColors.red.withValues(alpha: 0.3)),
                ),
                child: Row(children: [
                  const Icon(Icons.error_outline_rounded,
                      color: AppColors.red, size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                      child: Text(_errorMessage!,
                          style: const TextStyle(
                              color: AppColors.red,
                              fontSize: 12.5,
                              fontWeight: FontWeight.bold))),
                ]),
              ),
            ],
            const SizedBox(height: 24),

            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('1 ticket',
                          style: TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 11,
                              fontWeight: FontWeight.bold)),
                      Text('₹${widget.price.toStringAsFixed(0)}',
                          style: const TextStyle(
                              fontWeight: FontWeight.w900,
                              fontSize: 20,
                              color: AppColors.goldLight)),
                    ],
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _loading ? null : _buy,
                      style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.gold,
                          foregroundColor: Colors.black,
                          disabledBackgroundColor: AppColors.border,
                          disabledForegroundColor: AppColors.textSecondary,
                          minimumSize: const Size.fromHeight(50),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12)),
                          textStyle: const TextStyle(
                              fontWeight: FontWeight.w900, fontSize: 15),
                          elevation: 0),
                      child: _loading
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2.5, color: Colors.black))
                          : const Text('Confirm Purchase'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _digitBox(int index) {
    return SizedBox(
      width: 56,
      height: 64,
      child: TextField(
        controller: _digitControllers[index],
        focusNode: _focusNodes[index],
        textAlign: TextAlign.center,
        keyboardType: TextInputType.number,
        maxLength: 1,
        style: const TextStyle(
            color: Colors.white, fontSize: 26, fontWeight: FontWeight.w900),
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        decoration: InputDecoration(
          counterText: '',
          filled: true,
          fillColor: Colors.black.withValues(alpha: 0.3),
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: AppColors.border)),
          focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide:
                  const BorderSide(color: Color(0xFF0D9488), width: 1.8)),
        ),
        onTap: () => _digitControllers[index].selection = TextSelection(
            baseOffset: 0, extentOffset: _digitControllers[index].text.length),
        onChanged: (val) {
          setState(() => _errorMessage = null);
          if (val.isNotEmpty && index < 3) {
            _focusNodes[index + 1].requestFocus();
          } else if (val.isEmpty && index > 0) {
            _focusNodes[index - 1].requestFocus();
          }
        },
      ),
    );
  }

  @override
  void dispose() {
    for (var controller in _digitControllers) {
      controller.dispose();
    }
    for (var node in _focusNodes) {
      node.dispose();
    }
    super.dispose();
  }
}
