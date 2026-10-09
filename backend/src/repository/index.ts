import type { SQL } from 'bun'
import { shardFor, shardsFor } from '../db/shards'
import type { AddFriendResult, ConversationEntry, CreateSnapInput, FriendListEntry, InboxEntry, IncomingFriendRequest, MessageRow, SnapRow, UserRow } from './types'

// Check if user exists
export async function userExists(username: string): Promise<boolean> {
    const rows = await shardFor(username)`
        SELECT 1 FROM users WHERE username = ${username}
    `
    return rows.length > 0
}

// Insert user
export async function insertUser(username: string, passwordHash: string): Promise<UserRow> {
    const [user] = await shardFor(username)`
        INSERT INTO users (username, password_hash)
        VALUES (${username}, ${passwordHash})
        RETURNING *
    `
    return user as UserRow
}

// Fetch user by username
export async function getUserByUsername(username: string): Promise<UserRow | null> {
    const [user] = await shardFor(username)`
        SELECT * FROM users WHERE username = ${username}
    `
    return (user as UserRow | undefined) ?? null
}

// Add a friend, by username at both ends — the JWT carries a username, not an id.
//
// friendUsername's account lives on ITS OWN home shard (users are never
// duplicated), so its existence is checked there, not here. The edge itself
// mentions both users, so it's written to every shard either of them calls
// home (shardsFor) — that's what lets getFriends/areFriends/
// getIncomingFriendRequests below stay single-shard reads for both parties.
// `friend_created_at` is snapshotted at write time for the same reason:
// getFriends can't join to a users row that might live on the other shard.
export async function addFriend(username: string, friendUsername: string): Promise<AddFriendResult> {
    const friend = await getUserByUsername(friendUsername)
    if (!friend) return { friend_exists: false, created: false, mutual: false }

    const home = shardFor(username)

    // Did they already add me? If so, that edge was duplicated onto my
    // shard when THEY called addFriend — no cross-shard query needed.
    const [reverse] = await home`
        SELECT 1 FROM friendships
        WHERE user_username = ${friendUsername} AND friend_username = ${username}
    `
    const mutual = !!reverse

    let created = false
    for (const shard of shardsFor([username, friendUsername])) {
        const [row] = await shard`
            INSERT INTO friendships (user_username, friend_username, friend_created_at)
            VALUES (${username}, ${friendUsername}, ${friend.created_at})
            ON CONFLICT DO NOTHING
            RETURNING 1
        `
        if (shard === home) created = !!row
    }

    return { friend_exists: true, created, mutual }
}

// Are these two actually friends? Requires the edge in both directions.
// Both directions are findable on MY shard alone: my outgoing edge lives here
// because I wrote it here, and their outgoing edge (if any) was duplicated
// here the moment they added me — see addFriend.
export async function areFriends(username: string, otherUsername: string): Promise<boolean> {
    const [row] = await shardFor(username)`
        SELECT (
            EXISTS (SELECT 1 FROM friendships WHERE user_username = ${username} AND friend_username = ${otherUsername})
            AND
            EXISTS (SELECT 1 FROM friendships WHERE user_username = ${otherUsername} AND friend_username = ${username})
        ) AS friends
    `
    return (row as { friends: boolean }).friends
}

// Remove a friend for a user. Idempotent — an unknown username or an edge
// that isn't there deletes zero rows without erroring. Removed from every
// shard the edge was written to, same set as addFriend used.
export async function deleteFriend(username: string, friendUsername: string): Promise<void> {
    for (const shard of shardsFor([username, friendUsername])) {
        await shard`
            DELETE FROM friendships
            WHERE user_username = ${username} AND friend_username = ${friendUsername}
        `
    }
}

// Everyone this user has added, each flagged with whether it's mutual.
// The reverse edge is a LEFT JOIN rather than an inner one, so rows survive
// when the other person hasn't added back — that's the pending case.
// Confirmed friends sort first.
export async function getFriends(username: string): Promise<FriendListEntry[]> {
    const rows = await shardFor(username)`
        SELECT
            f.friend_username AS username,
            f.friend_created_at AS created_at,
            (r.user_username IS NOT NULL) AS mutual
        FROM friendships f
        LEFT JOIN friendships r
               ON r.user_username = f.friend_username AND r.friend_username = f.user_username
        WHERE f.user_username = ${username}
        ORDER BY mutual DESC, f.friend_username
    `
    return rows as FriendListEntry[]
}

