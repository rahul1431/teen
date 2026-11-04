import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { db } from '../index';

const apiId = Number(process.env.TELEGRAM_API_ID) || 28249059; // Fallback or env API ID
const apiHash = process.env.TELEGRAM_API_HASH || '36de8c9d06bfa43e8c95ba289d06bc15'; // Fallback or env API Hash

// Map to hold active client connections
const clients = new Map<string, TelegramClient>();

// Map to hold temporary pairing state
interface PairingState {
  client: TelegramClient;
  phoneCodeHash: string;
  phoneNumber: string;
}
const pendingPairings = new Map<string, PairingState>();

export async function requestTelegramCode(sessionId: string, phoneNumber: string) {
  const session = new StringSession('');
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.connect();

  const { phoneCodeHash } = await client.sendCode(
    {
      apiId,
      apiHash,
    },
    phoneNumber
  );

  pendingPairings.set(sessionId, {
    client,
    phoneCodeHash,
    phoneNumber,
  });

  // Record session as pairing
  const logs = [
    `[System] Requested SMS code for ${phoneNumber}...`,
    `[System] Please check your Telegram app or SMS and enter the code.`
  ];

  await db.query(
    `INSERT INTO marketing_sessions (id, protocol, status, phone_number, handle, logs, last_active) 
     VALUES ($1, 'telegram', 'pairing', $2, 'Pending Pair', $3, NOW())
     ON CONFLICT (id) DO UPDATE SET status = 'pairing', phone_number = $2, logs = $3, last_active = NOW()`,
    [sessionId, phoneNumber, logs]
  );

  return { success: true };
}

export async function verifyTelegramCode(sessionId: string, phoneCode: string, password?: string) {
  const pairing = pendingPairings.get(sessionId);
  if (!pairing) {
    throw new Error('No pairing session found. Start pairing first.');
  }

  const { client, phoneCodeHash, phoneNumber } = pairing;

  try {
    await client.signInUser(
      { apiId, apiHash },
      {
        phoneNumber: phoneNumber,
        phoneCode: async () => phoneCode,
        password: password ? async () => password : undefined,
        onError: (err: any) => {
          console.error('Sign-in error:', err);
        }
      }
    );

    const sessionString = client.session.save() as unknown as string;
    const me = await client.getMe();
    const handle = me.username ? `@${me.username}` : `${me.firstName || ''} ${me.lastName || ''}`.trim() || 'Telegram Node';

    const logs = [
      `[System] Connected successfully to Telegram account.`,
      `[System] Active as ${handle} (${phoneNumber}).`
    ];

    await db.query(
      `UPDATE marketing_sessions 
       SET status = 'connected', handle = $1, session_string = $2, logs = $3, last_active = NOW() 
       WHERE id = $4`,
      [handle, sessionString, logs, sessionId]
    );

    clients.set(sessionId, client);
    pendingPairings.delete(sessionId);

    return { success: true };
  } catch (err: any) {
    console.error('Failed to verify Telegram code:', err);
    const logs = [
      `[Error] Verification failed: ${err.message || err}`
    ];
    await db.query(
      `UPDATE marketing_sessions SET logs = logs || $1 WHERE id = $2`,
      [logs, sessionId]
    );
    throw err;
  }
}

export function normalizeTelegramPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.startsWith('91') && digits.length === 12) {
    return `+${digits}`;
  }
  if (phone.trim().startsWith('+')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

export async function sendTelegramUserbotMessage(sessionId: string, targetPhoneOrUser: string, text: string) {
  if (!sessionId) {
    throw new Error('sendTelegramUserbotMessage error: sessionId is required');
  }
  let client = clients.get(sessionId);
  
  if (!client) {
    // Attempt to load from database
    const res = await db.query(
      "SELECT session_string FROM marketing_sessions WHERE id = $1 AND protocol = 'telegram'",
      [sessionId]
    );
    if (res.rows.length === 0 || !res.rows[0].session_string) {
      throw new Error(`Active Telegram session not found for ID: ${sessionId}`);
    }

    const session = new StringSession(res.rows[0].session_string);
    client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    clients.set(sessionId, client);
  }

  // GramJS sendMessage supports usernames, phone numbers, or entity IDs directly.
  // For phone numbers, we must import them first to resolve them to a valid Peer/User entity.
  let target: any = targetPhoneOrUser;
  let importedUserId: any = null;

  if (!target.startsWith('@')) {
    const cleanPhone = normalizeTelegramPhone(target);
    const importRes = await client.invoke(
      new Api.contacts.ImportContacts({
        contacts: [
          new Api.InputPhoneContact({
            clientId: Math.floor(Math.random() * 1000000) as any,
            phone: cleanPhone,
            firstName: targetPhoneOrUser,
            lastName: ''
          })
        ]
      })
    );

    if (importRes && importRes.users && importRes.users.length > 0) {
      target = importRes.users[0];
      importedUserId = target.id;
    } else {
      throw new Error(`Cannot find any entity corresponding to "${cleanPhone}"`);
    }
  }

  await client.sendMessage(target, { message: text });

  // Clean up the imported contact to avoid cluttering the bot's contact list
  if (importedUserId) {
    try {
      await client.invoke(new Api.contacts.DeleteContacts({ id: [importedUserId] }));
    } catch (e) {
      console.warn(`[Telegram Userbot] Failed to delete contact ${importedUserId} after sending message:`, e);
    }
  }
}

export async function loadTelegramSessions() {
  try {
    const res = await db.query(
      "SELECT id, session_string FROM marketing_sessions WHERE protocol = 'telegram' AND status = 'connected' AND session_string IS NOT NULL"
    );
    for (const row of res.rows) {
      if (!row.id) continue;
      const session = new StringSession(row.session_string);
      const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
      client.connect().then(() => {
        clients.set(row.id, client);
      }).catch(err => {
        console.error(`Failed to reconnect Telegram session ${row.id}:`, err);
      });
    }
  } catch (err) {
    console.error('Failed to load active Telegram sessions:', err);
  }
}

export async function checkTelegramRegistered(sessionId: string, phone: string): Promise<boolean> {
  if (!sessionId) {
    throw new Error('checkTelegramRegistered error: sessionId is required');
  }
  let client = clients.get(sessionId);
  if (!client) {
    const res = await db.query(
      "SELECT session_string FROM marketing_sessions WHERE id = $1 AND protocol = 'telegram'",
      [sessionId]
    );
    if (res.rows.length === 0 || !res.rows[0].session_string) {
      return false;
    }
    const session = new StringSession(res.rows[0].session_string);
    client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    clients.set(sessionId, client);
  }

  try {
    const cleanPhone = normalizeTelegramPhone(phone);
    const res = await client.invoke(
      new Api.contacts.ImportContacts({
        contacts: [
          new Api.InputPhoneContact({
            clientId: Math.floor(Math.random() * 1000000) as any,
            phone: cleanPhone,
            firstName: 'Check',
            lastName: ''
          })
        ]
      })
    );

    if (res && res.users && res.users.length > 0) {
      try {
        const userId = res.users[0].id;
        await client.invoke(new Api.contacts.DeleteContacts({ id: [userId] }));
      } catch (_) {}
      return true;
    }
    return false;
  } catch (err) {
    console.error(`Failed to check Telegram status for ${phone}:`, err);
    return false;
  }
}

