import { db } from '../index';
import { checkWhatsAppRegistered } from './whatsapp-manager';
import { checkTelegramRegistered } from './telegram-userbot';

let isRunning = false;

export function startLeadVerifier() {
  // Check for unverified leads every 10 seconds
  setInterval(async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      await verifyNextLeads();
    } catch (err) {
      console.error('Error in Lead Verifier loop:', err);
    } finally {
      isRunning = false;
    }
  }, 10000);
}

async function verifyNextLeads() {
  // 1. Check active sessions
  const activeSessionsRes = await db.query(
    `SELECT DISTINCT protocol, id FROM marketing_sessions WHERE status = 'connected'`
  );
  if (activeSessionsRes.rows.length === 0) {
    return; // No connected sessions to check with
  }

  const waSession = activeSessionsRes.rows.find(r => r.protocol === 'whatsapp');
  const tgSession = activeSessionsRes.rows.find(r => r.protocol === 'telegram');

  // 2. Verify WhatsApp if we have a session
  if (waSession) {
    const unverifiedWARes = await db.query(
      `SELECT contact_phone FROM marketing_leads 
       WHERE whatsapp_exists IS NULL 
       ORDER BY created_at ASC LIMIT 1`
    );
    if (unverifiedWARes.rows.length > 0) {
      const phone = unverifiedWARes.rows[0].contact_phone;
      console.log(`[Lead Verifier] Auto-checking WhatsApp for ${phone}`);
      try {
        const exists = await checkWhatsAppRegistered(waSession.id, phone);
        await db.query(
          `UPDATE marketing_leads SET whatsapp_exists = $1, verified_at = NOW() WHERE contact_phone = $2`,
          [exists, phone]
        );
      } catch (e) {
        console.error(`[Lead Verifier] Failed WhatsApp check for ${phone}:`, e);
      }
    }
  }

  // 3. Verify Telegram if we have a session
  if (tgSession) {
    const unverifiedTGRes = await db.query(
      `SELECT contact_phone FROM marketing_leads 
       WHERE telegram_exists IS NULL 
       ORDER BY created_at ASC LIMIT 1`
    );
    if (unverifiedTGRes.rows.length > 0) {
      const phone = unverifiedTGRes.rows[0].contact_phone;
      console.log(`[Lead Verifier] Auto-checking Telegram for ${phone}`);
      try {
        const exists = await checkTelegramRegistered(tgSession.id, phone);
        await db.query(
          `UPDATE marketing_leads SET telegram_exists = $1, verified_at = NOW() WHERE contact_phone = $2`,
          [exists, phone]
        );
      } catch (e) {
        console.error(`[Lead Verifier] Failed Telegram check for ${phone}:`, e);
      }
    }
  }
}
