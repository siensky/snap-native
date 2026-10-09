import amqp from 'amqplib'

// Bun loads .env into process.env at startup. Fail here rather than on the
// first publish: a missing URL is a config mistake, not a runtime state.
const url = process.env.RABBITMQ_URL
if (!url) throw new Error('Set RABBITMQ_URL!')

const MAX_ATTEMPTS = 10
const RETRY_DELAY_MS = 2000

// A fresh `docker compose up` already waits for RabbitMQ's healthcheck
// (depends_on), but Docker's own restart-unless-stopped policy — what fires
// when Docker Desktop itself restarts — doesn't replay that ordering. Every
// container just comes back at once, and backend can easily reach this
// before RabbitMQ's listener is accepting connections. Retrying here instead
// of crashing on the first attempt means that's a few seconds of waiting
// instead of several restart-loop cycles.
async function connectWithRetry(connectionUrl: string) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return await amqp.connect(connectionUrl)
        } catch (error) {
            if (attempt === MAX_ATTEMPTS) throw error
            console.log(`[rabbitmq] connect attempt ${attempt}/${MAX_ATTEMPTS} failed, retrying...`)
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
        }
    }
    // Unreachable — the loop above always returns or throws.
    throw new Error('unreachable')
}

const connection = await connectWithRetry(url)
export const channel = await connection.createChannel()
