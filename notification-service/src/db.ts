import { shardFor } from './shards'

// push_tokens is never duplicated across shards (see backend/src/db/shards.ts) —
// a user's tokens always live on their own home shard.
export async function getPushTokensForUser(username: string): Promise<string[]> {
    const rows = await shardFor(username)`
        SELECT pt.token
        FROM push_tokens pt
        JOIN users u ON u.id = pt.user_id
        WHERE u.username = ${username}
    `
    return (rows as { token: string }[]).map((row) => row.token)
}
