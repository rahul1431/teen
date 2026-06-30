import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';

/// Ludo entry screen — mirrors the Teen Patti modes layout.
/// Quick Match (online), Practice (offline vs bots), Friends (private room),
/// plus a Rules sheet.
class LudoModesPage extends StatefulWidget {
  const LudoModesPage({super.key});
  @override
  State<LudoModesPage> createState() => _LudoModesPageState();
}

class _LudoModesPageState extends State<LudoModesPage> {
  String? _balance;

  @override
  void initState() {
    super.initState();
    _loadBalance();
  }

  Future<void> _loadBalance() async {
    try {
      final res = await ApiClient().dio.get('/api/wallet/balance');
      if (!mounted) return;
      setState(() => _balance =
          double.parse(res.data['real_balance'].toString()).toStringAsFixed(0));
    } catch (_) {/* offline / no auth */}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ludo'),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                decoration: BoxDecoration(
                  color: AppColors.feltDark,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppColors.gold.withOpacity(0.6)),
                ),
                child: Text('₹${_balance ?? '—'}',
                    style: const TextStyle(
                        color: AppColors.gold,
                        fontWeight: FontWeight.bold,
                        fontSize: 13)),
              ),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          // Hero Banner
          Container(
            margin: const EdgeInsets.only(bottom: 20),
            height: 130,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF6B1FE8), Color(0xFF2A1A8E), Color(0xFF0E1640)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(20),
              boxShadow: [
                BoxShadow(
                    color: const Color(0xFF6B1FE8).withOpacity(0.4),
                    blurRadius: 20,
                    offset: const Offset(0, 6))
              ],
            ),
            child: Stack(
              children: [
                // Subtle pattern
                Positioned.fill(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(20),
                    child: CustomPaint(painter: _HeroDotsPainter()),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(20),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'LUDO',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 32,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 4,
                                shadows: [Shadow(color: Colors.black38, blurRadius: 8)],
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Roll · Race · Capture · Win',
                              style: TextStyle(
                                color: Colors.white.withOpacity(0.8),
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                      // Dice emoji cluster
                      Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: const [
                          Text('🎲', style: TextStyle(fontSize: 42)),
                          SizedBox(height: 4),
                          Text('🏆', style: TextStyle(fontSize: 24)),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 14,
            crossAxisSpacing: 14,
            childAspectRatio: 0.92,
            children: [
              _modeCard(
                title: 'Quick Match',
                subtitle: 'Online · win cash',
                icon: Icons.bolt_rounded,
                gradient: AppColors.ludoGrad,
                onTap: () {
                  SoundService.instance.play(Sfx.buttonTap);
                  context.push('/games/ludo/lobby');
                },
              ),
              _modeCard(
                title: 'Practice',
                subtitle: 'Offline vs bots · free',
                icon: Icons.smart_toy_rounded,
                gradient: AppColors.variationsGrad,
                onTap: () {
                  SoundService.instance.play(Sfx.buttonTap);
                  context.push('/games/ludo/practice');
                },
              ),
              _modeCard(
                title: 'Friends',
                subtitle: 'Private room',
                icon: Icons.group_rounded,
                gradient: AppColors.aviatorGrad,
                onTap: () {
                  SoundService.instance.play(Sfx.buttonTap);
                  _friendsSheet();
                },
              ),
              _modeCard(
                title: 'How to Play',
                subtitle: 'Rules & tips',
                icon: Icons.menu_book_rounded,
                gradient: AppColors.premiumGrad,
                onTap: () {
                  SoundService.instance.play(Sfx.buttonTap);
                  _rulesSheet();
                },
              ),
            ],
          ),
        ],
      ),
    );
  }

  // --- Friends: create or join a private room by code ---
  void _friendsSheet() {
    final codeCtrl = TextEditingController();
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Play with Friends',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
            const SizedBox(height: 6),
            const Text('Create a private room and share the code, or join one.',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: () {
                Navigator.pop(ctx);
                context.push('/games/ludo/lobby?private=create');
              },
              icon: const Icon(Icons.add_circle_outline_rounded),
              label: const Text('Create Private Room'),
              style: ElevatedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48)),
            ),
            const SizedBox(height: 14),
            const Row(children: [
              Expanded(child: Divider(color: AppColors.border)),
              Padding(
                  padding: EdgeInsets.symmetric(horizontal: 10),
                  child: Text('OR', style: TextStyle(color: AppColors.textSecondary))),
              Expanded(child: Divider(color: AppColors.border)),
            ]),
            const SizedBox(height: 14),
            TextField(
              controller: codeCtrl,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                  labelText: 'Room code', hintText: 'e.g. 4F9K2'),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () {
                final code = codeCtrl.text.trim().toUpperCase();
                if (code.isEmpty) return;
                Navigator.pop(ctx);
                context.push('/games/ludo/lobby?private=join&code=$code');
              },
              icon: const Icon(Icons.login_rounded),
              label: const Text('Join Room'),
              style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48)),
            ),
          ],
        ),
      ),
    );
  }

  void _rulesSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        builder: (_, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.all(22),
          children: const [
            Text('How to Play Ludo',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
            SizedBox(height: 14),
            _Rule('🎯', 'Goal',
                'Be the first to move all 4 of your tokens around the board and into your home.'),
            _Rule('🎲', 'Open a token',
                'Roll a 6 to move a token out of your base onto the track.'),
            _Rule('➡️', 'Move',
                'Each roll moves a chosen token that many steps. You must land exactly on home — overshoots are not allowed.'),
            _Rule('⭐', 'Safe cells',
                'Star and coloured start squares are safe — tokens there can\'t be captured.'),
            _Rule('⚔️', 'Capture',
                'Land on a single opponent token (off a safe cell) to send it back to base.'),
            _Rule('🔁', 'Extra turn',
                'Rolling a 6, capturing a token, or sending one home earns another roll. Three 6s in a row forfeits the turn.'),
            _Rule('🏆', 'Win',
                'First player to bring all 4 tokens home wins the pot (minus a small platform fee).'),
          ],
        ),
      ),
    );
  }

  Widget _modeCard({
    required String title,
    required String subtitle,
    required IconData icon,
    required List<Color> gradient,
    required VoidCallback onTap,
  }) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: gradient),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.gold.withOpacity(0.5), width: 1.5),
            boxShadow: [
              BoxShadow(
                  color: gradient.last.withOpacity(0.5),
                  blurRadius: 16,
                  offset: const Offset(0, 6)),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                      color: Colors.black26,
                      borderRadius: BorderRadius.circular(14)),
                  child: Icon(icon, color: Colors.white.withOpacity(0.9), size: 28),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                            color: Colors.white,
                            shadows: [Shadow(color: Colors.black38, blurRadius: 4)])),
                    const SizedBox(height: 2),
                    Text(subtitle,
                        style: TextStyle(
                            fontSize: 11, color: Colors.white.withOpacity(0.85))),
                  ],
                ),
              ],
            ),
          ),
        ),
      );
}

class _HeroDotsPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()..color = Colors.white.withOpacity(0.05);
    for (var x = 0.0; x < size.width; x += 20) {
      for (var y = 0.0; y < size.height; y += 20) {
        canvas.drawCircle(Offset(x, y), 1.5, p);
      }
    }
    // Diagonal stripe overlay
    final sp = Paint()
      ..color = Colors.white.withOpacity(0.03)
      ..strokeWidth = 8;
    for (var i = -size.height.toInt(); i < size.width.toInt(); i += 30) {
      canvas.drawLine(
        Offset(i.toDouble(), 0),
        Offset(i + size.height, size.height),
        sp,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _Rule extends StatelessWidget {
  final String emoji;
  final String title;
  final String body;
  const _Rule(this.emoji, this.title, this.body);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(emoji, style: const TextStyle(fontSize: 22)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                          fontWeight: FontWeight.w800, fontSize: 15)),
                  const SizedBox(height: 2),
                  Text(body,
                      style: const TextStyle(
                          color: AppColors.textSecondary, fontSize: 13, height: 1.35)),
                ],
              ),
            ),
          ],
        ),
      );
}
