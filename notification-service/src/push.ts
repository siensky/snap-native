/**
 * Raw HTTP to Expo's push API — officially supported as an alternative to
 * expo-server-sdk (docs.expo.dev/push-notifications/sending-notifications),
 * and keeps this service dependency-free beyond amqplib.
 */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

type ExpoPushResult = { status: 'ok'; id: string } | { status: 'error'; message: string }

export async function sendPushNotification(tokens: string[], title: string, body: string): Promise<void> {
    if (tokens.length === 0) return

    const messages = tokens.map((to) => ({ to, title, body, sound: 'default' }))

    const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
    })

    if (!res.ok) {
        console.error(`Expo push request failed: ${res.status} ${res.statusText}`)
        return
    }

    const result = (await res.json()) as { data: ExpoPushResult[] }

    // Per-token errors (e.g. DeviceNotRegistered) land here rather than
    // failing the request — logged for now; pruning dead tokens from
    // push_tokens on DeviceNotRegistered is a natural follow-up, not required
    // by UPPGIFT.md.
    for (const [i, entry] of result.data.entries()) {
        if (entry.status === 'error') {
            console.error(`Push to ${tokens[i]} failed: ${entry.message}`)
        }
    }
}
