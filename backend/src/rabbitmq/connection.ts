import amqp from 'amqplib'

// Bun loads .env into process.env at startup. Fail here rather than on the
// first publish: a missing URL is a config mistake, not a runtime state.
const url = process.env.RABBITMQ_URL
if (!url) throw new Error('Set RABBITMQ_URL!')

const connection = await amqp.connect(url)
export const channel = await connection.createChannel()
