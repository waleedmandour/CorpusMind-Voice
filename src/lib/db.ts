import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaPragmas: Promise<void> | undefined
}

// Windows (and any OS with mandatory file locking) is far stricter about
// concurrent SQLite writers than macOS/Linux. Two hardening measures keep
// "database is locked" out of the desktop app:
//
// 1. connection_limit=1 serializes every query through one connection, so
//    two Prisma writes can never race inside this process.
// 2. journal_mode=WAL lets readers proceed while a write transaction is open
//    (e.g. an export while a pipeline job commits), and busy_timeout makes a
//    blocked writer wait instead of failing immediately. journal_mode
//    persists in the database file; busy_timeout is set per connection.
function hardenedUrl(): string {
  const raw = process.env.DATABASE_URL || 'file:./db/custom.db'
  const [url, existingQuery = ''] = raw.split('?')
  const params = new URLSearchParams(existingQuery)
  if (!params.has('connection_limit')) params.set('connection_limit', '1')
  return `${url}?${params.toString()}`
}

async function applyPragmas(client: PrismaClient): Promise<void> {
  const pragmas = [
    'PRAGMA journal_mode=WAL;',
    'PRAGMA busy_timeout=5000;',
    'PRAGMA foreign_keys=ON;',
  ]
  for (const pragma of pragmas) {
    try {
      await client.$executeRawUnsafe(pragma)
    } catch {
      // best-effort: an unreadable seed database must not block boot; the
      // per-query retry behaviour of connection_limit=1 still applies
    }
  }
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Prisma logs every statement in production builds otherwise; keep the
    // desktop console readable and only surface errors.
    log:
      process.env.NODE_ENV === 'production'
        ? [{ emit: 'stdout', level: 'error' }]
        : ['query', 'error', 'warn'],
    datasources: { db: { url: hardenedUrl() } },
  })

// Fire the pragma setup once per process; later callers share the promise.
globalForPrisma.prismaPragmas ??= applyPragmas(db)

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
