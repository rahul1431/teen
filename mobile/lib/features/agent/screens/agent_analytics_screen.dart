import 'package:flutter/material.dart';
import '../agent_theme.dart';
import '../models/agent_models.dart';
import '../services/agent_api_service.dart';

class AgentAnalyticsScreen extends StatefulWidget {
  const AgentAnalyticsScreen({super.key});

  @override
  State<AgentAnalyticsScreen> createState() => _AgentAnalyticsScreenState();
}

class _AgentAnalyticsScreenState extends State<AgentAnalyticsScreen> {
  final _api = AgentApiService();
  int _selectedDays = 30;
  bool _isLoading = true;
  String? _error;
  ReferralAnalytics? _analytics;

  @override
  void initState() {
    super.initState();
    _loadAnalytics();
  }

  Future<void> _loadAnalytics() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final res = await _api.getReferralAnalytics(days: _selectedDays);
      if (mounted) {
        setState(() {
          _analytics = res;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString().replaceAll('Exception: ', '');
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AgentTheme.background,
      appBar: AppBar(
        title: const Text('Referral & Funnel Analytics'),
        backgroundColor: AgentTheme.surface,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: AgentTheme.gold),
            onPressed: _loadAnalytics,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadAnalytics,
        color: AgentTheme.gold,
        backgroundColor: AgentTheme.surface,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            child: [
              _buildPeriodSelector(),
              const SizedBox(height: 16),
              if (_isLoading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 60),
                  child: Center(
                    child: CircularProgressIndicator(color: AgentTheme.gold),
                  ),
                )
              else if (_error != null)
                _buildErrorCard()
              else if (_analytics != null) ...[
                _buildFunnelCard(),
                const SizedBox(height: 16),
                _buildConversionRatesCard(),
                const SizedBox(height: 16),
                _buildTrafficSourcesCard(),
                const SizedBox(height: 16),
                _buildDeviceBreakdownCard(),
                const SizedBox(height: 16),
                _buildDailyBreakdownCard(),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPeriodSelector() {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AgentTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Row(
        children: [
          _buildPeriodButton('7 Days', 7),
          _buildPeriodButton('30 Days', 30),
          _buildPeriodButton('90 Days', 90),
        ],
      ),
    );
  }

  Widget _buildPeriodButton(String label, int days) {
    final isSelected = _selectedDays == days;
    return Expanded(
      child: GestureDetector(
        onTap: () {
          if (_selectedDays != days) {
            setState(() => _selectedDays = days);
            _loadAnalytics();
          }
        },
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? AgentTheme.gold : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 13,
              color: isSelected ? Colors.black : AgentTheme.textMuted,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildErrorCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AgentTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AgentTheme.lossRed.withOpacity(0.4)),
      ),
      child: Column(
        children: [
          const Icon(Icons.error_outline, color: AgentTheme.lossRed, size: 40),
          const SizedBox(height: 8),
          Text(_error ?? 'Failed to load analytics',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70)),
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: _loadAnalytics,
            style: ElevatedButton.styleFrom(backgroundColor: AgentTheme.gold),
            child: const Text('Try Again', style: TextStyle(color: Colors.black)),
          ),
        ],
      ),
    );
  }

