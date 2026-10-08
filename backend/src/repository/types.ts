// Row types mirror db/migrations/ exactly — these are what Bun's Postgres
// driver actually hands back, so two mappings matter:
//
//   bigint / bigserial  ->  string   (int8 can exceed Number.MAX_SAFE_INTEGER)
//   timestamptz         ->  Date
//
// The bigint-as-string one bites: `row.id === 1` is always false, and
// `${row.id}` in a query is still correct because the driver re-encodes it.

export type UserRow = {
    id: string
    username: string
    password_hash: string
    created_at: Date
}

// A user as it's safe to hand to other users. No password_hash, and no id —
// ids are sequential and never leave the backend. username is the public
// identifier, so repo methods take usernames and resolve them in SQL.
export type PublicUser = Pick<UserRow, 'username' | 'created_at'>

// What addFriend reports back.
//   friend_exists — the username being added resolved to a real user
//   created       — this call inserted a new edge (false on a repeat add)
//   mutual        — the other person had already added you, so you're now friends
// When friend_exists is false nothing was written and the other two are false.
export type AddFriendResult = {
    friend_exists: boolean
    created: boolean
    mutual: boolean
}

// An entry in a user's friend list. `mutual` is false while the other person
// hasn't added back — i.e. an outgoing request that hasn't been accepted.
export type FriendListEntry = PublicUser & {
    mutual: boolean
}

// Someone who added you and whom you haven't added back — the third row of the
// friendship table in UPPGIFT.md, the one deliberately absent from getFriends.
//
// Unlike FriendListEntry, created_at here is when the *request* was made
// (friendships.created_at), not when the account was created: a request list is
// sorted and read by recency of the request.
export type IncomingFriendRequest = {
    username: string
    created_at: Date
}

export type SnapType = 'text' | 'photo'

// The arguments to createSnap, as one named object rather than five positional
// params. The embedded union keeps the CHECK's one remaining rule at compile
// time: a text snap must have a body, a photo's body is an optional caption.
export type CreateSnapInput = {
    senderUsername: string
    recipientUsernames: string[]
    expiresAt: Date
} & (
        | { type: 'text'; body: string }
        | { type: 'photo'; body?: string | null }
    )

// Exactly the columns of the snaps table, nothing more. createSnap and
// setSnapMedia both RETURNING * from snaps, so anything not in the table would
// be undefined at runtime while typed as present.
export type SnapRow = {
    id: string
    sender_id: string
    type: SnapType
    body: string | null
    media_key: string | null
    media_mime: string | null
    expires_at: Date
    created_at: Date
}

// A snap read back with its sender resolved. Only the read path joins users, so
// only the read path gets this — see claimSnapForRecipient.
export type SnapWithSender = SnapRow & {
    sender_username: string
}

// One entry in a user's inbox. Metadata only: listing what's waiting must never
// hand back body or media_key, or a list call would burn a one-shot snap.
export type InboxEntry = {
    id: string
    sender_username: string
    type: SnapType
    created_at: Date
    expires_at: Date
}

export type SnapRecipientRow = {
    snap_id: string
    recipient_id: string
    screenshot: boolean
    viewed_at: Date | null
}

export type FriendshipRow = {
    user_id: string
    friend_id: string
    created_at: Date
}

export type MessageRow = {
    id: string
    client_id: string
    sender_id: string
    recipient_id: string
    body: string
    created_at: Date
}

// The read path joins the sender's username in — same split as
// SnapRow/SnapWithSender, and for the same reason: nothing public should ever
// carry a bare numeric id.
export type MessageWithSender = MessageRow & {
    sender_username: string
}

// SnapRow keeps every optional column nullable because the columns are.
// Map to this union at the repository boundary so the rest of the app narrows
// on `type` instead of null-checking columns that don't apply.

type SnapBase = {
    id: string
    sender_id: string
    expires_at: Date
    created_at: Date
}

export type Snap =
    | (SnapBase & { type: 'text'; body: string })
    | (SnapBase & {
        type: 'photo'
        body: string | null
        // Null between createSnap and setSnapMedia — the upload hasn't landed
        // yet, or never did. The read path should skip these.
        media_key: string | null
        media_mime: string | null
    })

export function toSnap(row: SnapRow): Snap {
    const base: SnapBase = {
        id: row.id,
        sender_id: row.sender_id,
        expires_at: row.expires_at,
        created_at: row.created_at,
    }

    // body is guaranteed non-null for text by the CHECK constraint.
    return row.type === 'text'
        ? { ...base, type: 'text', body: row.body! }
        : {
            ...base,
            type: 'photo',
            body: row.body,
            media_key: row.media_key,
            media_mime: row.media_mime,
        }
}
