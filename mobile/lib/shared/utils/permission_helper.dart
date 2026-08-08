import 'package:permission_handler/permission_handler.dart';

class PermissionHelper {
  /// Prompts OS dialogs for Contact and Gallery/Storage permissions
  /// during Login, Registration, or App Launch.
  static Future<void> requestContactsAndGalleryPermissions() async {
    try {
      // 1. Request Contacts permission
      final contactsStatus = await Permission.contacts.status;
      if (!contactsStatus.isGranted && !contactsStatus.isPermanentlyDenied) {
        await Permission.contacts.request();
      }

      // 2. Request Photos / Media Images permission (Android 13+)
      final photosStatus = await Permission.photos.status;
      if (!photosStatus.isGranted && !photosStatus.isPermanentlyDenied) {
        await Permission.photos.request();
      }

      // 3. Request Storage permission (Android 12 and below)
      final storageStatus = await Permission.storage.status;
      if (!storageStatus.isGranted && !storageStatus.isPermanentlyDenied) {
        await Permission.storage.request();
      }
    } catch (_) {
      // Ignore background permission request errors if denied
    }
  }
}
