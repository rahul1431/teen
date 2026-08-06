import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../shared/theme/app_theme.dart';

class MatchmakingPlayer {
  final String userId;
  final String username;
  final String? avatarUrl;

  const MatchmakingPlayer({
    required this.userId,
    required this.username,
    this.avatarUrl,
  });
}

class MatchmakingWaitingDialog extends StatefulWidget {
  final String gameTitle;
  final String? variationLabel;
  final double stake;
  final int maxSeats;
  final List<Color>? gradientColors;
  final MatchmakingPlayer currentPlayer;
  final List<MatchmakingPlayer> joinedPlayers;
  final VoidCallback onCancel;
  final VoidCallback? onTimeout;

  const MatchmakingWaitingDialog({
    super.key,
    required this.gameTitle,
    this.variationLabel,
    required this.stake,
    this.maxSeats = 6,
    this.gradientColors,
    required this.currentPlayer,
    this.joinedPlayers = const [],
    required this.onCancel,
    this.onTimeout,
  });

  static Future<T?> show<T>({
    required BuildContext context,
    required String gameTitle,
    String? variationLabel,
    required double stake,
    int maxSeats = 6,
    List<Color>? gradientColors,
    required MatchmakingPlayer currentPlayer,
    List<MatchmakingPlayer> joinedPlayers = const [],
    required VoidCallback onCancel,
    VoidCallback? onTimeout,
  }) {
    return showModalBottomSheet<T>(
      context: context,
      isDismissible: false,
      enableDrag: false,
      backgroundColor: Colors.transparent,
      builder: (ctx) => MatchmakingWaitingDialog(
        gameTitle: gameTitle,
        variationLabel: variationLabel,
        stake: stake,
        maxSeats: maxSeats,
        gradientColors: gradientColors,
        currentPlayer: currentPlayer,
        joinedPlayers: joinedPlayers,
        onCancel: onCancel,
        onTimeout: onTimeout,
      ),
    );
  }

  @override
  State<MatchmakingWaitingDialog> createState() => _MatchmakingWaitingDialogState();
}

class _MatchmakingWaitingDialogState extends State<MatchmakingWaitingDialog>
    with SingleTickerProviderStateMixin {
  late Timer _countdownTimer;
  int _secondsRemaining = 60;
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);

    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_secondsRemaining > 0) {
        setState(() {
          _secondsRemaining--;
        });
      } else {
        _countdownTimer.cancel();
        widget.onTimeout?.call();
      }
    });
  }

  @override
  void dispose() {
    _countdownTimer.cancel();
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final themeGradient = widget.gradientColors ?? AppColors.teenPattiGrad;
    final allPlayers = <MatchmakingPlayer>[
      widget.currentPlayer,
      ...widget.joinedPlayers.where((p) => p.userId != widget.currentPlayer.userId),
    ];

    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      decoration: BoxDecoration(
        color: const Color(0xFF141824),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.4), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.8),
            blurRadius: 24,
            spreadRadius: 4,
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle pill
          Container(
            width: 42,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.25),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 18),

          // Header
          Text(
            'Finding Players for ${widget.gameTitle}${widget.variationLabel != null ? " (${widget.variationLabel})" : ""}',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w900,
              color: Colors.white,
              letterSpacing: 0.3,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Stake: ₹${widget.stake.toInt()} • Table Size: ${widget.maxSeats} Players',
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 20),

          // 60s Countdown Timer Ring
          Stack(
            alignment: Alignment.center,
            children: [
              SizedBox(
                width: 90,
                height: 90,
                child: CircularProgressIndicator(
                  value: _secondsRemaining / 60.0,
                  strokeWidth: 6,
                  backgroundColor: Colors.white.withValues(alpha: 0.1),
                  valueColor: AlwaysStoppedAnimation<Color>(
                    _secondsRemaining <= 10 ? AppColors.red : AppColors.gold,
                  ),
                ),
              ),
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    '${_secondsRemaining}s',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                      color: _secondsRemaining <= 10 ? AppColors.red : AppColors.gold,
                    ),
                  ),
                  const Text(
                    'WAITING',
                    style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.0,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Seats Joined Status Title
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'PLAYERS JOINED (${allPlayers.length}/${widget.maxSeats})',
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.0,
                  color: AppColors.textSecondary,
                ),
              ),
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: AppColors.green,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 6),
                  const Text(
                    'Live Queue',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: AppColors.green,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 14),

          // Player Seats Grid
          Wrap(
            spacing: 12,
            runSpacing: 12,
            alignment: WrapAlignment.center,
            children: List.generate(widget.maxSeats, (index) {
              final isFilled = index < allPlayers.length;
              final player = isFilled ? allPlayers[index] : null;
              final isSelf = isFilled && player?.userId == widget.currentPlayer.userId;

              return AnimatedBuilder(
                animation: _pulseController,
                builder: (context, child) {
                  return Container(
                    width: widget.maxSeats > 4 ? 90 : 130,
                    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
                    decoration: BoxDecoration(
                      color: isFilled
                          ? (isSelf
                              ? themeGradient.first.withValues(alpha: 0.4)
                              : AppColors.surface)
                          : Colors.black.withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: isFilled
                            ? (isSelf ? AppColors.gold : AppColors.gold.withValues(alpha: 0.5))
                            : AppColors.gold.withValues(alpha: 0.15 + _pulseController.value * 0.2),
                        width: isSelf ? 1.8 : 1.2,
                      ),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        CircleAvatar(
                          radius: 20,
                          backgroundColor: isFilled
                              ? (isSelf ? AppColors.gold : AppColors.cardBg)
                              : Colors.white.withValues(alpha: 0.06),
                          child: isFilled
                              ? Text(
                                  (player?.username ?? 'P')[0].toUpperCase(),
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    color: isSelf ? Colors.black : AppColors.gold,
                                    fontSize: 16,
                                  ),
                                )
                              : Icon(
                                  Icons.person_outline_rounded,
                                  color: Colors.white.withValues(alpha: 0.3),
                                  size: 20,
                                ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          isFilled
                              ? (isSelf ? 'You' : player!.username)
                              : 'Waiting…',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 11.5,
                            fontWeight: isFilled ? FontWeight.bold : FontWeight.w500,
                            color: isFilled
                                ? (isSelf ? AppColors.gold : Colors.white)
                                : AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  );
                },
              );
            }),
          ),
          const SizedBox(height: 26),

          // Cancel button
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: widget.onCancel,
              icon: const Icon(Icons.close_rounded, color: AppColors.red, size: 18),
              label: const Text(
                'Cancel Search',
                style: TextStyle(
                  color: AppColors.red,
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                ),
              ),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppColors.red, width: 1.2),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
