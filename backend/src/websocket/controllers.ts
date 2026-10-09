import type { SnapRow } from '../repository/types'
import * as rabbitmq from '../rabbitmq/publisher'
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
// The four functions below go through rabbitmq/publisher.ts rather than
// emitting locally — the recipient can be connected to any instance, not just
// this one, and the exchange (see rabbitmq/consumer.ts) is what finds them.

export function sendSnapNotification(
    recipientUsername: string,
    snap: SnapRow,
    senderUsername: string
): void {
    rabbitmq.publishToUser(recipientUsername, 'snap_received', {
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
    rabbitmq.publishToUser(recipientUsername, 'friend_request', {
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
    const createdAt = new Date().toISOString()

    rabbitmq.publishToUser(accepterUsername, 'friend_accepted', {
        username: otherUsername,
        created_at: createdAt,
    })

    rabbitmq.publishToUser(otherUsername, 'friend_accepted', {
        username: accepterUsername,
        created_at: createdAt,
    })
}

// Goes to the sender of the snap, not to the person who took the screenshot.
export function sendScreenshotNotification(
    senderUsername: string,
    snapId: string,
    byUsername: string
): void {
    rabbitmq.publishToUser(senderUsername, 'screenshot_taken', {
        snap_id: snapId,
        by: byUsername,
        created_at: new Date().toISOString(),
    })
}

// Called only from rabbitmq/consumer.ts: a message arrived over the exchange
// for a user connected to THIS instance, so this is the one place that still
// emits locally rather than publishing back out. The event name is only known
// at runtime, so unlike the functions above this can't be typed any tighter
// than this without the caller doing it for us.
export function emitToUser(
    username: string,
    event: keyof ServerToClientEvents,
    payload: unknown
): void {
    getWebsocketServer()
        ?.to(userRoom(username))
        .emit(event, payload as never)
}
