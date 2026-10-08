import type { FastifyInstance } from "fastify";
import * as controllers from './controllers'

async function routes(httpServer: FastifyInstance) {

    httpServer.route({
        method: 'POST',
        url: '/register',
        handler: controllers.register
    })

    httpServer.route({
        method: 'POST',
        url: '/login',
        handler: controllers.login
    })

    // Unauthenticated on purpose: the access token you'd authenticate with is
    // the thing that has expired. The refresh token in the body is the credential.
    httpServer.route({
        method: 'POST',
        url: '/refresh',
        handler: controllers.refresh
    })

    httpServer.route({
        method: 'GET',
        url: '/friends',
        preHandler: [httpServer.authenticate],
        handler: controllers.getFriends
    })

    // Static path, so it never collides with /friends/:username below.
    httpServer.route({
        method: 'GET',
        url: '/friends/requests',
        preHandler: [httpServer.authenticate],
        handler: controllers.getFriendRequests
    })

    httpServer.route({
        method: 'POST',
        url: '/friends',
        preHandler: [httpServer.authenticate],
        handler: controllers.addFriend
    })

    httpServer.route({
        method: 'DELETE',
        url: '/friends/:username',
        preHandler: [httpServer.authenticate],
        handler: controllers.deleteFriend
    })

    httpServer.route({
        method: 'POST',
        url: '/snaps',
        preHandler: [httpServer.authenticate],
        handler: controllers.sendSnap
    })

    httpServer.route({
        method: 'GET',
        url: '/snaps',
        preHandler: [httpServer.authenticate],
        handler: controllers.getInbox
    })

    // Destructive: this is the one and only read of a given snap.
    httpServer.route({
        method: 'GET',
        url: '/snaps/:id',
        preHandler: [httpServer.authenticate],
        handler: controllers.getSnap
    })

    httpServer.route({
        method: 'POST',
        url: '/snaps/:id/screenshot',
        preHandler: [httpServer.authenticate],
        handler: controllers.reportScreenshot
    })

    httpServer.route({
        method: 'POST',
        url: '/messages/:username',
        preHandler: [httpServer.authenticate],
        handler: controllers.sendMessage
    })

    httpServer.route({
        method: 'GET',
        url: '/messages/:username',
        preHandler: [httpServer.authenticate],
        handler: controllers.getMessages
    })

    httpServer.route({
        method: 'POST',
        url: '/push-token',
        preHandler: [httpServer.authenticate],
        handler: controllers.registerPushToken
    })

}

export default routes
