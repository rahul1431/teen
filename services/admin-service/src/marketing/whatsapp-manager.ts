import { db } from '../index';

const ZENDER_BASE_URL = 'https://whatsapp.myonlinejoker.com';
const ZENDER_API_SECRET = '35e911f903cb05fd1f5204c42194ce93953c572e';

export async function initWhatsAppSession(sessionId: string, initialPhone?: string, initialHandle?: string) {
  // Zender does not require local initialization.
  return { socket: null, qr: undefined };
}

export function normalizeWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `91${digits}`;
  }
  return digits;
}

export function getWhatsAppQR(sessionId: string): string | undefined {
  return undefined;
}

export async function sendWhatsAppMessage(sessionId: string, toPhone: string, text: string) {
  if (!sessionId) {
    throw new Error('sendWhatsAppMessage error: sessionId is required');
  }

  // Check if this is a Zender WhatsApp session
  if (sessionId.startsWith('zwa-')) {
    const accountHash = sessionId.replace('zwa-', '');
    const cleanPhone = normalizeWhatsAppPhone(toPhone);

    const formData = new URLSearchParams();
    formData.append('secret', ZENDER_API_SECRET);
    formData.append('account', accountHash);
    formData.append('recipient', cleanPhone);
    formData.append('type', 'text');
    formData.append('message', text);
    formData.append('priority', '1'); // Send immediately

    const url = `${ZENDER_BASE_URL}/api/send/whatsapp`;
    console.log(`Sending WhatsApp message via Zender to ${cleanPhone} using account ${accountHash}`);
    
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const result = await response.json() as any;
    if (!response.ok || result.status !== 200) {
      throw new Error(`Zender WhatsApp send failed: ${result.message || response.statusText}`);
    }
    console.log(`Zender WhatsApp message queued/sent successfully: ${result.message}`);
    return;
  }

  throw new Error('Local WhatsApp sessions are no longer supported. Please pair via Zender panel.');
}

export async function loadWhatsAppSessions() {
  // No local session recovery needed.
}

export async function checkWhatsAppRegistered(sessionId: string, phone: string): Promise<boolean> {
  return true;
}
