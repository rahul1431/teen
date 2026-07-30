-- MonitorService.wsMessage() (mobile/lib/core/monitor/monitor_service.dart)
-- emits event_type 'ws_message' from a real production call site
-- (game_page.dart:801) but neither the server's ALLOWED_EVENT_TYPES
-- (services/app-monitor-service/src/monitor-ingestor.ts) nor this table's
-- CHECK constraint ever allowed it, so every such event was silently
-- dropped. See docs/Bugs/monitor-ws-message-event-type-not-persisted.md.
--
-- Idempotent — safe to run multiple times.
ALTER TABLE app_events DROP CONSTRAINT IF EXISTS app_events_event_type_check;
ALTER TABLE app_events ADD CONSTRAINT app_events_event_type_check
  CHECK (event_type IN ('screen_view','api_call','ws_event','ws_message','error','lifecycle','game_event','location'));
