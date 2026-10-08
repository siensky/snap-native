import { startConsumer } from './src/rabbitmq'

await startConsumer()

console.log('notification-service: consuming push.pending')
