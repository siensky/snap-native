import type { SnapType } from '../repository/types'

// The socket is push-only: the server tells connected clients that something
// happened, and every write still goes over HTTP. So there is one events map
// that matters, and it points server -> client.
//
// Payloads carry `sender_username`, never `sender_id` — ids are sequential and
// never leave the backend (see the note on PublicUser in repository/types.ts).
// Timestamps are ISO strings, matching what the HTTP layer sends.

export type SnapReceivedPayload = {
    snap_id: string
    sender_username: string
    type: SnapType
    created_at: string
    expires_at: string
}

export type FriendRequestPayload = {
    // Who added you. Accepting is a POST /friends back at them.
    from: string
    created_at: string
}

export type FriendAcceptedPayload = {
    // The other party in the now-mutual friendship.
    username: string
    created_at: string
}

export type ScreenshotTakenPayload = {
    snap_id: string
    // Who took it.
    by: string
    created_at: string
}

export type ChatMessagePayload = {
    id: string
    sender_username: string
    body: string
    created_at: string
}

// Written as type aliases, not interfaces, on purpose: socket.io constrains
// these to EventsMap (`{ [event: string]: any }`), and TypeScript only gives
// implicit index signatures to type aliases.
export type ServerToClientEvents = {
    snap_received: (payload: SnapReceivedPayload) => void
    friend_request: (payload: FriendRequestPayload) => void
    friend_accepted: (payload: FriendAcceptedPayload) => void
    screenshot_taken: (payload: ScreenshotTakenPayload) => void
    chat_message: (payload: ChatMessagePayload) => void
}

// Nothing is accepted from clients. Reserved events like `disconnect` are typed
// separately by socket.io and still work.
export type ClientToServerEvents = Record<string, never>

export type InterServerEvents = Record<string, never>

// Set once, by the handshake middleware, from the verified JWT.
export type SocketData = {
    username: string
}
