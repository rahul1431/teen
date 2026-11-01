class AgentProfile {
  final String id;
  final String username;
  final String displayName;
  final String? phone;
  final String? email;
  final String? avatarUrl;
  final double commissionRate;
  final Map<String, dynamic> gameCommissions;
  final String referralCode;
  final String? parentAgentId;
  final double balance;
  final double lockedBalance;
  final double totalEarned;
  final double totalPaidOut;
  final int playerCount;
  final String kycStatus;
  final Map<String, dynamic> kycData;
  final Map<String, dynamic> bankDetails;
  final List<SubAgentItem> subAgents;

  AgentProfile({
    required this.id,
    required this.username,
    required this.displayName,
    this.phone,
    this.email,
    this.avatarUrl,
    required this.commissionRate,
    required this.gameCommissions,
    required this.referralCode,
    this.parentAgentId,
    required this.balance,
    required this.lockedBalance,
    required this.totalEarned,
    required this.totalPaidOut,
    required this.playerCount,
    required this.kycStatus,
    required this.kycData,
    required this.bankDetails,
    required this.subAgents,
  });

  factory AgentProfile.fromJson(Map<String, dynamic> json) {
    final agent = json['agent'] as Map<String, dynamic>? ?? {};
    final wallet = json['wallet'] as Map<String, dynamic>? ?? {};
    final subs = (json['sub_agents'] as List<dynamic>? ?? [])
        .map((s) => SubAgentItem.fromJson(s as Map<String, dynamic>))
        .toList();

    return AgentProfile(
      id: agent['id'] ?? '',
      username: agent['username'] ?? '',
      displayName: agent['display_name'] ?? agent['username'] ?? '',
      phone: agent['phone'],
      email: agent['email'],
      avatarUrl: agent['avatar_url'],
      commissionRate: (agent['commission_rate'] as num?)?.toDouble() ?? 5.0,
      gameCommissions: (agent['game_commissions'] as Map<String, dynamic>?) ?? {},
      referralCode: agent['referral_code'] ?? '',
      parentAgentId: agent['parent_agent_id'],
      balance: (wallet['balance'] as num?)?.toDouble() ?? 0.0,
      lockedBalance: (wallet['locked_balance'] as num?)?.toDouble() ?? 0.0,
      totalEarned: (wallet['total_earned'] as num?)?.toDouble() ?? 0.0,
      totalPaidOut: (wallet['total_paid_out'] as num?)?.toDouble() ?? 0.0,
      playerCount: (json['player_count'] as num?)?.toInt() ?? 0,
      kycStatus: agent['kyc_status'] ?? 'pending',
      kycData: (agent['kyc_data'] as Map<String, dynamic>?) ?? {},
      bankDetails: (agent['bank_details'] as Map<String, dynamic>?) ?? {},
      subAgents: subs,
    );
  }
}

class ReferralAnalytics {
  final int totalClicks;
  final int uniqueVisitors;
  final int totalSignups;
  final int totalFtds;
  final double totalFtdAmount;
  final double totalDeposits;
  final int totalBetters;
  final double totalTurnover;
  final double netGgr;
  final double clickToSignupRate;
  final double signupToFtdRate;
  final double overallConversionRate;
  final List<Map<String, dynamic>> sources;
  final List<Map<String, dynamic>> devices;
  final List<Map<String, dynamic>> dailySeries;

  ReferralAnalytics({
    required this.totalClicks,
    required this.uniqueVisitors,
    required this.totalSignups,
    required this.totalFtds,
    required this.totalFtdAmount,
    required this.totalDeposits,
    required this.totalBetters,
    required this.totalTurnover,
    required this.netGgr,
    required this.clickToSignupRate,
    required this.signupToFtdRate,
    required this.overallConversionRate,
    required this.sources,
    required this.devices,
    required this.dailySeries,
  });

