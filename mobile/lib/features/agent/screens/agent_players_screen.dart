import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../agent_theme.dart';
import '../models/agent_models.dart';
import '../services/agent_api_service.dart';
import 'agent_topup_screen.dart';

class AgentPlayersScreen extends StatefulWidget {
  const AgentPlayersScreen({super.key});

  @override
  State<AgentPlayersScreen> createState() => _AgentPlayersScreenState();
}

class _AgentPlayersScreenState extends State<AgentPlayersScreen> {
  final _api = AgentApiService();
  final _searchController = TextEditingController();

  List<AgentPlayerItem> _players = [];
  List<AgentPlayerItem> _filteredPlayers = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadPlayers();
  }

  Future<void> _loadPlayers() async {
    setState(() => _isLoading = true);
    try {
      final list = await _api.getPlayers();
      if (mounted) {
        setState(() {
          _players = list;
          _filteredPlayers = list;
          _isLoading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _filter(String query) {
    if (query.trim().isEmpty) {
      setState(() => _filteredPlayers = _players);
    } else {
      final q = query.toLowerCase().trim();
      setState(() {
        _filteredPlayers = _players.where((p) {
          return p.username.toLowerCase().contains(q) || p.phone.contains(q);
        }).toList();
      });
    }
  }

  void _openWhatsAppChat(String phone) async {
    final cleanPhone = phone.replaceAll(RegExp(r'\D'), '');
    final uri = Uri.parse('whatsapp://send?phone=$cleanPhone&text=Hello%20from%20MyOnlineJoker!');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Search Header
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: TextField(
            controller: _searchController,
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(
              hintText: 'Search player username or mobile...',
              prefixIcon: Icon(Icons.search, color: AgentTheme.gold),
            ),
            onChanged: _filter,
          ),
        ),

        // List
        Expanded(
          child: _isLoading
              ? const Center(child: CircularProgressIndicator(color: AgentTheme.gold))
              : _filteredPlayers.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.people_outline, color: AgentTheme.textMuted.withOpacity(0.5), size: 56),
                          const SizedBox(height: 12),
                          const Text('No referred players found', style: TextStyle(color: AgentTheme.textMuted)),
                        ],
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      itemCount: _filteredPlayers.length,
                      itemBuilder: (ctx, i) {
                        final p = _filteredPlayers[i];
                        return Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: AgentTheme.cardBg,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: Colors.white.withOpacity(0.08)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  CircleAvatar(
                                    radius: 20,
                                    backgroundColor: AgentTheme.surface,
                                    child: const Text('🎮', style: TextStyle(fontSize: 18)),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(p.username, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                                        const SizedBox(height: 2),
                                        Text(p.phone.isEmpty ? 'No Phone' : p.phone, style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
                                      ],
                                    ),
                                  ),
                                  // Quick Top Up Button
                                  ElevatedButton.icon(
                                    onPressed: () {
                                      Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                          builder: (_) => AgentTopUpScreen(
                                            currentBalance: 999999, // Screen re-fetches or uses profile
                                            preselectedPlayer: p.username,
                                          ),
                                        ),
                                      );
                                    },
                                    icon: const Icon(Icons.flash_on, size: 14, color: Colors.black),
                                    label: const Text('Top Up', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 12)),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: AgentTheme.gold,
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                      minimumSize: Size.zero,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 12),
                              const Divider(color: Colors.white12, height: 1),
                              const SizedBox(height: 10),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text('Total Deposits', style: TextStyle(color: AgentTheme.textMuted, fontSize: 11)),
                                      Text('₹${p.totalDeposits.toStringAsFixed(0)}', style: const TextStyle(color: AgentTheme.emerald, fontWeight: FontWeight.bold)),
                                    ],
                                  ),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text('Games Played', style: TextStyle(color: AgentTheme.textMuted, fontSize: 11)),
                                      Text('${p.gamesPlayed}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                                    ],
                                  ),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text('Net Rake', style: TextStyle(color: AgentTheme.textMuted, fontSize: 11)),
                                      Text('₹${p.netHouseLoss.toStringAsFixed(0)}', style: const TextStyle(color: AgentTheme.gold, fontWeight: FontWeight.bold)),
                                    ],
                                  ),
                                ],
                              ),
                            ],
                          ),
                        );
                      },
                    ),
        ),
      ],
    );
  }
}