// Create a snap and fan it out to its recipients.
//
// A recipient's copy of the snap (and their snap_recipients row) only ever
// needs to exist on THEIR shard — nobody else reads it back. So this writes
// once per distinct recipient shard, each in its own local transaction
// (either the snap + that shard's recipient rows all land, or none do — but
// across shards there's no single atomic commit; a failure after the first
// shard's transaction succeeds leaves a partial fan-out, same tradeoff any
// non-2PC multi-database write has). id and created_at are generated once in
// application code, not left to each database's own default/now(), so every
// shard's copy of "the same" snap is identical rather than independently
// random.
export async function createSnap(input: CreateSnapInput): Promise<SnapRow> {
    const { senderUsername, type, expiresAt } = input

    // The (snap_id, recipient_username) primary key would reject a repeated
    // username.
    const recipients = [...new Set(input.recipientUsernames)]

    if (recipients.length === 0) {
        throw new Error('A snap needs at least one recipient')
    }

    // Required for text, an optional caption for photo.
    const body = input.body ?? null

    const id = crypto.randomUUID()
    const createdAt = new Date()

    const recipientsByShard = new Map<SQL, string[]>()
    for (const recipient of recipients) {
        const shard = shardFor(recipient)
        const list = recipientsByShard.get(shard)
        if (list) list.push(recipient)
        else recipientsByShard.set(shard, [recipient])
    }

    let row: SnapRow | undefined
    for (const [shard, shardRecipients] of recipientsByShard) {
        row = (await shard.begin(async (tx) => {
            const [snap] = await tx`
                INSERT INTO snaps (id, sender_username, type, body, expires_at, created_at)
                VALUES (${id}, ${senderUsername}, ${type}, ${body}, ${expiresAt}, ${createdAt})
                RETURNING *
            `

            for (const recipient of shardRecipients) {
                await tx`
                    INSERT INTO snap_recipients (snap_id, recipient_username)
                    VALUES (${id}, ${recipient})
                `
            }

            return snap
        })) as SnapRow
    }

    // recipients is non-empty, so recipientsByShard has at least one entry
    // and the loop above ran at least once.
    return row!
}

// Phase 2 of 2. Attach uploaded media to a photo snap that doesn't have any yet.
//
// The WHERE clause is the guard: it matches only a photo snap whose media_key is
// still null, so a retried or duplicated upload can't overwrite media already
// attached. Applied to every shard a recipient's copy landed on (see
// createSnap) — recipientUsernames is how this function knows which shards
// that is, since nothing else records it after the fact.
//
// The key should be random (crypto.randomUUID()), not the snap id: it travels
// inside every presigned URL, and a sequential id there would leak the snap count.
export async function setSnapMedia(
    snapId: string,
    mediaKey: string,
    mediaMime: string,
    recipientUsernames: string[]
): Promise<SnapRow | null> {
    let result: SnapRow | null = null

    for (const shard of shardsFor(recipientUsernames)) {
        const [row] = await shard`
            UPDATE snaps
            SET media_key = ${mediaKey}, media_mime = ${mediaMime}
            WHERE id = ${snapId}
              AND type = 'photo'
              AND media_key IS NULL
            RETURNING *
        `
        if (row) result = row as SnapRow
    }

    return result
}

