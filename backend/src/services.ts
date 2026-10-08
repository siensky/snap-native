import { AlreadyExists, BadRequest, NotFound, Unauthorized } from './errors'
import type { AddFriendResponse, ApiFriend, ApiFriendRequest, ApiMessage, ApiSnap, ApiSnapSummary, ApiUser, AuthRequest, GetMessagesResponse, SendMessageResponse, SendSnapResponse } from './http/types'
import * as repository from './repository'
import { hashPassword, verifyPassword } from './utils/password';
import * as s3 from './utils/s3'
import * as websocket from './websocket/controllers'
import * as rabbitmq from './rabbitmq/publisher'

// Shared by sendSnap and sendMessage: both require an existing, accepted
// (mutual) friendship between the two usernames. Exported so any future
// friends-only feature can reuse it instead of re-querying areFriends itself.
export async function assertFriends(username: string, otherUsername: string): Promise<void> {
    const friends = await repository.areFriends(username, otherUsername)
    if (!friends) throw new BadRequest(`You are not friends with ${otherUsername}`)
}

// Idempotent
export async function register(authRequest: AuthRequest): Promise<ApiUser> {
    // Om användaren finns
    const exists = await repository.userExists(authRequest.username)

    if (exists) throw new AlreadyExists("User already exists");

    // Hasha lösenord
    const passwordHash = await hashPassword(authRequest.password)

    // Skapa användaren
    const user = await repository.insertUser(authRequest.username, passwordHash)

    // Utfärda tokens

    return {
        username: user.username,
        created_at: user.created_at.toISOString()
    }
    // Hasha lösenordet
}

export async function login(authRequest: AuthRequest): Promise<ApiUser> {
    // Kontrollera användarnamn och lösenord
    const user = await repository.getUserByUsername(authRequest.username)

    if (!user) throw new NotFound("User not found");

    const validPassword = await verifyPassword(authRequest.password, user.password_hash);

    if (!validPassword) throw new Unauthorized("Invalid password!")

    return {
        username: user.username,
        created_at: user.created_at.toISOString()
    }
}

export async function addFriend(
    username: string,
    friendUsername: string
): Promise<AddFriendResponse> {
    // Usernames are unique, so this is an exact self-add check — and it saves
    // the DB throwing check (user_id <> friend_id) as an unhandled 500.
    if (username === friendUsername) {
        throw new BadRequest("You can't add yourself as a friend")
    }

    const { friend_exists, created, mutual } = await repository.addFriend(username, friendUsername)

    if (!friend_exists) throw new NotFound('User not found')

    // Only on a genuinely new edge. A client re-sending the same add is a no-op
    // in the database, and it shouldn't re-notify the other person either.
    if (created) {
        if (mutual) {
            // This add was the second of the two directed edges, so it's an
            // acceptance: both sides just became friends.
            websocket.sendFriendAcceptedNotification(username, friendUsername)
        } else {
            websocket.sendFriendRequestNotification(friendUsername, username)
        }
    }

    return { status: mutual ? 'friends' : 'pending' }
}

// Everyone who has added this user without being added back. Deliberately a
// separate call from getFriends — UPPGIFT.md keeps these out of GET /friends.
export async function getFriendRequests(username: string): Promise<ApiFriendRequest[]> {
    const requests = await repository.getIncomingFriendRequests(username)

    return requests.map((request) => ({
        username: request.username,
        created_at: request.created_at.toISOString(),
    }))
}

// Idempotent — removing someone who isn't a friend is a no-op, not an error.
// Only your own edge goes; if they still have you added, you become a pending
// incoming request to them.
export async function deleteFriend(username: string, friendUsername: string): Promise<void> {
    await repository.deleteFriend(username, friendUsername)
}

export async function getFriends(username: string): Promise<ApiFriend[]> {
    const friends = await repository.getFriends(username)

    return friends.map((friend) => ({
        username: friend.username,
        created_at: friend.created_at.toISOString(),
        mutual: friend.mutual,
    }))
}

type TextContent = {
    text: string
}/*  */

type ImageContent = {
    src: string
}

type Snap = {
    type: 'photo' | 'text',
    content: ImageContent | TextContent
    sender_id: string
    created_at: string
}


const SNAP_TTL_MS = 24 * 60 * 60 * 1000 // 24 timmar

// The arguments to sendSnap, mirroring CreateSnapInput in repository/types.ts.
// The union is the point: "a photo carries an image, a text snap carries a body"
// becomes a compile-time fact instead of a runtime BadRequest.
export type SendSnapInput = {
    senderUsername: string
    recipients: string[]
} & (
        | { type: 'text'; body: string }
        | { type: 'photo'; body?: string | null; image: Buffer; mimetype: string }
    )

// Anropas av HTTP-controllern. Websocketen skickar bara notiser, den skriver inte.
export async function sendSnap(input: SendSnapInput): Promise<SendSnapResponse> {
    const { senderUsername, recipients } = input

    if (recipients.length === 0) throw new BadRequest('A snap needs at least one recipient')

    // Du kan bara snappa dina vänner — annars kan vem som helst snappa vem som helst.
    for (const recipient of new Set(recipients)) {
        await assertFriends(senderUsername, recipient)
    }

    // Först spara i databasen
    const expiresAt = new Date(Date.now() + SNAP_TTL_MS)

    const base = {
        senderUsername,
        recipientUsernames: recipients,
        expiresAt,
    }

    // Spara initiala snapen i db (utan filen)
    const createdSnap = input.type === 'text'
        ? await repository.createSnap({ ...base, type: 'text', body: input.body })
        : await repository.createSnap({ ...base, type: 'photo', body: input.body ?? null })

    // Ladda upp filen på S3 och uppdatera snapen i db.
    if (input.type === 'photo') {
        // Random, never the snap id: the key travels inside every presigned URL,
        // and a sequential id there would leak how many snaps exist.
        const key = crypto.randomUUID()

        await s3.uploadFile(key, input.image, input.mimetype)

        await repository.setSnapMedia(createdSnap.id, key, input.mimetype)
    }

    // Notify last, once the snap is durable. A recipient who is offline finds it
    // through GET /snaps instead, so a missed emit costs nothing.
    for (const recipient of new Set(recipients)) {
        websocket.sendSnapNotification(recipient, createdSnap, senderUsername)
    }

    return {
        snap_id: createdSnap.id,
        expires_at: createdSnap.expires_at.toISOString(),
    }
}

