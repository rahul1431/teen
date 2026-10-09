import Redis from 'ioredis'
import crypto from 'crypto'

const OTP_EXPIRY = parseInt(process.env.OTP_EXPIRY_SECONDS || '300', 10)
const MAX_VERIFY_ATTEMPTS = 5
const LOCKOUT_SECONDS = 15 * 60 // 15 minutes lockout after 5 failed attempts

const isProduction = process.env.NODE_ENV === 'production'
const DEV_MODE = !isProduction && process.env.OTP_PROVIDER !== 'msg91' && process.env.OTP_PROVIDER !== 'sms-gateway'

function generateOtp(): string {
  // Cryptographically secure 6-digit OTP
  return crypto.randomInt(100000, 1000000).toString()
}

export async function sendOtp(redis: Redis, phone: string, reason?: 'register' | 'reset'): Promise<string | null> {
  // Check if the phone is currently locked out from brute-force attempts
  const isLocked = await redis.get(`otp_lockout:${phone}`)
  if (isLocked) {
    throw new Error('Too many failed OTP attempts. Please wait 15 minutes before requesting a new OTP.')
  }

  const otp = generateOtp()
  await redis.setex(`otp:${phone}`, OTP_EXPIRY, otp)
  // Reset verification attempts on new OTP request
  await redis.del(`otp_attempts:${phone}`)

  if (process.env.OTP_PROVIDER === 'msg91') {
    const url = `https://api.msg91.com/api/v5/otp?template_id=${process.env.MSG91_TEMPLATE_ID}&mobile=91${phone}&authkey=${process.env.MSG91_AUTH_KEY}&otp=${otp}`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to send OTP via MSG91')
    return null
  } else if (process.env.OTP_PROVIDER === 'sms-gateway') {
    const url = process.env.SMS_GATEWAY_URL || 'https://whatsapp.myonlinejoker.com/api/send/sms'
    
    // Format phone number to contain country code 91 if it's 10 digits
    let formattedPhone = phone.trim()
    if (/^\d{10}$/.test(formattedPhone)) {
      formattedPhone = `91${formattedPhone}`
    } else if (formattedPhone.startsWith('+')) {
      formattedPhone = formattedPhone.replace('+', '')
    }

    let messageText = `Your OTP is: ${otp}`
    if (reason === 'register') {
      messageText = `Thank you for joining MyOnlineJoker. Your Registration OTP is: ${otp}`
    } else if (reason === 'reset') {
      messageText = `Your reset password OTP for MyOnlineJoker is: ${otp}`
    }

    const formData = new URLSearchParams()
    formData.append('secret', process.env.SMS_GATEWAY_SECRET || '')
    formData.append('mode', 'devices')
    formData.append('device', process.env.SMS_GATEWAY_DEVICE_ID || '')
    formData.append('phone', formattedPhone)
    formData.append('message', messageText)
    formData.append('sim', '1')
    formData.append('priority', '1')

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    })
    
    if (!res.ok) {
      const errText = await res.text()
      console.error(`[OTP] SMS Gateway Error: ${errText}`)
      throw new Error(`Failed to send OTP via SMS Gateway: ${errText}`)
    }
    return null
  } else {
    console.log(`[OTP] Phone: ${phone} | OTP: ${otp}`)
    // Never expose dev OTP in production
    return DEV_MODE ? otp : null
  }
}

export async function verifyOtp(redis: Redis, phone: string, otp: string, deleteAfter: boolean = true): Promise<boolean> {
  // Check lockout
  const isLocked = await redis.get(`otp_lockout:${phone}`)
  if (isLocked) {
    return false
  }

  // Master OTP is strictly forbidden in production
  if (DEV_MODE && !isProduction) {
    const master = process.env.MASTER_OTP ?? '123456'
    if (master && otp === master) {
      if (deleteAfter) {
        await redis.del(`otp:${phone}`)
        await redis.del(`otp_attempts:${phone}`)
      }
      return true
    }
  }

  const stored = await redis.get(`otp:${phone}`)
  if (!stored || stored !== otp) {
    // Increment failed attempt counter
    const attempts = await redis.incr(`otp_attempts:${phone}`)
    if (attempts === 1) {
      await redis.expire(`otp_attempts:${phone}`, OTP_EXPIRY)
    }
    if (attempts >= MAX_VERIFY_ATTEMPTS) {
      await redis.setex(`otp_lockout:${phone}`, LOCKOUT_SECONDS, '1')
      await redis.del(`otp:${phone}`)
      await redis.del(`otp_attempts:${phone}`)
      console.warn(`[OTP] Phone ${phone} locked out due to exceeding ${MAX_VERIFY_ATTEMPTS} failed attempts`)
    }
    return false
  }

  if (deleteAfter) {
    await redis.del(`otp:${phone}`)
    await redis.del(`otp_attempts:${phone}`)
  }
  return true
}

