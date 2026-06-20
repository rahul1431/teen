import '@fastify/jwt'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: any, reply: any) => Promise<void>
  }
}

export {}
