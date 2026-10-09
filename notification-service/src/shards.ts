import { SQL } from 'bun'

// Must match backend/src/db/shards.ts's hashUsername/shardFor exactly — this
// is the second contract between the two services (the first is
// rabbitmq.ts's PUSH_QUEUE/PushPendingMessage), and there's no shared package
// to enforce it at compile time.

function required(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`Set ${name}!`)
    return value
}

const shardA = new SQL(required('DATABASE_URL_A'))
const shardB = new SQL(required('DATABASE_URL_B'))

function hashUsername(username: string): number {
    let hash = 0x811c9dc5
    for (let i = 0; i < username.length; i++) {
        hash ^= username.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return hash >>> 0
}

export function shardFor(username: string): SQL {
    return hashUsername(username) % 2 === 0 ? shardA : shardB
}
