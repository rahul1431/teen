import 'dart:io';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
import '../../core/network/api_client.dart';
import '../../shared/theme/app_theme.dart'; // AppColors, AppSnackBar, formatCurrency all live here

class MissionsPage extends StatefulWidget {
  const MissionsPage({super.key});
  @override
  State<MissionsPage> createState() => _MissionsPageState();
}

class _MissionsPageState extends State<MissionsPage> with SingleTickerProviderStateMixin {
  bool _loading = true;
  List<dynamic> _weekly = [];
  List<dynamic> _monthly = [];
  final Set<String> _busy = {};
  final _picker = ImagePicker();
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await ApiClient().dio.get('/api/users/missions');
      if (!mounted) return;
      setState(() {
        _weekly = res.data['weekly'] ?? [];
        _monthly = res.data['monthly'] ?? [];
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _claim(String id) async {
    setState(() => _busy.add(id));
    try {
      final res = await ApiClient().dio.post('/api/users/missions/$id/claim');
      if (!mounted) return;
      final amount = res.data['reward_amount'] ?? 0;
      AppSnackBar.show(context, 'Claimed! +${formatCurrency(amount)}');
      await _load();
    } catch (e) {
      if (mounted) {
        final msg = (e as dynamic).response?.data?['error'] ?? 'Could not claim';
        AppSnackBar.show(context, msg, error: true);
      }
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  Future<void> _submitProof(String id) async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Attach Screenshot (optional)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 16),
              ListTile(
                leading: const Icon(Icons.camera_alt_rounded, color: AppColors.gold),
                title: const Text('Camera'),
                onTap: () => Navigator.pop(ctx, ImageSource.camera),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_rounded, color: AppColors.gold),
                title: const Text('Gallery'),
                onTap: () => Navigator.pop(ctx, ImageSource.gallery),
              ),
              ListTile(
                leading: const Icon(Icons.send_rounded, color: AppColors.textSecondary),
                title: const Text('Submit without photo'),
                onTap: () => Navigator.pop(ctx, null),
              ),
            ],
          ),
        ),
      ),
    );
    if (!mounted) return;

    File? proofFile;
    if (source != null) {
      final picked = await _picker.pickImage(source: source, maxWidth: 1600, imageQuality: 85);
      if (picked != null) proofFile = File(picked.path);
      if (!mounted) return;
    }

    setState(() => _busy.add(id));
    try {
      if (proofFile != null) {
        final formData = FormData.fromMap({
          'proof': await MultipartFile.fromFile(proofFile.path, filename: 'proof.jpg'),
        });
        await ApiClient().dio.post('/api/users/missions/$id/submit', data: formData);
      } else {
        await ApiClient().dio.post('/api/users/missions/$id/submit');
      }
      if (!mounted) return;
      AppSnackBar.show(context, 'Submitted for review!');
      await _load();
    } catch (e) {
      if (mounted) {
        final msg = (e as dynamic).response?.data?['error'] ?? 'Could not submit';
        AppSnackBar.show(context, msg, error: true);
      }
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  Future<void> _connectTelegram(String id) async {
    setState(() => _busy.add(id));
    try {
      final res = await ApiClient().dio.get('/api/telegram/deep-link');
      final link = res.data['link'] as String;
      await launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication);
    } catch (_) {
      if (mounted) AppSnackBar.show(context, 'Could not open Telegram', error: true);
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  Widget _actionButton(Map<String, dynamic> m) {
    final id = m['id'] as String;
    final busy = _busy.contains(id);
    switch (m['state']) {
      case 'claim':
        return ElevatedButton(
          onPressed: busy ? null : () => _claim(id),
          style: ElevatedButton.styleFrom(backgroundColor: AppColors.green),
          child: busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Claim'),
        );
      case 'connect_telegram':
        return OutlinedButton(onPressed: busy ? null : () => _connectTelegram(id), child: const Text('Connect Telegram'));
      case 'submit_proof':
        return OutlinedButton(onPressed: busy ? null : () => _submitProof(id), child: const Text('I\'ve Done It'));
      case 'pending_review':
        return const Chip(label: Text('Pending Review'));
      case 'in_progress':
        return Text('${m['progress_current']}/${m['progress_target']}', style: const TextStyle(color: AppColors.textSecondary));
      default:
        return const Chip(label: Text('Done ✓'));
    }
  }

  Widget _missionCard(Map<String, dynamic> m) {
    return Card(
      color: AppColors.surface,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Text(m['emoji'] ?? '🎯', style: const TextStyle(fontSize: 28)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(m['title'] ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 2),
                  Text('Reward: ${formatCurrency(m['reward_amount'])}', style: const TextStyle(color: AppColors.gold, fontSize: 12)),
                ],
              ),
            ),
            _actionButton(m),
          ],
        ),
      ),
    );
  }

  Widget _list(List<dynamic> missions) {
    if (missions.isEmpty) return const Center(child: Text('No missions right now — check back soon!', style: TextStyle(color: AppColors.textSecondary)));
    return ListView(children: missions.map((m) => _missionCard(m as Map<String, dynamic>)).toList());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Missions'),
        backgroundColor: AppColors.surface,
        leading: const BackButton(color: AppColors.gold),
        bottom: TabBar(controller: _tabController, tabs: const [Tab(text: 'Weekly'), Tab(text: 'Monthly')]),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: TabBarView(controller: _tabController, children: [_list(_weekly), _list(_monthly)]),
            ),
    );
  }
}