  factory ReferralAnalytics.fromJson(Map<String, dynamic> json) {
    return ReferralAnalytics(
      totalClicks: (json['total_clicks'] as num?)?.toInt() ?? 0,
      uniqueVisitors: (json['unique_visitors'] as num?)?.toInt() ?? 0,
      totalSignups: (json['total_signups'] as num?)?.toInt() ?? 0,
      totalFtds: (json['total_ftds'] as num?)?.toInt() ?? 0,
      totalFtdAmount: (json['total_ftd_amount'] as num?)?.toDouble() ?? 0.0,
      totalDeposits: (json['total_deposits'] as num?)?.toDouble() ?? 0.0,
      totalBetters: (json['total_betters'] as num?)?.toInt() ?? 0,
      totalTurnover: (json['total_turnover'] as num?)?.toDouble() ?? 0.0,
      netGgr: (json['net_ggr'] as num?)?.toDouble() ?? 0.0,
      clickToSignupRate: (json['click_to_signup_rate'] as num?)?.toDouble() ?? 0.0,
      signupToFtdRate: (json['signup_to_ftd_rate'] as num?)?.toDouble() ?? 0.0,
      overallConversionRate: (json['overall_conversion_rate'] as num?)?.toDouble() ?? 0.0,
      sources: (json['sources'] as List<dynamic>? ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList(),
      devices: (json['devices'] as List<dynamic>? ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList(),
      dailySeries: (json['daily_series'] as List<dynamic>? ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList(),
    );
  }
}

class SubAgentItem {
  final String id;
  final String username;
  final String displayName;
  final String? phone;
  final double commissionRate;
  final double balance;
  final double totalEarned;
  final int playerCount;
  final String status;

  SubAgentItem({
    required this.id,
    required this.username,
    required this.displayName,
    this.phone,
    required this.commissionRate,
    required this.balance,
    required this.totalEarned,
    required this.playerCount,
    required this.status,
  });

  factory SubAgentItem.fromJson(Map<String, dynamic> json) {
    return SubAgentItem(
      id: json['id'] ?? '',
      username: json['username'] ?? '',
      displayName: json['display_name'] ?? json['username'] ?? '',
      phone: json['phone'],
      commissionRate: (json['commission_rate'] as num?)?.toDouble() ?? 5.0,
      balance: (json['balance'] as num?)?.toDouble() ?? 0.0,
      totalEarned: (json['total_earned'] as num?)?.toDouble() ?? 0.0,
      playerCount: (json['player_count'] as num?)?.toInt() ?? 0,
      status: json['status'] ?? 'active',
    );
  }
}

class AgentPlayerItem {
  final String id;
  final String username;
  final String phone;
  final double totalDeposits;
  final double netHouseLoss;
  final int gamesPlayed;
  final String status;
  final DateTime? createdAt;
  final DateTime? lastActiveAt;

  AgentPlayerItem({
    required this.id,
    required this.username,
    required this.phone,
    required this.totalDeposits,
    required this.netHouseLoss,
    required this.gamesPlayed,
    required this.status,
    this.createdAt,
    this.lastActiveAt,
  });

  factory AgentPlayerItem.fromJson(Map<String, dynamic> json) {
    return AgentPlayerItem(
      id: json['id'] ?? '',
      username: json['username'] ?? 'Player',
      phone: json['phone'] ?? '',
      totalDeposits: (json['total_deposited'] as num?)?.toDouble() ?? 0.0,
      netHouseLoss: (json['net_house_win'] as num?)?.toDouble() ?? 0.0,
      gamesPlayed: (json['games_played'] as num?)?.toInt() ?? 0,
      status: json['status'] ?? 'active',
      createdAt: json['created_at'] != null ? DateTime.tryParse(json['created_at']) : null,
      lastActiveAt: json['last_active'] != null ? DateTime.tryParse(json['last_active']) : null,
    );
  }
}

class AgentPayoutItem {
  final String id;
  final double amount;
  final String status;
  final String? reference;
  final int riskScore;
  final List<String> riskFlags;
  final String? requestedAt;
  final String? processedAt;
  final Map<String, dynamic>? metadata;

  AgentPayoutItem({
    required this.id,
    required this.amount,
    required this.status,
    this.reference,
    required this.riskScore,
    required this.riskFlags,
    this.requestedAt,
    this.processedAt,
    this.metadata,
  });

  factory AgentPayoutItem.fromJson(Map<String, dynamic> json) {
    return AgentPayoutItem(
      id: json['id'] ?? '',
      amount: (json['amount'] as num?)?.toDouble() ?? 0.0,
      status: json['status'] ?? 'pending',
      reference: json['reference'],
      riskScore: (json['risk_score'] as num?)?.toInt() ?? 0,
      riskFlags: (json['risk_flags'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
      requestedAt: json['requested_at'],
      processedAt: json['processed_at'],
      metadata: json['metadata'] is Map<String, dynamic> ? json['metadata'] : null,
    );
  }
}

class AgentNotificationItem {
  final String id;
  final String title;
  final String body;
  final String type;
  final bool isRead;
  final DateTime? createdAt;
  final Map<String, dynamic>? metadata;

  AgentNotificationItem({
    required this.id,
    required this.title,
    required this.body,
    required this.type,
    required this.isRead,
    this.createdAt,
    this.metadata,
  });

  factory AgentNotificationItem.fromJson(Map<String, dynamic> json) {
    return AgentNotificationItem(
      id: json['id'] ?? '',
      title: json['title'] ?? '',
      body: json['body'] ?? '',
      type: json['type'] ?? 'info',
      isRead: json['is_read'] == true,
      createdAt: json['created_at'] != null ? DateTime.tryParse(json['created_at']) : null,
      metadata: json['metadata'] is Map<String, dynamic> ? json['metadata'] : null,
    );
  }
}

class LiveCommissionSummary {
  final double directCommission;
  final double overrideCommission;
  final double totalCommission;
  final Map<String, dynamic> gameBreakdown;

  LiveCommissionSummary({
    required this.directCommission,
    required this.overrideCommission,
    required this.totalCommission,
    required this.gameBreakdown,
  });

  factory LiveCommissionSummary.fromJson(Map<String, dynamic> json) {
    final today = json['today'] as Map<String, dynamic>? ?? {};
    return LiveCommissionSummary(
      directCommission: (today['direct_commission'] as num?)?.toDouble() ?? 0.0,
      overrideCommission: (today['override_commission'] as num?)?.toDouble() ?? 0.0,
      totalCommission: (today['total_commission'] as num?)?.toDouble() ?? 0.0,
      gameBreakdown: (today['game_breakdown'] as Map<String, dynamic>?) ?? {},
    );
  }
}
