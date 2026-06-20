import { redis } from './redis'

const OTP_EXPIRY = parseInt(process.env.OTP_EXPIRY_SECONDS || '300')

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function sendOtp(phone: string): Promise<void> {
  const otp = generateOtp()
  await redis.setex(`otp:${phone}`, OTP_EXPIRY, otp)

  if (process.env.OTP_PROVIDER === 'msg91') {
    const url = `https://api.msg91.com/api/v5/otp?template_id=${process.env.MSG91_TEMPLATE_ID}&mobile=91${phone}&authkey=${process.env.MSG91_AUTH_KEY}&otp=${otp}`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to send OTP via MSG91')
  } else {
    // console provider for dev
    console.log(`[OTP] Phone: ${phone} | OTP: ${otp}`)
  }
}

export async function verifyOtp(phone: string, otp: string): Promise<boolean> {
  const stored = await redis.get(`otp:${phone}`)
  if (!stored || stored !== otp) return false
  await redis.del(`otp:${phone}`)
  return true
}
