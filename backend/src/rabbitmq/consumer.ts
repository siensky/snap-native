import { channel } from './connection'
import { emitToUser } from '../websocket/controllers'
import { EXCHANGE, usernameFromRoutingKey, userRoutingKey, type QueueMessage } from './types'

await channel.assertExchange(EXCHANGE, 'direct')

// One queue per instance: exclusive to this connection, gone the moment the
// instance disconnects, so no stale bindings survive a restart.
const { queue } = await channel.assertQueue('', { exclusive: true })

await channel.consume(queue, (msg) => {
    if (!msg) return

    const { event, payload } = JSON.parse(msg.content.toString()) as QueueMessage

    // The routing key is this message's recipient, which is also who
    // bindUser() bound this queue to below.
    const username = usernameFromRoutingKey(msg.fields.routingKey)
    emitToUser(username, event, payload)

    channel.ack(msg)
})

export function bindUser(username: string): Promise<unknown> {
    return channel.bindQueue(queue, EXCHANGE, userRoutingKey(username))
}

export function unbindUser(username: string): Promise<unknown> {
    return channel.unbindQueue(queue, EXCHANGE, userRoutingKey(username))
}