// Read a snap once, and burn it in the same breath.
//
// Authorization and the one-shot stamp are a single statement on purpose. Split
// across a SELECT then an UPDATE, two concurrent requests both pass the check
// and both get the content. Here the second one blocks on the row lock, then
// re-evaluates `viewed_at IS NULL` against the row the first one just wrote and
// matches nothing — so exactly one caller ever sees a given snap.
//
// Zero rows (and so null) covers every failure the caller must not be able to
// tell apart: no such snap, not a recipient of it, already viewed, or expired.
// The service turns all of them into the same 404.
//
// Single-shard: a recipient's copy of a snap only ever exists on their own
// home shard (see createSnap), so there's nothing to look up elsewhere.
export async function claimSnapForRecipient(
    snapId: string,
    username: string
): Promise<SnapRow | null> {
    const [row] = await shardFor(username)`
        UPDATE snap_recipients sr
        SET viewed_at = now()
        FROM snaps s
        WHERE sr.snap_id = s.id
          AND sr.recipient_username = ${username}
          AND sr.snap_id = ${snapId}
          AND sr.viewed_at IS NULL
          AND s.expires_at > now()
        RETURNING s.*
    `
    return (row as SnapRow | undefined) ?? null
}

// Everything waiting for this user: not yet viewed, not yet expired.
//
// Metadata only — no body, no media_key. Listing the inbox must never be able to
// burn a snap, and the content is claimSnapForRecipient's job.
export async function getInboxForUser(username: string): Promise<InboxEntry[]> {
    const rows = await shardFor(username)`
        SELECT
            s.id,
            s.sender_username,
            s.type,
            s.created_at,
            s.expires_at
        FROM snap_recipients sr
        JOIN snaps s ON s.id = sr.snap_id
        WHERE sr.recipient_username = ${username}
          AND sr.viewed_at IS NULL
          AND s.expires_at > now()
        ORDER BY s.created_at DESC
    `
    return rows as InboxEntry[]
}

// Flag that a recipient screenshotted a snap, and report who sent it so the
// sender can be told. Returns null when the caller isn't a recipient of it,
// which is also what an unknown snap id looks like.
//
// Deliberately not gated on viewed_at: the screenshot arrives right after the
// view, and refusing it on a burnt snap would drop every real one.
export async function setScreenshot(
    snapId: string,
    username: string
): Promise<{ sender_username: string } | null> {
    const [row] = await shardFor(username)`
        UPDATE snap_recipients sr
        SET screenshot = TRUE
        FROM snaps s
        WHERE sr.snap_id = s.id
          AND sr.recipient_username = ${username}
          AND sr.snap_id = ${snapId}
        RETURNING s.sender_username
    `
    return (row as { sender_username: string } | undefined) ?? null
}

// People who added this user and haven't been added back — the pending incoming
// requests. UPPGIFT.md keeps these out of getFriends on purpose, so this is the
// mirror image of it: filter on friend_username instead of user_username, and
// the same LEFT JOIN against the reverse edge, kept only where that edge is
// missing. Single-shard for the same reason getFriends is — every edge naming
// this user was duplicated onto their own shard when it was written.
export async function getIncomingFriendRequests(username: string): Promise<IncomingFriendRequest[]> {
    const rows = await shardFor(username)`
        SELECT
            f.user_username AS username,
            f.created_at
        FROM friendships f
        LEFT JOIN friendships r
               ON r.user_username = f.friend_username AND r.friend_username = f.user_username
        WHERE f.friend_username = ${username}
          AND r.user_username IS NULL
        ORDER BY f.created_at DESC
    `
    return rows as IncomingFriendRequest[]
}

// client_id is the sender's idempotency key. ON CONFLICT turns a retried POST
// (same sender, same client_id) into a no-op write that still RETURNs the
// original row, so the caller can't tell a retry from the first attempt —
// enforced independently per shard copy, which is fine since a retry always
// carries the same client_id on every copy.
//
// Messages are immutable once written, so duplicating a copy onto both
// participants' shards (when they differ) needs no sync afterwards. id and
// created_at are generated once in application code so both copies describe
// the exact same message rather than two independently-timestamped ones —
// getMessages below orders by created_at, not id, since a uuid carries no
// chronological order the way the old bigserial id did.
export async function insertMessage(
    clientId: string,
    senderUsername: string,
    recipientUsername: string,
    body: string
): Promise<MessageRow | null> {
    const id = crypto.randomUUID()
    const createdAt = new Date()

    let result: MessageRow | null = null

    for (const shard of shardsFor([senderUsername, recipientUsername])) {
        const [row] = await shard`
            INSERT INTO messages (id, client_id, sender_username, recipient_username, body, created_at)
            VALUES (${id}, ${clientId}, ${senderUsername}, ${recipientUsername}, ${body}, ${createdAt})
            ON CONFLICT (sender_username, client_id) DO UPDATE SET body = messages.body
            RETURNING *
        `
        if (row) result = row as MessageRow
    }

    return result
}

