import { sql } from 'bun'

// A user can have more than one device, so more than one token.
export async function getPushTokensForUser(username: string): Promise<string[]> {
    const rows = await sql`
        SELECT pt.token
        FROM push_tokens pt
        JOIN users u ON u.id = pt.user_id
        WHERE u.username = ${username}
    `
    return (rows as { token: string }[]).map((row) => row.token)
}
