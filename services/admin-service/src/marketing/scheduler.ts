import { db } from '../index';

export function startCampaignScheduler() {
  // Check every 60 seconds (on the minute)
  setInterval(async () => {
    try {
      const now = new Date();
      await triggerRecurringCampaigns(now);
    } catch (err) {
      console.error('Error in Campaign Scheduler loop:', err);
    }
  }, 60000);
}

function matchCron(cron: string, date: Date): boolean {
  const parts = cron.split(' ');
  if (parts.length !== 5) return false;

  const [min, hour, dom, mon, dow] = parts;
  const m = date.getMinutes();
  const h = date.getHours();
  const d = date.getDate();
  const mo = date.getMonth() + 1;
  const dw = date.getDay();

  const matchField = (field: string, value: number): boolean => {
    if (field === '*') return true;
    if (field.startsWith('*/')) {
      const step = parseInt(field.split('/')[1]);
      return value % step === 0;
    }
    const val = parseInt(field);
    return val === value;
  };

  return matchField(min, m) &&
         matchField(hour, h) &&
         matchField(dom, d) &&
         matchField(mon, mo) &&
         matchField(dow, dw);
}

async function triggerRecurringCampaigns(now: Date) {
  // Fetch campaigns with a cron expression
  const campaignsRes = await db.query(
    `SELECT * FROM notification_campaigns 
     WHERE cron_expression IS NOT NULL AND cron_expression != ''`
  );

  for (const campaign of campaignsRes.rows) {
    const { id, cron_expression, last_run_at, body, template_b, is_ab_test, segment_type, button_text, button_url, image_url } = campaign;

    // Avoid double run in the same minute
    if (last_run_at) {
      const lastRun = new Date(last_run_at);
      if (lastRun.getFullYear() === now.getFullYear() &&
          lastRun.getMonth() === now.getMonth() &&
          lastRun.getDate() === now.getDate() &&
          lastRun.getHours() === now.getHours() &&
          lastRun.getMinutes() === now.getMinutes()) {
        continue;
      }
    }

    if (matchCron(cron_expression, now)) {
      console.log(`[Campaign Scheduler] Triggering campaign ${id} matching cron "${cron_expression}"`);
      
      // Update last_run_at
      await db.query(
        `UPDATE notification_campaigns SET last_run_at = NOW() WHERE id = $1`,
        [id]
      );

      // Resolve targets based on segment_type
      let recipientQuery = `SELECT phone, id FROM users WHERE is_bot = false AND status = 'active'`;
      if (segment_type === 'active_7d') {
        recipientQuery += ` AND last_login_at >= NOW() - INTERVAL '7 days'`;
      } else if (segment_type === 'inactive_7d') {
        recipientQuery += ` AND (last_login_at IS NULL OR last_login_at < NOW() - INTERVAL '7 days')`;
      } else if (segment_type === 'low_balance') {
        recipientQuery = `
          SELECT u.phone, u.id 
          FROM users u
          JOIN wallets w ON w.user_id = u.id
          WHERE u.is_bot = false AND u.status = 'active'
            AND (w.deposit_balance + w.winning_balance + w.bonus_balance) < 100
        `;
      }

      const usersRes = await db.query(recipientQuery);
      const targets = usersRes.rows.map(r => r.phone);

      if (targets.length === 0) {
        console.log(`[Campaign Scheduler] No active targets for segment "${segment_type}". Skipping run.`);
        continue;
      }

      // Create a child campaign run instance to group the runs
      const runCampaignRes = await db.query(
        `INSERT INTO notification_campaigns (title, body, template_b, is_ab_test, type, target_type, sent_by, total_recipients, delivered_count, button_text, button_url, image_url)
         VALUES ($1, $2, $3, $4, 'outbound_recurring_run', 'all', $5, $6, 0, $7, $8, $9) RETURNING id`,
        [
          `Run: ${campaign.title} (${now.toISOString().substring(0, 16)})`,
          body,
          template_b || null,
          !!is_ab_test,
          campaign.sent_by,
          targets.length,
          button_text || null,
          button_url || null,
          image_url || null
        ]
      );
      const runCampaignId = runCampaignRes.rows[0].id;

      // Loop through targets and generate queue items
      let index = 0;
      for (const target of targets) {
        let leadName = 'Player';
        let whatsappExists = null;
        let telegramExists = null;

        const leadRes = await db.query(
          `SELECT contact_name, whatsapp_exists, telegram_exists 
           FROM marketing_leads WHERE contact_phone = $1`,
          [target]
        );
        if (leadRes.rows.length > 0) {
          leadName = leadRes.rows[0].contact_name;
          whatsappExists = leadRes.rows[0].whatsapp_exists;
          telegramExists = leadRes.rows[0].telegram_exists;
        }

        let baseMsg = body;
        if (is_ab_test && template_b) {
          baseMsg = (index % 2 === 0) ? body : template_b;
        }
        // Force spintax variations if none exist in the template
        if (!baseMsg.includes('{') || !baseMsg.includes('}')) {
          baseMsg = "{Hello|Hi|Hey|Greetings|Welcome}!\n" + baseMsg;
        }
        index++;

        // Generate tracking link
        let trackingUrl = '';
        if (button_url) {
          const shortCode = Math.random().toString(36).substring(2, 8);
          await db.query(
            `INSERT INTO campaign_links (campaign_id, target_phone, short_code, redirect_url)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [runCampaignId, target, shortCode, button_url]
          );
          trackingUrl = `https://game.myonlinejoker.com/api/admin/l/${shortCode}`;
        }

        const resolveSpintax = (text: string): string => {
          return text.replace(/\{([^{}]+)\}/g, (match, choices) => {
            const parts = choices.split('|');
            return parts[Math.floor(Math.random() * parts.length)];
          });
        };

        let resolved = resolveSpintax(baseMsg);
        resolved = resolved.replace(/\{\{Name\}\}/g, leadName);
        if (trackingUrl) {
          if (resolved.includes('{{Link}}')) {
            resolved = resolved.replace(/\{\{Link\}\}/g, trackingUrl);
          } else {
            resolved += `\n\n${button_text || 'Link'}: ${trackingUrl}`;
          }
        }

        // Determine target channel
        let targetChannel = 'whatsapp';
        if (whatsappExists === true && telegramExists === true) {
          targetChannel = Math.random() > 0.5 ? 'whatsapp' : 'telegram';
        } else if (whatsappExists === true) {
          targetChannel = 'whatsapp';
        } else if (telegramExists === true) {
          targetChannel = 'telegram';
        } else {
          targetChannel = Math.random() > 0.5 ? 'whatsapp' : 'telegram';
        }

        await db.query(
          `INSERT INTO campaign_queue_items (campaign_id, target_phone, target_name, resolved_message, status, channel)
           VALUES ($1, $2, $3, $4, 'pending', $5)`,
          [runCampaignId, target, leadName, resolved, targetChannel]
        );
      }
    }
  }
}
