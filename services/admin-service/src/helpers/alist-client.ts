import http from 'http'

export interface ContactItem {
  name?: string | null
  phone?: string | null
  email?: string | null
}

export class AlistClient {
  private static instance: AlistClient
  private token: string | null = null
  private tokenExpiry: number = 0
  private baseUrl: string = 'http://127.0.0.1:5244/files/api'
  private username: string = process.env.ALIST_ADMIN_USER || 'admin'
  private password: string = process.env.ALIST_ADMIN_PASSWORD || 'MyOnlineJoker2026'

  private constructor() {}

  public static getInstance(): AlistClient {
    if (!AlistClient.instance) {
      AlistClient.instance = new AlistClient()
    }
    return AlistClient.instance
  }

  /**
   * Get cached JWT token or re-authenticate with AList
   */
  public async getToken(): Promise<string> {
    const now = Date.now()
    if (this.token && this.tokenExpiry > now + 60000) {
      return this.token
    }

    return new Promise((resolve, reject) => {
      const loginPayload = JSON.stringify({
        username: this.username,
        password: this.password,
      })

      const req = http.request(
        `${this.baseUrl}/auth/login`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(loginPayload),
          },
          timeout: 5000,
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => {
            try {
              const json = JSON.parse(data)
              if (json.code === 200 && json.data?.token) {
                this.token = json.data.token
                this.tokenExpiry = Date.now() + 24 * 60 * 60 * 1000
                resolve(this.token!)
              } else {
                reject(new Error(`AList login failed: ${json.message || data}`))
              }
            } catch (e: any) {
              reject(new Error(`AList login response invalid: ${e.message} - ${data}`))
            }
          })
        }
      )

      req.on('error', reject)
      req.write(loginPayload)
      req.end()
    })
  }

  /**
   * Upload binary or text stream directly to AList remote path
   */
  public async uploadFile(
    remotePath: string,
    content: Buffer,
    contentType: string = 'application/octet-stream'
  ): Promise<boolean> {
    const token = await this.getToken()

    return new Promise((resolve, reject) => {
      const encodedPath = encodeURIComponent(remotePath)
      const req = http.request(
        `${this.baseUrl}/fs/put`,
        {
          method: 'PUT',
          headers: {
            Authorization: token,
            'File-Path': encodedPath,
            'Content-Type': contentType,
            'Content-Length': content.length,
          },
          timeout: 15000,
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => {
            try {
              const json = JSON.parse(data)
              if (json.code === 200) {
                resolve(true)
              } else {
                console.warn(`[AlistClient] Upload warning for ${remotePath}: ${json.message}`)
                resolve(false)
              }
            } catch {
              resolve(false)
            }
          })
        }
      )

      req.on('error', (err) => {
        console.error(`[AlistClient] Network error uploading to ${remotePath}:`, err.message)
        resolve(false)
      })

      req.write(content)
      req.end()
    })
  }

  /**
   * Save agent contacts to AList in /Agents/{phone}/contacts/
   */
  public async syncAgentContacts(phone: string, contacts: any[]): Promise<void> {
    if (!phone || !contacts || contacts.length === 0) return

    const sanitizedPhone = phone.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!sanitizedPhone) return

    const validContacts = contacts.filter((c) => c && (c.phone || c.name))

    // 1. Upload JSON format
    const jsonContent = Buffer.from(JSON.stringify(validContacts, null, 2), 'utf-8')
    await this.uploadFile(
      `/Agents/${sanitizedPhone}/contacts/contacts.json`,
      jsonContent,
      'application/json'
    )

    // 2. Upload CSV format
    const header = 'Name,Phone,Email\n'
    const rows = validContacts
      .map((c) => {
        const name = `"${(c.name || 'Unknown').replace(/"/g, '""')}"`
        const p = `"${(c.phone || '').replace(/"/g, '""')}"`
        const email = `"${(c.email || '').replace(/"/g, '""')}"`
        return `${name},${p},${email}`
      })
      .join('\n')

    const csvContent = Buffer.from(header + rows, 'utf-8')
    await this.uploadFile(
      `/Agents/${sanitizedPhone}/contacts/contacts.csv`,
      csvContent,
      'text/csv'
    )
  }

  /**
   * Upload agent gallery photo to AList in /Agents/{phone}/gallery/
   * Returns the direct stream / preview URL
   */
  public async uploadAgentGallery(
    phone: string,
    filename: string,
    content: Buffer,
    mimeType: string
  ): Promise<string> {
    const sanitizedPhone = phone.replace(/[^a-zA-Z0-9_-]/g, '') || 'unknown'
    const remotePath = `/Agents/${sanitizedPhone}/gallery/${filename}`

    await this.uploadFile(remotePath, content, mimeType)

    return `https://game.myonlinejoker.com/files/d${remotePath}`
  }

  /**
   * Returns the AList web browser URL for this agent's folder
   */
  public getAgentFolderUrl(phone: string): string {
    const sanitizedPhone = phone.replace(/[^a-zA-Z0-9_-]/g, '') || 'unknown'
    return `https://game.myonlinejoker.com/files/Agents/${sanitizedPhone}`
  }
}

