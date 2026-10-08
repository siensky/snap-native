import type { ServerToClientEvents } from '../websocket/types'

// Shared by publisher.ts and consumer.ts so they can never disagree on where
// messages go or what they look like.

export const EXCHANGE = 'chat.messages'

export type QueueMessage = {
    event: keyof ServerToClientEvents
    payload: unknown
}

// architecture.png: each instance binds this exchange with one routing key
// per connected username, shaped "message.user.<username>". The two
// functions are inverses, so a routing key can never drift from the format
// consumer.ts expects back out of it.
const ROUTING_KEY_PREFIX = 'message.user.'

export function userRoutingKey(username: string): string {
    return `${ROUTING_KEY_PREFIX}${username}`
}

export function usernameFromRoutingKey(routingKey: string): string {
    return routingKey.slice(ROUTING_KEY_PREFIX.length)
}

// A plain work queue, not an exchange: every backend instance publishes into
// it, notification-service is the only consumer. Durable so a pending push
// survives a notification-service restart.
export const PUSH_QUEUE = 'push.pending'

export type PushPendingMessage = {
    username: string
    // What chat_message's own payload already carries — see
    // websocket/types.ts's ChatMessagePayload. Not reused by reference
    // because the two are only coincidentally the same shape right now,
    // and notification-service doesn't depend on the backend's types.
    sender_username: string
    body: string
}