// Snap ids are bigserial. A non-numeric id would make Postgres throw on the
// cast — a 500 — instead of simply matching no rows, so it's rejected up front
// as the same 404 every other miss produces.
function assertSnapId(snapId: string): void {
    if (!/^\d+$/.test(snapId)) throw new NotFound('Snap not found')
}

// Read a snap once. The read is destructive: claimSnapForRecipient stamps
// viewed_at in the same statement that authorizes the read, so a second call
// gets nothing and two concurrent calls can't both win.
export async function getSnap(username: string, snapId: string): Promise<ApiSnap> {
    assertSnapId(snapId)

    const snap = await repository.claimSnapForRecipient(snapId, username)

    // One 404 for every reason it could fail — no such snap, not addressed to
    // you, already viewed, expired. Telling them apart would let anyone probe
    // which sequential ids exist.
    if (!snap) throw new NotFound('Snap not found')

    const base = {
        id: snap.id,
        sender_username: snap.sender_username,
        body: snap.body ?? undefined,
        created_at: snap.created_at.toISOString(),
        expires_at: snap.expires_at.toISOString(),
    }

    if (snap.type === 'text') {
        return { ...base, type: 'text' }
    }

    return {
        ...base,
        type: 'photo',
        // Null when the S3 upload never landed. The snap row still exists, so
        // hand back what there is rather than failing the whole read.
        media_url: snap.media_key ? s3.getPresignedUrl(snap.media_key) : undefined,
    }
}

// What's waiting for this user. Metadata only — reading a snap's content is
// getSnap's job, and it burns the snap.
export async function getInbox(username: string): Promise<ApiSnapSummary[]> {
    const snaps = await repository.getInboxForUser(username)

    return snaps.map((snap) => ({
        id: snap.id,
        type: snap.type,
        sender_username: snap.sender_username,
        created_at: snap.created_at.toISOString(),
        expires_at: snap.expires_at.toISOString(),
    }))
}

// The recipient screenshotted a snap; tell whoever sent it.
export async function reportScreenshot(username: string, snapId: string): Promise<void> {
    assertSnapId(snapId)

    const snap = await repository.setScreenshot(snapId, username)

    if (!snap) throw new NotFound('Snap not found')

    websocket.sendScreenshotNotification(snap.sender_username, snapId, username)
}

export type SendMessageInput = {
    senderUsername: string
    recipientUsername: string
    // The sender's idempotency key — see repository.insertMessage.
    clientId: string
    body: string
}

// Anropas av HTTP-controllern, precis som sendSnap: meddelandet skrivs till
// Postgres här, leveransen (live via websocket, oavsett instans) sker genom
// rabbitmq/publisher.ts.
export async function sendMessage(input: SendMessageInput): Promise<SendMessageResponse> {
    const { senderUsername, recipientUsername, clientId, body } = input

    if (!body.trim()) throw new BadRequest('Message body is required')

    await assertFriends(senderUsername, recipientUsername)

    const message = await repository.insertMessage(clientId, senderUsername, recipientUsername, body)

    // Only reachable if recipientUsername stopped existing between the
    // assertFriends check above and this insert — every other case was
    // already rejected as "not friends".
    if (!message) throw new NotFound('User not found')

    rabbitmq.publishToUser(recipientUsername, 'chat_message', {
        id: message.id,
        sender_username: senderUsername,
        body: message.body,
        created_at: message.created_at.toISOString(),
    })

    return {
        id: message.id,
        created_at: message.created_at.toISOString(),
    }
}

// Idempotent — registering the same token twice (app restart, re-login) is a
// no-op write, not an error.
export async function registerPushToken(username: string, token: string): Promise<void> {
    if (!token.trim()) throw new BadRequest('token is required')

    await repository.upsertPushToken(username, token)
}

const MESSAGES_PAGE_SIZE = 50

function toApiMessage(message: Awaited<ReturnType<typeof repository.getMessages>>[number]): ApiMessage {
    return {
        id: message.id,
        sender_username: message.sender_username,
        body: message.body,
        created_at: message.created_at.toISOString(),
    }
}

// One page of history between the caller and `otherUsername`, newest first.
// Gated the same as sendMessage: you can only read a conversation you could
// also send into.
export async function getMessages(
    username: string,
    otherUsername: string,
    before: string | null
): Promise<GetMessagesResponse> {
    await assertFriends(username, otherUsername)

    const messages = await repository.getMessages(username, otherUsername, before, MESSAGES_PAGE_SIZE)

    return {
        messages: messages.map(toApiMessage),
        // Fewer rows than the page size means there's nothing older left.
        next_cursor: messages.length === MESSAGES_PAGE_SIZE ? messages[messages.length - 1]!.id : null,
    }
}