  Widget _buildFunnelCard() {
    final a = _analytics!;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AgentTheme.surface,
            AgentTheme.surfaceElevated,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AgentTheme.gold.withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.insights, color: AgentTheme.gold, size: 20),
              const SizedBox(width: 8),
              const Text(
                'Conversion Funnel',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
              const Spacer(),
              Text(
                'Past $_selectedDays Days',
                style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _buildFunnelStep(
            icon: Icons.touch_app,
            label: '1. Link Clicks',
            value: '${a.totalClicks}',
            subtitle: '${a.uniqueVisitors} unique visitors',
            color: Colors.blueAccent,
          ),
          const Divider(color: Colors.white10, height: 20),
          _buildFunnelStep(
            icon: Icons.person_add,
            label: '2. User Signups',
            value: '${a.totalSignups}',
            subtitle: '${a.clickToSignupRate.toStringAsFixed(1)}% of clicks converted',
            color: Colors.amber,
          ),
          const Divider(color: Colors.white10, height: 20),
          _buildFunnelStep(
            icon: Icons.account_balance_wallet,
            label: '3. First Time Deposits (FTDs)',
            value: '${a.totalFtds}',
            subtitle: '₹${a.totalFtdAmount.toStringAsFixed(0)} total initial deposits',
            color: AgentTheme.winGreen,
          ),
          const Divider(color: Colors.white10, height: 20),
          _buildFunnelStep(
            icon: Icons.casino,
            label: '4. Active Game Betters',
            value: '${a.totalBetters}',
            subtitle: '₹${a.totalTurnover.toStringAsFixed(0)} total turnover',
            color: Colors.purpleAccent,
          ),
        ],
      ),
    );
  }

  Widget _buildFunnelStep({
    required IconData icon,
    required String label,
    required String value,
    required String subtitle,
    required Color color,
  }) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: color.withOpacity(0.15),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: color, size: 20),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: const TextStyle(color: AgentTheme.textMuted, fontSize: 11),
              ),
            ],
          ),
        ),
        Text(
          value,
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: color,
          ),
        ),
      ],
    );
  }

  Widget _buildConversionRatesCard() {
    final a = _analytics!;
    return Row(
      children: [
        Expanded(
          child: _buildRatePill(
            'Click → Signup',
            '${a.clickToSignupRate.toStringAsFixed(1)}%',
            Colors.blueAccent,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _buildRatePill(
            'Signup → FTD',
            '${a.signupToFtdRate.toStringAsFixed(1)}%',
            Colors.amber,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _buildRatePill(
            'Overall Funnel',
            '${a.overallConversionRate.toStringAsFixed(1)}%',
            AgentTheme.winGreen,
          ),
        ),
      ],
    );
  }

  Widget _buildRatePill(String title, String value, Color color) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AgentTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.25)),
      ),
      child: Column(
        children: [
          Text(
            title,
            style: const TextStyle(color: AgentTheme.textMuted, fontSize: 11),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTrafficSourcesCard() {
    final sources = _analytics!.sources;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AgentTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.share, color: AgentTheme.gold, size: 18),
              SizedBox(width: 8),
              Text(
                'Traffic Sources',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          if (sources.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'No source breakdown recorded yet. Share your referral link on WhatsApp and Telegram to track sources!',
                style: TextStyle(color: AgentTheme.textMuted, fontSize: 12),
              ),
            )
          else
            ...sources.map((s) {
              final name = s['source'] ?? 'Direct';
              final clicks = (s['clicks'] as num?)?.toInt() ?? 0;
              final maxClicks = sources.fold<int>(
                1,
                (prev, e) => (e['clicks'] as num?)?.toInt() ?? 1 > prev
                    ? (e['clicks'] as num?)?.toInt() ?? 1
                    : prev,
              );
              final progress = (clicks / maxClicks).clamp(0.05, 1.0);

              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          name.toString().toUpperCase(),
                          style: const TextStyle(color: Colors.white, fontSize: 12),
                        ),
                        Text(
                          '$clicks clicks',
                          style: const TextStyle(
                            color: AgentTheme.gold,
                            fontWeight: FontWeight.bold,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: progress,
                        backgroundColor: Colors.white10,
                        valueColor: const AlwaysStoppedAnimation<Color>(AgentTheme.gold),
                        minHeight: 6,
                      ),
                    ),
                  ],
                ),
              );
            }),
        ],
      ),
    );
  }

  Widget _buildDeviceBreakdownCard() {
    final devices = _analytics!.devices;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AgentTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.devices, color: AgentTheme.gold, size: 18),
              SizedBox(width: 8),
              Text(
                'Visitor Devices',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (devices.isEmpty)
            const Text(
              'No device data yet',
              style: TextStyle(color: AgentTheme.textMuted, fontSize: 12),
            )
          else
            Wrap(
              spacing: 12,
              runSpacing: 10,
              children: devices.map((d) {
                final dev = d['device'] ?? 'Unknown';
                final count = (d['count'] as num?)?.toInt() ?? 0;
                IconData devIcon = Icons.smartphone;
                if (dev.toString().toLowerCase().contains('ios')) {
                  devIcon = Icons.apple;
                } else if (dev.toString().toLowerCase().contains('desktop')) {
                  devIcon = Icons.computer;
                }
                return Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.04),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Colors.white10),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(devIcon, size: 16, color: AgentTheme.gold),
                      const SizedBox(width: 8),
                      Text(
                        '$dev: $count',
                        style: const TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
        ],
      ),
    );
  }

  Widget _buildDailyBreakdownCard() {
    final series = _analytics!.dailySeries;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AgentTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.calendar_today, color: AgentTheme.gold, size: 18),
              SizedBox(width: 8),
              Text(
                'Daily Activity',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (series.isEmpty)
            const Text(
              'No daily events logged in this range',
              style: TextStyle(color: AgentTheme.textMuted, fontSize: 12),
            )
          else
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: series.length > 7 ? 7 : series.length,
              separatorBuilder: (_, __) => const Divider(color: Colors.white10, height: 16),
              itemBuilder: (context, i) {
                final item = series[i];
                final date = item['date'] ?? item['day'] ?? '-';
                final clicks = item['clicks'] ?? 0;
                final signups = item['signups'] ?? 0;
                final ftds = item['ftds'] ?? 0;

                return Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      date.toString().split('T')[0],
                      style: const TextStyle(color: Colors.white70, fontSize: 13),
                    ),
                    Row(
                      children: [
                        _buildMiniBadge('Clicks: $clicks', Colors.blueAccent),
                        const SizedBox(width: 6),
                        _buildMiniBadge('Signups: $signups', Colors.amber),
                        const SizedBox(width: 6),
                        _buildMiniBadge('FTDs: $ftds', AgentTheme.winGreen),
                      ],
                    ),
                  ],
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _buildMiniBadge(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Text(
        text,
        style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold),
      ),
    );
  }
}

