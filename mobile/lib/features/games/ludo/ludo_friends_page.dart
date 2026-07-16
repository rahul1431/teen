import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../shared/theme/app_theme.dart';

/// Friends table lobby for Ludo — create a private table and share its
/// 6-character code, or join a friend's table with theirs. The host starts
/// once 2-4 friends are seated; no bots join these tables. Mirrors the
/// Teen Patti friends lobby (same server-side `private:*` events, which are
/// game-type agnostic) with Ludo's 4-player cap and routes.
class LudoFriendsPage extends StatefulWidget {
  /// 'create' opens a new table at [stake]; 'join' asks for a code.
  /// [code] (from a shared invite deep link) prefills and auto-joins.
  final String mode;
  final double stake;
  final String? code;
  const LudoFriendsPage(
      {super.key, required this.mode, this.stake = 50, this.code});

  @override
  State<LudoFriendsPage> createState() => _LudoFriendsPageState();
}

class _LudoFriendsPageState extends State<LudoFriendsPage> {
  final _socket = SocketService();
  final _codeCtrl = TextEditingController();

  StreamSubscription? _lobbySub;
  StreamSubscription? _closedSub;
  StreamSubscription? _roomJoinedSub;
  StreamSubscription? _errorSub;

  String? _myUserId;
  Map<String, dynamic>? _lobby; // null = not in a table yet
  bool _busy = false;
  bool _enteringGame = false; // suppress private:leave when moving to the table

  bool get _isHost => _lobby?['host_id']?.toString() == _myUserId;
  String get _code => _lobby?['code']?.toString() ?? '';
  List<Map<String, dynamic>> get _players =>
      ((_lobby?['players'] as List?) ?? []).cast<Map<String, dynamic>>();

  @override
  void initState() {
    super.initState();
    _socket.connect();
    _init();
  }

