import 'package:flutter/material.dart';
import '../agent_theme.dart';
import '../models/agent_models.dart';
import '../services/agent_api_service.dart';

class AgentNetworkScreen extends StatefulWidget {
  final List<SubAgentItem> subAgents;

  const AgentNetworkScreen({super.key, required this.subAgents});

  @override
  State<AgentNetworkScreen> createState() => _AgentNetworkScreenState();
}

class _AgentNetworkScreenState extends State<AgentNetworkScreen> {
  final _api = AgentApiService();
  late List<SubAgentItem> _subAgents;

  @override
  void initState() {
    super.initState();
    _subAgents = List.from(widget.subAgents);
  }

  void _showAddSubAgentModal() {
    final usernameCtrl = TextEditingController();
    final passwordCtrl = TextEditingController();
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    final rateCtrl = TextEditingController(text: '3.0');
    bool isSaving = false;
    String? err;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AgentTheme.cardBg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            return Padding(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                top: 20,
                bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'ADD NEW SUB-AGENT',
                      style: TextStyle(color: AgentTheme.gold, fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Create an agent under your account to earn override commissions.',
                      style: TextStyle(color: AgentTheme.textMuted, fontSize: 12),
                    ),
                    const SizedBox(height: 16),
                    if (err != null)
                      Container(
                        padding: const EdgeInsets.all(10),
                        margin: const EdgeInsets.only(bottom: 12),
                        decoration: BoxDecoration(color: AgentTheme.crimson.withOpacity(0.15), borderRadius: BorderRadius.circular(8)),
                        child: Text(err!, style: const TextStyle(color: AgentTheme.crimson, fontSize: 12)),
                      ),
                    TextField(
                      controller: usernameCtrl,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(labelText: 'Agent Username', hintText: 'e.g. subagent_delhi'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: nameCtrl,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(labelText: 'Display Name', hintText: 'e.g. Delhi Agency Hub'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: phoneCtrl,
                      keyboardType: TextInputType.phone,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(labelText: 'Mobile Number (Optional)', hintText: '9876543210'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: passwordCtrl,
                      obscureText: true,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(labelText: 'Agent Password', hintText: 'Minimum 6 characters'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: rateCtrl,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(labelText: 'Commission Rate (%)', hintText: 'e.g. 3.0'),
                    ),
                    const SizedBox(height: 20),
                    ElevatedButton(
                      onPressed: isSaving
                          ? null
                          : () async {
                              final u = usernameCtrl.text.trim();
                              final p = passwordCtrl.text;
                              final n = nameCtrl.text.trim();
                              final rate = double.tryParse(rateCtrl.text) ?? 3.0;

                              if (u.isEmpty || p.isEmpty || n.isEmpty) {
                                setModalState(() => err = 'Please fill all required fields');
                                return;
                              }

                              setModalState(() {
                                isSaving = true;
                                err = null;
                              });

                              try {
                                await _api.createSubAgent(
                                  username: u,
                                  password: p,
                                  displayName: n,
                                  phone: phoneCtrl.text.trim(),
                                  commissionRate: rate,
                                );
                                if (ctx.mounted) {
                                  Navigator.pop(ctx);
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(content: Text('Sub-agent "$u" created successfully!')),
                                  );
                                }
                              } catch (e) {
                                setModalState(() {
                                  isSaving = false;
                                  err = e.toString().replaceAll('Exception: ', '');
                                });
                              }
                            },
                      style: ElevatedButton.styleFrom(backgroundColor: AgentTheme.gold, padding: const EdgeInsets.symmetric(vertical: 14)),
                      child: isSaving
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.black, strokeWidth: 2))
                          : const Text('CREATE SUB-AGENT', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'SUB-AGENT HIERARCHY',
                style: TextStyle(color: AgentTheme.gold, fontSize: 13, fontWeight: FontWeight.bold, letterSpacing: 0.8),
              ),
              ElevatedButton.icon(
                onPressed: _showAddSubAgentModal,
                icon: const Icon(Icons.add, size: 16, color: Colors.black),
                label: const Text('Add Sub-Agent', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 12)),
                style: ElevatedButton.styleFrom(backgroundColor: AgentTheme.gold),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Expanded(
            child: _subAgents.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.account_tree_outlined, color: AgentTheme.textMuted.withOpacity(0.4), size: 56),
                        const SizedBox(height: 12),
                        const Text('No sub-agents in your network yet', style: TextStyle(color: AgentTheme.textMuted)),
                        const SizedBox(height: 6),
                        const Text('Expand your agency by adding local sub-agents', style: TextStyle(color: Colors.white38, fontSize: 12)),
                      ],
                    ),
                  )
                : ListView.builder(
                    itemCount: _subAgents.length,
                    itemBuilder: (ctx, i) {
                      final sub = _subAgents[i];
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
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Row(
                                  children: [
                                    const CircleAvatar(
                                      radius: 18,
                                      backgroundColor: AgentTheme.surface,
                                      child: Text('👥', style: TextStyle(fontSize: 16)),
                                    ),
                                    const SizedBox(width: 10),
                                    Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(sub.displayName, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                                        Text('@${sub.username}', style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
                                      ],
                                    ),
                                  ],
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: AgentTheme.emerald.withOpacity(0.12),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Text('${sub.commissionRate}% Rate', style: const TextStyle(color: AgentTheme.emerald, fontSize: 11, fontWeight: FontWeight.bold)),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            const Divider(color: Colors.white12, height: 1),
                            const SizedBox(height: 10),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text('Players: ${sub.playerCount}', style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
                                Text('Earned: ₹${sub.totalEarned.toStringAsFixed(0)}', style: const TextStyle(color: AgentTheme.gold, fontWeight: FontWeight.bold, fontSize: 13)),
                              ],
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

