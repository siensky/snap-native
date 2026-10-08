import type { Server } from 'socket.io'
import type {
    ClientToServerEvents,
    InterServerEvents,
    ServerToClientEvents,
    SocketData,
} from './types'

export type SnapSocketServer = Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>

// The live server handle lives here, in a module that imports nothing of ours,
// so index.ts (which creates it) and controllers.ts (which emits through it) can
// both reach it without importing each other. They used to, and that was the
// one import cycle in the codebase.
let websocketServer: SnapSocketServer | null = null

export function setWebsocketServer(server: SnapSocketServer): void {
    websocketServer = server
}

// Null until websocket() has run — and in any context that never starts one,
// such as a script importing services directly. Callers emit through `?.` so
// that case is a no-op rather than a crash.
export function getWebsocketServer(): SnapSocketServer | null {
    return websocketServer
}

// Every user gets a room named after them, which is how services address a
// person without tracking socket ids: multiple devices join the same room, and
// socket.io removes each socket on disconnect.
//
// Prefixed so a username can never collide with another kind of room if one is
// added later (a group chat, say). Join and emit both go through this, so they
// cannot drift apart.
export function userRoom(username: string): string {
    return `user:${username}`
}
