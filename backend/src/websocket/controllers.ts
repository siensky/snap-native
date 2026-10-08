import type { SnapRow } from '../repository/types'
import { getWebsocketServer, userRoom } from './server'
import type { ServerToClientEvents } from './types'

// Every emit in the app goes through this file. Nothing else touches the socket
// server, so replacing socket.io with @fastify/websocket (UPPGIFT.md item 15)
// means rewriting this file and index.ts — and nothing in services.ts.
//
// These are notifications, not delivery. The snap or friendship is already
// committed to Postgres by the time one is sent; a recipient who is offline
// finds it through GET /snaps or GET /friends/requests instead. So emitting is
// fire-and-forget: never awaited, and it never throws into the request path.
//
// Payloads are plain objects — socket.io serializes them itself, so
// JSON.stringify here would make the client parse a string out of a string.

export function sendSnapNotification(
    recipientUsername: string,
    snap: SnapRow,
    senderUsername: string
): void {
    getWebsocketServer()
        ?.to(userRoom(recipientUsername))
        .emit('snap_received', {
            snap_id: snap.id,
            sender_username: senderUsername,
            type: snap.type,
            created_at: snap.created_at.toISOString(),
            expires_at: snap.expires_at.toISOString(),
        })
}

// Someone added you and you haven't added them back.
export function sendFriendRequestNotification(
    recipientUsername: string,
    fromUsername: string
): void {
    getWebsocketServer()
        ?.to(userRoom(recipientUsername))
        .emit('friend_request', {
            from: fromUsername,
            created_at: new Date().toISOString(),
        })
}

// The second of the two directed edges just landed, so both sides go from
// pending to friends at the same moment and both need telling.
export function sendFriendAcceptedNotification(
    accepterUsername: string,
    otherUsername: string
): void {
    const server = getWebsocketServer()
    if (!server) return

    const createdAt = new Date().toISOString()

    server.to(userRoom(accepterUsername)).emit('friend_accepted', {
        username: otherUsername,
        created_at: createdAt,
    })

    server.to(userRoom(otherUsername)).emit('friend_accepted', {
        username: accepterUsername,
        created_at: createdAt,
    })
}

// For events coming from another backend instance via RabbitMQ (rabbitmq/consumer.ts):
// the event name is only known at runtime, so unlike the functions above this
// can't be typed any tighter than this without the caller doing it for us.
export function emitToUser(
    username: string,
    event: keyof ServerToClientEvents,
    payload: unknown
): void {
    getWebsocketServer()
        ?.to(userRoom(username))
        .emit(event, payload as never)
}

// Goes to the sender of the snap, not to the person who took the screenshot.
export function sendScreenshotNotification(
    senderUsername: string,
    snapId: string,
    byUsername: string
): void {
    getWebsocketServer()
        ?.to(userRoom(senderUsername))
        .emit('screenshot_taken', {
            snap_id: snapId,
            by: byUsername,
            created_at: new Date().toISOString(),
        })
}
