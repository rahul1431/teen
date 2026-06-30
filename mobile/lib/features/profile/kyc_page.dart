import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
import '../../core/network/api_client.dart';
import '../../shared/theme/app_theme.dart';

class KycPage extends StatefulWidget {
  const KycPage({super.key});
  @override
  State<KycPage> createState() => _KycPageState();
}

class _KycPageState extends State<KycPage> {
  final _api = ApiClient();
  final _picker = ImagePicker();

  bool _loading = true;
  bool _submitting = false;
  Map<String, dynamic>? _status;

  File? _frontFile;
  File? _backFile;
  File? _selfieFile;

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  Future<void> _loadStatus() async {
    setState(() => _loading = true);
    try {
      final res = await _api.dio.get('/api/users/kyc/status');
      if (mounted) setState(() { _status = res.data; _loading = false; });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickImage(String slot) async {
    final src = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Choose source', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
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
            ],
          ),
        ),
      ),
    );
    if (src == null || !mounted) return;
    final picked = await _picker.pickImage(source: src, maxWidth: 1600, imageQuality: 85);
    if (picked == null || !mounted) return;
    setState(() {
      if (slot == 'front') _frontFile = File(picked.path);
      if (slot == 'back') _backFile = File(picked.path);
      if (slot == 'selfie') _selfieFile = File(picked.path);
    });
  }

  Future<void> _submit() async {
    if (_frontFile == null || _backFile == null || _selfieFile == null) {
      AppSnackBar.show(context, 'Please upload all 3 documents');
      return;
    }
    setState(() => _submitting = true);
    try {
      final formData = FormData.fromMap({
        'aadhaar_front': await MultipartFile.fromFile(_frontFile!.path, filename: 'aadhaar_front.jpg'),
        'aadhaar_back':  await MultipartFile.fromFile(_backFile!.path,  filename: 'aadhaar_back.jpg'),
        'selfie':        await MultipartFile.fromFile(_selfieFile!.path, filename: 'selfie.jpg'),
      });
      await _api.dio.post('/api/users/kyc/submit', data: formData);
      if (!mounted) return;
      AppSnackBar.show(context, 'Documents submitted for review!', success: true);
      await _loadStatus();
    } catch (e) {
      if (!mounted) return;
      AppSnackBar.show(context, 'Upload failed — please try again');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('KYC Verification')),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : _buildBody(),
    );
  }

  Widget _buildBody() {
    final status = _status?['kyc_status'] ?? 'pending';
    final doc = _status?['document'];

    if (status == 'approved') return _buildApproved();
    if (status == 'under_review') return _buildUnderReview(doc);

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        _buildStatusBanner(status, doc),
        const SizedBox(height: 24),
        _buildInfoCard(),
        const SizedBox(height: 24),
        const Text('Upload Documents', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
        const SizedBox(height: 4),
        const Text('Clear photos required · Max 10MB each',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        const SizedBox(height: 16),
        _docSlot(
          label: 'Aadhaar Front',
          hint: 'Front side of Aadhaar card',
          icon: Icons.credit_card_rounded,
          file: _frontFile,
          slot: 'front',
        ),
        const SizedBox(height: 12),
        _docSlot(
          label: 'Aadhaar Back',
          hint: 'Back side of Aadhaar card',
          icon: Icons.credit_card_off_rounded,
          file: _backFile,
          slot: 'back',
        ),
        const SizedBox(height: 12),
        _docSlot(
          label: 'Selfie with Document',
          hint: 'Hold Aadhaar next to your face',
          icon: Icons.face_rounded,
          file: _selfieFile,
          slot: 'selfie',
        ),
        const SizedBox(height: 32),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: _submitting ? null : _submit,
            icon: _submitting
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                : const Icon(Icons.upload_rounded, size: 20),
            label: Text(_submitting ? 'Submitting...' : 'Submit for Review'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.gold,
              foregroundColor: Colors.black,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          '⚠️ Your documents are encrypted and stored securely. KYC is required for withdrawals above ₹10,000.',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.5),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildStatusBanner(String status, Map<String, dynamic>? doc) {
    if (status == 'rejected') {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.red.withOpacity(0.1),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.red.withOpacity(0.4)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.cancel_rounded, color: AppColors.red, size: 18),
                SizedBox(width: 8),
                Text('KYC Rejected', style: TextStyle(color: AppColors.red, fontWeight: FontWeight.bold, fontSize: 14)),
              ],
            ),
            if (doc?['rejection_reason'] != null) ...[
              const SizedBox(height: 6),
              Text('Reason: ${doc!['rejection_reason']}',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            ],
            const SizedBox(height: 8),
            const Text('Please re-upload your documents below.',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          ],
        ),
      );
    }
    return const SizedBox.shrink();
  }

  Widget _buildInfoCard() => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: AppColors.cardBg,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: AppColors.border),
    ),
    child: const Column(
      children: [
        _InfoRow(Icons.check_circle_rounded, AppColors.green, 'Required for withdrawals above ₹10,000'),
        _InfoRow(Icons.check_circle_rounded, AppColors.green, 'Verified within 24-48 hours'),
        _InfoRow(Icons.check_circle_rounded, AppColors.green, 'Documents encrypted & stored securely'),
        _InfoRow(Icons.check_circle_rounded, AppColors.green, 'Only Aadhaar card required'),
      ],
    ),
  );

  Widget _docSlot({
    required String label,
    required String hint,
    required IconData icon,
    required File? file,
    required String slot,
  }) {
    return GestureDetector(
      onTap: () => _pickImage(slot),
      child: Container(
        height: 100,
        decoration: BoxDecoration(
          color: file != null ? Colors.transparent : AppColors.cardBg,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: file != null ? AppColors.green : AppColors.border,
            width: file != null ? 2 : 1,
          ),
        ),
        child: file != null
            ? ClipRRect(
                borderRadius: BorderRadius.circular(13),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Image.file(file, fit: BoxFit.cover),
                    Positioned(
                      top: 8, right: 8,
                      child: Container(
                        padding: const EdgeInsets.all(4),
                        decoration: const BoxDecoration(
                            color: Colors.black54, shape: BoxShape.circle),
                        child: const Icon(Icons.check_rounded, color: AppColors.green, size: 16),
                      ),
                    ),
                    Positioned(
                      bottom: 0, left: 0, right: 0,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: const BoxDecoration(
                          gradient: LinearGradient(
                            colors: [Colors.black87, Colors.transparent],
                            begin: Alignment.bottomCenter,
                            end: Alignment.topCenter,
                          ),
                          borderRadius: BorderRadius.vertical(bottom: Radius.circular(13)),
                        ),
                        child: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                      ),
                    ),
                  ],
                ),
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, color: AppColors.textSecondary, size: 28),
                  const SizedBox(width: 14),
                  Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                      Text(hint, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                        decoration: BoxDecoration(
                          color: AppColors.gold.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: AppColors.gold.withOpacity(0.4)),
                        ),
                        child: const Text('Tap to upload', style: TextStyle(color: AppColors.gold, fontSize: 11, fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
                ],
              ),
      ),
    );
  }

  Widget _buildUnderReview(Map<String, dynamic>? doc) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('⏳', style: TextStyle(fontSize: 60)),
          const SizedBox(height: 20),
          const Text('Under Review', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          const Text(
            'Your documents have been submitted and are under review.\nThis usually takes 24-48 hours.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.textSecondary, fontSize: 14, height: 1.5),
          ),
          if (doc?['submitted_at'] != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                'Submitted: ${_formatDate(doc!['submitted_at'])}',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
              ),
            ),
          ],
        ],
      ),
    ),
  );

  Widget _buildApproved() => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: const [
          Text('✅', style: TextStyle(fontSize: 60)),
          SizedBox(height: 20),
          Text('KYC Verified!', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.green)),
          SizedBox(height: 8),
          Text(
            'Your identity has been verified.\nYou can now make withdrawals without any limits.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.textSecondary, fontSize: 14, height: 1.5),
          ),
        ],
      ),
    ),
  );

  String _formatDate(String? iso) {
    if (iso == null) return '—';
    try {
      final dt = DateTime.parse(iso).toLocal();
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return iso;
    }
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String text;
  const _InfoRow(this.icon, this.color, this.text);

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      children: [
        Icon(icon, color: color, size: 16),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary))),
      ],
    ),
  );
}