  Future<void> _init() async {
    _myUserId = await SecureStorage.getUserId();

    _lobbySub = _socket.on('private:lobby').listen((data) {
      if (!mounted || data is! Map) return;
      // The private:* events are shared across games; ignore lobbies that
      // aren't for Ludo so a stray Teen Patti table can't hijack this page.
      if (data['game_type'] != null && data['game_type'] != 'ludo') return;
      setState(() {
        _lobby = Map<String, dynamic>.from(data);
        _busy = false;
      });
    });

    _closedSub = _socket.on('private:closed').listen((data) {
      if (!mounted) return;
      final reason =
          (data is Map ? data['reason']?.toString() : null) ?? 'Table closed';
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(reason), backgroundColor: AppColors.red));
      setState(() => _lobby = null);
    });

    // Host pressed Start → the server starts the game and pushes room:joined
    // to everyone.
    _roomJoinedSub = _socket.on(SocketEvents.roomJoined).listen((data) {
      if (!mounted || data is! Map) return;
      if (data['game_type'] != null && data['game_type'] != 'ludo') return;
      _roomJoinedSub?.cancel();
      _roomJoinedSub = null;
      _enteringGame = true;
      context.pushReplacement('/games/ludo/play/${data['room_id']}',
          extra: Map<String, dynamic>.from(data));
    });

    _errorSub = _socket.on(SocketEvents.errorEvent).listen((data) {
      if (!mounted) return;
      setState(() => _busy = false);
      final msg = (data is Map ? data['message'] as String? : null) ??
          'Something went wrong';
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), backgroundColor: AppColors.red));
    });

    // On a cold start (invite deep link) the socket is still connecting and
    // emit() drops messages — wait for the connection before create/join.
    await _waitForSocket();
    if (!mounted) return;

    if (widget.mode == 'create') {
      _createTable();
    } else if (widget.code != null && widget.code!.length == 6) {
      _codeCtrl.text = widget.code!.toUpperCase();
      _joinTable();
    }
  }

  Future<void> _waitForSocket() async {
    for (var i = 0; i < 40 && !_socket.isConnected; i++) {
      await Future.delayed(const Duration(milliseconds: 250));
    }
  }

  @override
  void dispose() {
    // Leaving the page abandons the lobby (host leaving hands off or closes
    // the table) — unless we're moving to the game table for a hand.
    if (_lobby != null && !_enteringGame) {
      _socket.emit('private:leave', {'code': _code});
    }
    _lobbySub?.cancel();
    _closedSub?.cancel();
    _roomJoinedSub?.cancel();
    _errorSub?.cancel();
    _codeCtrl.dispose();
    super.dispose();
  }

  Future<void> _createTable() async {
    setState(() => _busy = true);
    await _waitForSocket();
    _socket.emit('private:create', {'game_type': 'ludo', 'stake': widget.stake});
  }

  Future<void> _joinTable() async {
    final code = _codeCtrl.text.trim().toUpperCase();
    if (code.length != 6) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Enter the 6-character table code'),
          backgroundColor: AppColors.orange));
      return;
    }
    setState(() => _busy = true);
    await _waitForSocket();
    _socket.emit('private:join', {'code': code});
  }

  void _startGame() {
    setState(() => _busy = true);
    _socket.emit('private:start', {'code': _code});
  }

  void _copyCode() {
    Clipboard.setData(ClipboardData(text: _code));
    HapticFeedback.selectionClick();
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Code copied — share it with your friends!'),
        duration: Duration(seconds: 2)));
  }

  void _shareCode() {
    final stake = (_lobby?['stake'] as num?)?.toInt() ?? widget.stake.toInt();
    HapticFeedback.selectionClick();
    Share.share(
      '🎲 Join my Ludo table on MyOnlineJoker!\n'
      'Table code: $_code · Entry ₹$stake\n'
      'Tap to join: https://game.myonlinejoker.com/table/?code=$_code',
      subject: 'Ludo — join my table',
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Play with Friends 👥')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: _lobby == null ? _buildEntry() : _buildLobby(),
      ),
    );
  }

  // Before a table exists: joining flow (create fires automatically).
  Widget _buildEntry() {
    if (widget.mode == 'create' || _busy) {
      return const Center(
          child: CircularProgressIndicator(color: AppColors.gold));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 24),
        const Text('Enter your friend\'s table code',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 16),
        TextField(
          controller: _codeCtrl,
          autofocus: true,
          textCapitalization: TextCapitalization.characters,
          textAlign: TextAlign.center,
          maxLength: 6,
          style: const TextStyle(
              fontSize: 28, letterSpacing: 8, fontWeight: FontWeight.bold),
          inputFormatters: [
            FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9]')),
          ],
          decoration: InputDecoration(
            counterText: '',
            hintText: 'ABC123',
            hintStyle: TextStyle(
                fontSize: 28,
                letterSpacing: 8,
                color: Colors.white.withValues(alpha: 0.2)),
            filled: true,
            fillColor: AppColors.cardBg,
            border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: const BorderSide(color: AppColors.gold)),
          ),
          onSubmitted: (_) => _joinTable(),
        ),
        const SizedBox(height: 20),
        ElevatedButton.icon(
          onPressed: _busy ? null : _joinTable,
          icon: const Icon(Icons.login_rounded, color: Colors.black),
          label: const Text('Join Table',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.gold,
            padding: const EdgeInsets.symmetric(vertical: 14),
          ),
        ),
      ],
    );
  }

  // In a lobby: code card, seated players, start/waiting footer.
  Widget _buildLobby() {
    final maxPlayers = (_lobby?['max_players'] as num?)?.toInt() ?? 4;
    final stake = (_lobby?['stake'] as num?)?.toDouble() ?? widget.stake;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Code card
        GestureDetector(
          onTap: _copyCode,
          child: Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                  colors: [Color(0xFF2A1A5E), Color(0xFF160E38)]),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.gold, width: 1.5),
            ),
            child: Column(
              children: [
                const Text('TABLE CODE — tap to copy',
                    style: TextStyle(
                        color: AppColors.textSecondary, fontSize: 11)),
                const SizedBox(height: 8),
                Text(_code,
                    style: const TextStyle(
                        color: AppColors.gold,
                        fontSize: 36,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 10)),
                const SizedBox(height: 6),
                Text('Entry ₹${stake.toInt()} · No bots · Max $maxPlayers players',
                    style: const TextStyle(
                        color: AppColors.textSecondary, fontSize: 12)),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _copyCode,
                      icon: const Icon(Icons.copy_rounded,
                          size: 16, color: AppColors.gold),
                      label: const Text('Copy',
                          style:
                              TextStyle(color: AppColors.gold, fontSize: 13)),
                      style: OutlinedButton.styleFrom(
                        side: BorderSide(
                            color: AppColors.gold.withValues(alpha: 0.6)),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 8),
                      ),
                    ),
                    const SizedBox(width: 12),
                    ElevatedButton.icon(
                      onPressed: _shareCode,
                      icon: const Icon(Icons.share_rounded,
                          size: 16, color: Colors.black),
                      label: const Text('Share',
                          style: TextStyle(
                              color: Colors.black,
                              fontSize: 13,
                              fontWeight: FontWeight.bold)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.gold,
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 8),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        Text('Players (${_players.length}/$maxPlayers)',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        Expanded(
          child: ListView.separated(
            itemCount: _players.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (_, i) {
              final p = _players[i];
              final isHost =
                  p['user_id']?.toString() == _lobby?['host_id']?.toString();
              final isMe = p['user_id']?.toString() == _myUserId;
              return Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: AppColors.cardBg,
                  borderRadius: BorderRadius.circular(12),
                  border: isMe
                      ? Border.all(color: AppColors.gold.withValues(alpha: 0.6))
                      : null,
                ),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 16,
                      backgroundColor: AppColors.gold.withValues(alpha: 0.2),
                      child: Text('${i + 1}',
                          style: const TextStyle(
                              color: AppColors.gold, fontSize: 13)),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      '${p['username'] ?? 'Player'}${isMe ? ' (you)' : ''}',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const Spacer(),
                    if (isHost)
                      const Icon(Icons.star_rounded,
                          color: AppColors.gold, size: 18),
                  ],
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 12),
        if (_isHost)
          ElevatedButton.icon(
            onPressed: (_players.length >= 2 && !_busy) ? _startGame : null,
            icon: const Icon(Icons.play_arrow_rounded, color: Colors.black),
            label: Text(
              _players.length >= 2
                  ? 'Start Game (${_players.length} players)'
                  : 'Waiting for friends… (need 2+)',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.gold,
              disabledBackgroundColor: AppColors.cardBg,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
          )
        else
          Container(
            padding: const EdgeInsets.symmetric(vertical: 14),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.cardBg,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Text('Waiting for the host to start…',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
      ],
    );
  }
}
