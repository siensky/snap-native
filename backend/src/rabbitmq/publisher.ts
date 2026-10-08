import { channel } from './connection'
import { EXCHANGE, PUSH_QUEUE, usernameFromRoutingKey, userRoutingKey, type PushPendingMessage, type QueueMessage } from './types'
import type { ChatMessagePayload, ServerToClientEvents } from '../websocket/types'

await channel.assertExchange(EXCHANGE, 'direct')
await channel.assertQueue(PUSH_QUEUE, { durable: true })

// mandatory:true makes RabbitMQ bounce a message back to us (the 'return'
// event below) instead of silently dropping it, whenever no queue is bound to
// its routing key — which is exactly "nobody is connected as this user right
// now". That's the offline signal, for free, straight from the exchange's own
// bindings (consumer.ts's bindUser/unbindUser) — no separate presence state.
channel.on('return', (msg) => {
    const { event, payload } = JSON.parse(msg.content.toString()) as QueueMessage

    // Only a chat message should ever become a push — see UPPGIFT.md punkt 5
    // ("den som är offline får en notis när ett meddelande kommer").
    if (event !== 'chat_message') return

    const username = usernameFromRoutingKey(msg.fields.routingKey)
    const chatPayload = payload as ChatMessagePayload

    const pending: PushPendingMessage = {
        username,
        sender_username: chatPayload.sender_username,
        body: chatPayload.body,
    }

    channel.sendToQueue(PUSH_QUEUE, Buffer.from(JSON.stringify(pending)), { persistent: true })
})

// Routed by username: whichever instance has that user bound (consumer.ts's
// bindUser) is the one that receives and delivers it.
export function publishToUser(
    username: string,
    event: keyof ServerToClientEvents,
    payload: unknown
): void {
    const message: QueueMessage = { event, payload }
    channel.publish(EXCHANGE, userRoutingKey(username), Buffer.from(JSON.stringify(message)), { mandatory: true })
}
