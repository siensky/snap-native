// bcrypt via Bun's built-in Bun.password — no npm package needed.
// The salt is generated per-hash and stored inside the returned string,
// so a hash is the only thing the users table needs to keep.

// Work factor. Each +1 doubles the time to hash and to verify.
// 12 is roughly 250ms on a modern machine; drop to 10 if local dev feels slow.
const COST = 12

export async function hashPassword(plain: string): Promise<string> {
    return Bun.password.hash(plain, { algorithm: 'bcrypt', cost: COST })
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
    try {
        return await Bun.password.verify(plain, hash)
    } catch {
        // verify throws on a malformed hash rather than returning false.
        // On a login path that should just be a failed attempt, not a 500.
        return false
    }
}
