double _asDouble(dynamic v) => double.tryParse(v?.toString() ?? '') ?? 0;
int _asInt(dynamic v) => int.tryParse(v?.toString() ?? '') ?? 0;
String _asString(dynamic v, [String fallback = '']) => v?.toString() ?? fallback;

class LiveScore {
  final int? runs;
  final int? wickets;
  final String? overs;
  final String? description;
  final Map<String, dynamic> raw;

  const LiveScore({this.runs, this.wickets, this.overs, this.description, this.raw = const {}});

  bool get hasScore => runs != null;

  factory LiveScore.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const LiveScore();
    return LiveScore(
      runs: json.containsKey('runs') ? _asInt(json['runs']) : null,
      wickets: json.containsKey('wickets') ? _asInt(json['wickets']) : null,
      overs: json['overs']?.toString(),
      description: json['description']?.toString(),
      raw: json,
    );
  }
}

class OddsMarketOption {
  final String key;
  final String label;
  final double odds;

  const OddsMarketOption({required this.key, required this.label, required this.odds});

  factory OddsMarketOption.fromJson(Map<String, dynamic> json) => OddsMarketOption(
        key: _asString(json['key']),
        label: _asString(json['label']),
        odds: _asDouble(json['odds']),
      );
}

class OddsMarket {
  final String id;
  final String matchId;
  final String marketType;
  final String label;
  final List<OddsMarketOption> options;
  final String status;

  const OddsMarket({
    required this.id,
    required this.matchId,
    required this.marketType,
    required this.label,
    required this.options,
    required this.status,
  });

  factory OddsMarket.fromJson(Map<String, dynamic> json) {
    final optionsJson = (json['options'] as List? ?? []).cast<Map<String, dynamic>>();
    return OddsMarket(
      id: _asString(json['id']),
      matchId: _asString(json['match_id']),
      marketType: _asString(json['market_type']),
      label: _asString(json['label']),
      options: optionsJson.map(OddsMarketOption.fromJson).toList(),
      status: _asString(json['status']),
    );
  }
}

class CricketMatch {
  final String id;
  final String series;
  final String format;
  final String teamA;
  final String teamB;
  final String teamAShort;
  final String teamBShort;
  final String? teamAFlag;
  final String? teamBFlag;
  final String status;
  final String startTime;
  final LiveScore liveScore;
  final List<OddsMarket> markets;

  const CricketMatch({
    required this.id,
    required this.series,
    required this.format,
    required this.teamA,
    required this.teamB,
    required this.teamAShort,
    required this.teamBShort,
    this.teamAFlag,
    this.teamBFlag,
    required this.status,
    required this.startTime,
    required this.liveScore,
    required this.markets,
  });

  bool get isLive => status == 'live';

  factory CricketMatch.fromJson(Map<String, dynamic> json) => CricketMatch(
        id: _asString(json['id']),
        series: _asString(json['series'], 'Tournament Series'),
        format: _asString(json['format'], 't20'),
        teamA: _asString(json['team_a'], 'Team A'),
        teamB: _asString(json['team_b'], 'Team B'),
        teamAShort: _asString(json['team_a_short'], 'TMA'),
        teamBShort: _asString(json['team_b_short'], 'TMB'),
        teamAFlag: json['team_a_flag']?.toString(),
        teamBFlag: json['team_b_flag']?.toString(),
        status: _asString(json['status'], 'upcoming'),
        startTime: _asString(json['start_time']),
        liveScore: LiveScore.fromJson(json['live_score'] as Map<String, dynamic>?),
        markets: ((json['markets'] as List?) ?? []).cast<Map<String, dynamic>>().map(OddsMarket.fromJson).toList(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'series': series,
        'format': format,
        'team_a': teamA,
        'team_b': teamB,
        'team_a_short': teamAShort,
        'team_b_short': teamBShort,
        'team_a_flag': teamAFlag,
        'team_b_flag': teamBFlag,
        'status': status,
        'start_time': startTime,
        'live_score': liveScore.raw,
      };
}

class OddsBetRecord {
  final String id;
  final String teamA;
  final String teamB;
  final String marketLabel;
  final String optionLabel;
  final double odds;
  final double amount;
  final double payout;
  final String status;
  final String createdAt;

  const OddsBetRecord({
    required this.id,
    required this.teamA,
    required this.teamB,
    required this.marketLabel,
    required this.optionLabel,
    required this.odds,
    required this.amount,
    required this.payout,
    required this.status,
    required this.createdAt,
  });

  factory OddsBetRecord.fromJson(Map<String, dynamic> json) => OddsBetRecord(
        id: _asString(json['id']),
        teamA: _asString(json['team_a']),
        teamB: _asString(json['team_b']),
        marketLabel: _asString(json['market_label']),
        optionLabel: _asString(json['option_label']),
        odds: _asDouble(json['odds']),
        amount: _asDouble(json['amount']),
        payout: _asDouble(json['payout']),
        status: _asString(json['status']),
        createdAt: _asString(json['created_at']),
      );
}

class SessionMarket {
  final String id;
  final String label;
  final String status;
  final double oddsYes;
  final double oddsNo;
  final int minRuns;
  final int maxRuns;

  const SessionMarket({
    required this.id,
    required this.label,
    required this.status,
    required this.oddsYes,
    required this.oddsNo,
    required this.minRuns,
    required this.maxRuns,
  });

  factory SessionMarket.fromJson(Map<String, dynamic> json) => SessionMarket(
        id: _asString(json['id']),
        label: _asString(json['label']),
        status: _asString(json['status']),
        oddsYes: _asDouble(json['odds_yes']),
        oddsNo: _asDouble(json['odds_no']),
        minRuns: _asInt(json['min_runs']),
        maxRuns: _asInt(json['max_runs']),
      );
}

class LiveMatchData {
  final CricketMatch match;
  final List<SessionMarket> sessions;

  const LiveMatchData({required this.match, required this.sessions});

  factory LiveMatchData.fromJson(Map<String, dynamic> json, CricketMatch fallbackMatch) {
    final matchJson = json['match'] as Map<String, dynamic>?;
    final sessions = ((json['sessions'] as List?) ?? [])
        .cast<Map<String, dynamic>>()
        .map(SessionMarket.fromJson)
        .toList();
    return LiveMatchData(
      match: matchJson != null ? CricketMatch.fromJson(matchJson) : fallbackMatch,
      sessions: sessions,
    );
  }
}

class SessionBetRecord {
  final String teamA;
  final String teamB;
  final String sessionLabel;
  final String selection;
  final int runsBracket;
  final double amount;
  final double payout;
  final String status;

  const SessionBetRecord({
    required this.teamA,
    required this.teamB,
    required this.sessionLabel,
    required this.selection,
    required this.runsBracket,
    required this.amount,
    required this.payout,
    required this.status,
  });

  factory SessionBetRecord.fromJson(Map<String, dynamic> json) => SessionBetRecord(
        teamA: _asString(json['team_a']),
        teamB: _asString(json['team_b']),
        sessionLabel: _asString(json['session_label']),
        selection: _asString(json['selection']),
        runsBracket: _asInt(json['runs_bracket']),
        amount: _asDouble(json['amount']),
        payout: _asDouble(json['payout']),
        status: _asString(json['status'], 'pending'),
      );
}