// A page of the conversation between two users, newest first. Single-shard:
// a message between these two users was duplicated onto both of their home
// shards when it was sent (see insertMessage), so the caller's own shard
// always has a complete copy of the conversation — never a cross-shard join.
//
// `before` is exclusive: pass the oldest created_at from the previous page to
// get the next one back; omit it for the first page.
export async function getMessages(
    username: string,
    otherUsername: string,
    before: string | null,
    limit: number
): Promise<MessageRow[]> {
    const home = shardFor(username)

    const rows = before
        ? await home`
            SELECT * FROM messages
            WHERE ((sender_username = ${username} AND recipient_username = ${otherUsername})
                OR (sender_username = ${otherUsername} AND recipient_username = ${username}))
              AND created_at < ${before}
            ORDER BY created_at DESC
            LIMIT ${limit}
        `
        : await home`
            SELECT * FROM messages
            WHERE (sender_username = ${username} AND recipient_username = ${otherUsername})
               OR (sender_username = ${otherUsername} AND recipient_username = ${username})
            ORDER BY created_at DESC
            LIMIT ${limit}
        `
    return rows as MessageRow[]
}

// Re-registering the same token (app reinstall, re-login) reassigns it to
// whoever is calling now rather than erroring or leaving a stale owner.
// Single-shard: a push token belongs to exactly one user and is never read by
// anyone else, so — unlike friendships/snaps/messages — it's never duplicated.
export async function upsertPushToken(username: string, token: string): Promise<void> {
    await shardFor(username)`
        INSERT INTO push_tokens (token, user_id)
        SELECT ${token}, id FROM users WHERE username = ${username}
        ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id
    `
}

// The last message with every friend this user has ever exchanged one with,
// newest first. Single-shard, same reasoning as getMessages: every message
// touching this user was duplicated onto their own shard when it was sent.
//
// `unread` is true only when the last message is both from the other person
// (sending doesn't leave anything for ME to read) and newer than my own
// last-read mark for that conversation — no mark at all counts as unread.
export async function getConversations(username: string): Promise<ConversationEntry[]> {
    const rows = await shardFor(username)`
        WITH last_messages AS (
            SELECT DISTINCT ON (other_username) *
            FROM (
                SELECT
                    CASE WHEN sender_username = ${username} THEN recipient_username ELSE sender_username END AS other_username,
                    body,
                    sender_username,
                    created_at
                FROM messages
                WHERE sender_username = ${username} OR recipient_username = ${username}
            ) m
            ORDER BY other_username, created_at DESC
        )
        SELECT
            lm.other_username,
            lm.body AS last_message_body,
            lm.sender_username AS last_message_sender,
            lm.created_at AS last_message_at,
            (lm.sender_username <> ${username} AND lm.created_at > COALESCE(mr.last_read_at, '-infinity'))
                AS unread
        FROM last_messages lm
        LEFT JOIN message_reads mr
               ON mr.username = ${username} AND mr.other_username = lm.other_username
        ORDER BY lm.created_at DESC
    `
    return rows as ConversationEntry[]
}

// Called whenever `username` fetches the newest page of a conversation
// (services.getMessages) — that's "they saw the top of it", which is as
// close to a read receipt as this app tracks.
export async function markConversationRead(username: string, otherUsername: string): Promise<void> {
    await shardFor(username)`
        INSERT INTO message_reads (username, other_username, last_read_at)
        VALUES (${username}, ${otherUsername}, now())
        ON CONFLICT (username, other_username) DO UPDATE SET last_read_at = EXCLUDED.last_read_at
    `
}
