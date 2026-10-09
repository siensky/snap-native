import { describe, expect, test } from 'bun:test'

import { usernameFromRoutingKey, userRoutingKey } from './types'

describe('userRoutingKey / usernameFromRoutingKey', () => {
    test('round-trips a username', () => {
        expect(usernameFromRoutingKey(userRoutingKey('alice'))).toBe('alice')
    })

    test('round-trips a username containing dots', () => {
        // Routing keys are themselves dot-separated, so a username with dots in
        // it is the case most likely to break a naive prefix-strip.
        expect(usernameFromRoutingKey(userRoutingKey('a.b.c'))).toBe('a.b.c')
    })

    test('produces the "message.user.<username>" shape from architecture.png', () => {
        expect(userRoutingKey('alice')).toBe('message.user.alice')
    })
})
