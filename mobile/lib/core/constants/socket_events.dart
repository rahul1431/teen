class SocketEvents {
  // Client → Server
  static const String joinMatchmaking = 'join_matchmaking';
  static const String leaveMatchmaking = 'leave_matchmaking';
  static const String gameAction = 'game:action';
  static const String joinRoom = 'join_room';
  static const String roomChat = 'room:chat';
  static const String ping = 'ping';

  // Server → Client
  static const String roomJoined = 'room:joined';
  static const String gameStateUpdate = 'game:state_update';
  static const String gameYourTurn = 'game:your_turn';
  static const String gameResult = 'game:result';
  static const String gameActionReceived = 'game:action_received';
  static const String matchmakingJoined = 'matchmaking:joined';
  static const String walletUpdated = 'wallet:updated';
  static const String roomChatMsg = 'room:chat';
  static const String errorEvent = 'error';

  // Config reload
  static const String configVersion = 'config:version';
  static const String configReload = 'config:reload';

  // Aviator specific
  static const String aviatorPlaceBet = 'aviator:place_bet';
  static const String aviatorCashout = 'aviator:cashout';
  static const String aviatorRoundStart = 'aviator:round_start';
  static const String aviatorFlyingStart = 'aviator:flying_start';
  static const String aviatorMultiplierTick = 'aviator:multiplier_tick';
  static const String aviatorCrashed = 'aviator:crashed';
  static const String aviatorBetPlaced = 'aviator:bet_placed';
  static const String aviatorCashedOut = 'aviator:cashed_out';
  static const String aviatorLiveBets = 'aviator:live_bets';
  static const String aviatorRoundState = 'aviator:round_state';
  static const String aviatorGetHistory = 'aviator:get_history';
  static const String aviatorMyHistory = 'aviator:my_history';
  static const String aviatorMaintenance = 'aviator:maintenance';
}
