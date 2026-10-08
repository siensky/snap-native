import amqp from 'amqplib'

import { getPushTokensForUser } from './db'
import { sendPushNotification } from './push'

// Must match backend/src/rabbitmq/types.ts's PUSH_QUEUE and PushPendingMessage
// exactly — this is the one contract between the two services, and there's no
// shared package between them to enforce it at compile time.
const PUSH_QUEUE = 'push.pending'

type PushPendingMessage = {
    username: string
    sender_username: string
    body: string
}

export async function startConsumer(): Promise<void> {
    const url = process.env.RABBITMQ_URL
    if (!url) throw new Error('Set RABBITMQ_URL!')

    const connection = await amqp.connect(url)
    const channel = await connection.createChannel()

    await channel.assertQueue(PUSH_QUEUE, { durable: true })

    await channel.consume(PUSH_QUEUE, (msg) => {
        if (!msg) return

        void (async () => {
            const pending = JSON.parse(msg.content.toString()) as PushPendingMessage

            const tokens = await getPushTokensForUser(pending.username)
            await sendPushNotification(tokens, pending.sender_username, pending.body)

            channel.ack(msg)
        })()
    })
}
