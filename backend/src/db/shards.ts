import { SQL } from 'bun'

// Two independent Postgres databases — see UPPGIFT.md punkt 7 / architecture.png's
// "DB Router". There's no separate router process (see the comment on
// shardFor below for why); this module IS the router, just in-process.

function required(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`Set ${name}!`)
    return value
}

export const shardA = new SQL(required('DATABASE_URL_A'))
export const shardB = new SQL(required('DATABASE_URL_B'))

const SHARDS = [shardA, shardB] as const

// FNV-1a: fast, deterministic, good-enough distribution for two buckets —
// this is sharding, not cryptography. Username rather than user id because
// it's the only thing every caller already has (JWT, URL params) before a
// single query runs; routing by id would mean looking the user up before
// knowing which database to look them up in.
function hashUsername(username: string): number {
    let hash = 0x811c9dc5
    for (let i = 0; i < username.length; i++) {
        hash ^= username.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return hash >>> 0
}

// The one place that decides where a user's home row lives. Every other
// shard-aware function in repository/index.ts is built out of this.
export function shardFor(username: string): SQL {
    return SHARDS[hashUsername(username) % 2]!
}

// Rows that mention two users (a friendship, a message) belong on the home
// shard of EVERY user they mention, deduplicated — so a read by either party
// is always a same-shard query, never a cross-database join. Order isn't
// meaningful here: callers write/delete on each returned shard the same way.
export function shardsFor(usernames: string[]): SQL[] {
    const seen = new Set<SQL>()
    for (const username of usernames) seen.add(shardFor(username))
    return [...seen]
}

export function allShards(): readonly SQL[] {
    return SHARDS
}
