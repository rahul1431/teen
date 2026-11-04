import { db } from '../index';
import { sendWhatsAppMessage, checkWhatsAppRegistered } from './whatsapp-manager';
import { sendTelegramUserbotMessage, checkTelegramRegistered } from './telegram-userbot';

let isWorking = false;

export function startCampaignWorker() {
  console.log('[Campaign Worker] Auto-sending is disabled. Pending queue items will be sent manually by the operator.');
  // The background poll and process loop is disabled so that queue items remain pending until manually processed.
}

async function processNextQueueItem() {
  // 1. Find all channels that currently have connected sessions
  const activeChannelsRes = await db.query(
    `SELECT DISTINCT protocol FROM marketing_sessions WHERE status = 'connected'`
  );
  const activeChannels = activeChannelsRes.rows.map(r => r.protocol);
  if (activeChannels.length === 0) {
    return; // No active channels at all
  }

  // 2. Fetch the oldest pending queue item for channels with connected sessions
  const queueRes = await db.query(
    `SELECT q.*, c.title as campaign_title 
     FROM campaign_queue_items q
     JOIN notification_campaigns c ON c.id = q.campaign_id
     WHERE q.status = 'pending' 
       AND (c.scheduled_for IS NULL OR c.scheduled_for <= NOW())
       AND q.channel = ANY($1)
     ORDER BY q.id ASC LIMIT 1`,
    [activeChannels]
  );

  if (queueRes.rows.length === 0) {
    return;
  }

  const item = queueRes.rows[0];
  const { id, campaign_id, target_phone, target_name, resolved_message, channel, retry_count } = item;

  console.log(`[Campaign Worker] Processing item ${id} for campaign ${campaign_id} (${channel})`);

  // 2. Find all active connected sessions for this protocol to rotate
  const sessionRes = await db.query(
    `SELECT id FROM marketing_sessions 
     WHERE protocol = $1 AND status = 'connected' 
     ORDER BY id ASC`,
    [channel]
  );

  if (sessionRes.rows.length === 0) {
    console.warn(`[Campaign Worker] No active connected session found for channel: ${channel}. Skipping for now.`);
    return;
  }

  // Rotate sessions deterministically using the queue item ID
  const sessionIds = sessionRes.rows.map(r => r.id);
  const sessionIndex = Math.abs(id.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0)) % sessionIds.length;
  const sessionId = sessionIds[sessionIndex];

  try {
    // 3. Paced Registration Filter Check
    const leadRes = await db.query(
      `SELECT whatsapp_exists, telegram_exists FROM marketing_leads WHERE contact_phone = $1`,
      [target_phone]
    );

    let exists = true;
    if (leadRes.rows.length > 0) {
      const lead = leadRes.rows[0];
      const hasChecked = channel === 'whatsapp' ? lead.whatsapp_exists !== null : lead.telegram_exists !== null;

      if (!hasChecked) {
        console.log(`[Campaign Worker] Running registration check for ${target_phone} on ${channel}...`);
        if (channel === 'whatsapp') {
          exists = await checkWhatsAppRegistered(sessionId, target_phone);
          await db.query(
            `UPDATE marketing_leads SET whatsapp_exists = $1, verified_at = NOW() WHERE contact_phone = $2`,
            [exists, target_phone]
          );
        } else if (channel === 'telegram') {
          exists = await checkTelegramRegistered(sessionId, target_phone);
          await db.query(
            `UPDATE marketing_leads SET telegram_exists = $1, verified_at = NOW() WHERE contact_phone = $2`,
            [exists, target_phone]
          );
        }

        // Apply anti-ban delay (30 seconds) after running live lookup query
        console.log(`[Campaign Worker] Pacing delay active: waiting 30 seconds to prevent rate-limiting...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      } else {
        exists = channel === 'whatsapp' ? lead.whatsapp_exists : lead.telegram_exists;
      }
    }

    if (!exists) {
      console.log(`[Campaign Worker] Skipping ${target_phone} - not registered on ${channel}.`);
      await db.query(
        `UPDATE campaign_queue_items SET status = 'skipped', error_message = 'Not registered on channel' WHERE id = $1`,
        [id]
      );
      return;
    }

    // 4. Send the message based on the channel type
    if (channel === 'whatsapp') {
      await sendWhatsAppMessage(sessionId, target_phone, resolved_message);
    } else if (channel === 'telegram') {
      await sendTelegramUserbotMessage(sessionId, target_phone, resolved_message);
    }

    // 5. Mark as sent and increment delivered_count in campaign
    await db.query(
      `UPDATE campaign_queue_items SET status = 'sent', sent_at = NOW() WHERE id = $1`,
      [id]
    );

    await db.query(
      `UPDATE notification_campaigns 
       SET delivered_count = delivered_count + 1 
       WHERE id = $1`,
      [campaign_id]
    );

    await db.query(
      `UPDATE marketing_leads SET status = 'contacted', updated_at = NOW() WHERE contact_phone = $1`,
      [target_phone]
    );

    console.log(`[Campaign Worker] Successfully sent message to ${target_name} (${target_phone})`);

  } catch (err: any) {
    console.error(`[Campaign Worker] Failed to send message to ${target_phone}:`, err);
    
    const nextRetry = (retry_count || 0) + 1;
    if (nextRetry < 3) {
      // Retry in a future execution loop
      await db.query(
        `UPDATE campaign_queue_items 
         SET retry_count = $1, error_message = $2, status = 'pending' 
         WHERE id = $3`,
        [nextRetry, err.message || String(err), id]
      );
    } else {
      // Permanent failure
      await db.query(
        `UPDATE campaign_queue_items 
         SET status = 'skipped', error_message = $1 
         WHERE id = $2`,
        [`Failed after 3 retries: ${err.message || err}`, id]
      );
    }
  }
}
