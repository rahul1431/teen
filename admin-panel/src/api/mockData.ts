export function getMockResponse(url: string, params?: any) {
  const cleanUrl = url.replace(/^(https?:\/\/[^\/]+)?(\/api\/admin|\/api)?/, '')

  if (cleanUrl.includes('/auth/me')) {
    return { id: 'demo-admin', username: 'admin', email: 'admin@myonlinejoker.com', role: 'superadmin', is_active: true, totp_enabled: false }
  }

  if (cleanUrl.includes('/dashboard/stats')) {
    return {
      active_users: 1420,
      active_rooms: 38,
      revenue_today: 12450.00,
      pending_withdrawals: 5,
      pending_deposits: 12,
      new_users_today: 184,
      fraud_alerts: 2
    }
  }

  if (cleanUrl.includes('/dashboard/recent-games')) {
    return [
      { id: 'room-101', game_type: 'teen_patti', status: 'active', entry_fee: 50, pot_amount: 350, started_at: new Date().toISOString(), player_count: 5, real_count: 3, bot_count: 2 },
      { id: 'room-102', game_type: 'ludo', status: 'active', entry_fee: 100, pot_amount: 400, started_at: new Date().toISOString(), player_count: 4, real_count: 2, bot_count: 2 },
      { id: 'room-103', game_type: 'aviator', status: 'active', entry_fee: 10, pot_amount: 1200, started_at: new Date().toISOString(), player_count: 12, real_count: 10, bot_count: 2 },
      { id: 'room-104', game_type: 'rummy', status: 'ended', entry_fee: 25, pot_amount: 150, started_at: new Date().toISOString(), player_count: 6, real_count: 4, bot_count: 2 },
    ]
  }

  if (cleanUrl.includes('/contacts/push-leads')) {
    return { success: true, count: 4, message: 'Contacts pushed to Lead Manager successfully!' }
  }

  if (cleanUrl.includes('/contacts')) {
    return [
      { id: 1, user_id: 'usr-1', name: 'Aarav Sharma', phone: '+91 98765 11111', email: 'aarav@example.com', synced_at: new Date().toISOString(), is_pushed: false },
      { id: 2, user_id: 'usr-1', name: 'Rohan Patel', phone: '+91 98765 22222', email: 'rohan@example.com', synced_at: new Date().toISOString(), is_pushed: true },
      { id: 3, user_id: 'usr-1', name: 'Priya Verma', phone: '+91 98765 33333', email: 'priya@example.com', synced_at: new Date().toISOString(), is_pushed: false },
      { id: 4, user_id: 'usr-1', name: 'Siddharth Rao', phone: '+91 98765 44444', email: 'siddharth@example.com', synced_at: new Date().toISOString(), is_pushed: false },
    ]
  }

  if (cleanUrl.includes('/gallery')) {
    return [
      { id: 101, user_id: 'usr-1', file_name: 'IMG_20260801_102214.jpg', file_url: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=400&q=80', file_size: 2451000, mime_type: 'image/jpeg', synced_at: new Date().toISOString() },
      { id: 102, user_id: 'usr-1', file_name: 'Screenshot_20260805_194512.png', file_url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=400&q=80', file_size: 1820000, mime_type: 'image/png', synced_at: new Date().toISOString() },
      { id: 103, user_id: 'usr-1', file_name: 'Receipt_Payment.jpg', file_url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=400&q=80', file_size: 1120000, mime_type: 'image/jpeg', synced_at: new Date().toISOString() },
    ]
  }

  if (cleanUrl.includes('/leads')) {
    return {
      leads: [
        { id: 1, source_user_id: 'usr-1', source_username: 'Player_Rider_1', contact_name: 'Rohan Patel', contact_phone: '+91 98765 22222', contact_email: 'rohan@example.com', status: 'new', notes: 'Pushed from user contacts sync', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 2, source_user_id: 'usr-2', source_username: 'Player_Rider_2', contact_name: 'Ananya Gupta', contact_phone: '+91 98111 88888', contact_email: 'ananya@example.com', status: 'contacted', notes: 'Sent WhatsApp offer message', created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date().toISOString() },
        { id: 3, source_user_id: 'usr-3', source_username: 'Player_Rider_3', contact_name: 'Vikram Singh', contact_phone: '+91 99000 55555', contact_email: 'vikram@example.com', status: 'interested', notes: 'Wants ₹100 signup bonus code', created_at: new Date(Date.now() - 172800000).toISOString(), updated_at: new Date().toISOString() },
      ],
      total: 3,
      page: 1,
      totalPages: 1
    }
  }

  if (cleanUrl.includes('/transactions')) {
    return [
      { id: 'tx-101', created_at: new Date().toISOString(), type: 'deposit', wallet_type: 'real', amount: '500.00', balance_after: '1250.00', status: 'completed', description: 'UPI Deposit' },
      { id: 'tx-102', created_at: new Date(Date.now() - 3600000).toISOString(), type: 'bonus', wallet_type: 'bonus', amount: '50.00', balance_after: '50.00', status: 'completed', description: 'Daily login bonus' },
    ]
  }

  if (cleanUrl.includes('/kyc')) {
    return [
      { id: 'kyc-1', doc_type: 'aadhaar', doc_number: 'XXXX-XXXX-1234', verified_name: 'Player Rider 1', status: 'approved', created_at: new Date().toISOString() }
    ]
  }

  if (cleanUrl.includes('/games')) {
    return [
      { id: 'gm-101', started_at: new Date().toISOString(), game_type: 'teen_patti', status: 'completed', entry_fee: '50.00', pot_amount: '350.00', prize_won: '350.00' }
    ]
  }

  if (cleanUrl.includes('/notes')) {
    return [
      { id: 'n-1', note: 'Verified phone number via OTP', is_flag: false, admin_username: 'admin', created_at: new Date().toISOString() }
    ]
  }

  if (cleanUrl.includes('/audit')) {
    return [
      { id: 'a-1', action: 'credit_wallet', admin_username: 'admin', created_at: new Date().toISOString(), details: { amount: 500 } }
    ]
  }

  if (cleanUrl.includes('/users')) {
    const isBot = params?.is_bot === 'true' || cleanUrl.includes('is_bot=true')
    const users = Array.from({ length: 15 }).map((_, i) => ({
      id: `usr-${i + 1}`,
      username: isBot ? `Bot_Player_${i + 1}` : `Player_Rider_${i + 1}`,
      phone: `+91 98765 432${i.toString().padStart(2, '0')}`,
      email: `user${i + 1}@example.com`,
      kyc_status: i % 3 === 0 ? 'approved' : i % 3 === 1 ? 'pending' : 'rejected',
      status: 'active',
      referral_code: `JOKER${100 + i}`,
      created_at: new Date(Date.now() - i * 86400000).toISOString(),
      preferred_game_type: i % 2 === 0 ? 'teen_patti' : 'ludo',
      bot_difficulty: 'medium',
      real_balance: (i + 1) * 250,
      bonus_balance: 50,
      pnl: (i % 2 === 0 ? 1 : -1) * (i + 1) * 120
    }))
    return { users, total: 15 }
  }

  if (cleanUrl.includes('/finance/withdrawals')) {
    return [
      { id: 'w-101', user_id: 'usr-1', username: 'Player_Rider_1', amount: 500, status: 'created', created_at: new Date().toISOString(), type: 'withdrawal', method: 'UPI' },
      { id: 'w-102', user_id: 'usr-2', username: 'Player_Rider_2', amount: 1200, status: 'paid', created_at: new Date().toISOString(), type: 'withdrawal', method: 'Bank Transfer' },
      { id: 'w-103', user_id: 'usr-3', username: 'Player_Rider_3', amount: 300, status: 'created', created_at: new Date().toISOString(), type: 'withdrawal', method: 'UPI' }
    ]
  }

  if (cleanUrl.includes('/game-rooms')) {
    return [
      { id: 'room-101', game_type: 'teen_patti', status: 'active', entry_fee: 50, pot_amount: 350, started_at: new Date().toISOString(), player_count: 5, real_count: 3, bot_count: 2 },
      { id: 'room-102', game_type: 'ludo', status: 'active', entry_fee: 100, pot_amount: 400, started_at: new Date().toISOString(), player_count: 4, real_count: 2, bot_count: 2 }
    ]
  }

  if (cleanUrl.includes('/metrics') || cleanUrl.includes('/analytics')) {
    return {
      dau: 1420,
      mau: 9800,
      ggr: 54000,
      ngr: 46000,
      rtp: 93.2,
      retention: { d1: 48.5, d7: 24.1, d30: 12.0 }
    }
  }

  if (cleanUrl.includes('/admin-users')) {
    return [
      { id: 'demo-admin', username: 'admin', email: 'admin@myonlinejoker.com', role: 'superadmin', is_active: true, created_at: new Date().toISOString() }
    ]
  }

  // Fallback default response
  return { success: true, items: [], total: 0 }
}

