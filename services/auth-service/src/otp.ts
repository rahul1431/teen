import { redis } from './redis'

const OTP_EXPIRY = parseInt(process.env.OTP_EXPIRY_SECONDS || '300')
const DEV_MODE = process.env.OTP_PROVIDER !== 'msg91'

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/** Returns the OTP string in dev mode (so it can be included in the API response), null in production. */
export async function sendOtp(phone: string): Promise<string | null> {
  const otp = generateOtp()
  await redis.setex(`otp:${phone}`, OTP_EXPIRY, otp)

  if (process.env.OTP_PROVIDER === 'msg91') {
    const url = `https://api.msg91.com/api/v5/otp?template_id=${process.env.MSG91_TEMPLATE_ID}&mobile=91${phone}&authkey=${process.env.MSG91_AUTH_KEY}&otp=${otp}`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to send OTP via MSG91')
    return null // never reveal OTP in production
  } else {
    console.log(`[OTP] Phone: ${phone} | OTP: ${otp}`)
    return otp // return for in-app display (dev mode)
  }
}

export async function verifyOtp(phone: string, otp: string): Promise<boolean> {
  // Master test OTP — works in dev mode only (OTP_PROVIDER != msg91).
  // Set MASTER_OTP='' in .env to disable. Defaults to 123456 for testing.
  if (DEV_MODE) {
    const master = process.env.MASTER_OTP ?? '123456'
    if (master && otp === master) {
      await redis.del(`otp:${phone}`)
      return true
    }
  }
  const stored = await redis.get(`otp:${phone}`)
  if (!stored || stored !== otp) return false
  await redis.del(`otp:${phone}`)
  return true
}
