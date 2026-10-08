import fastify from "fastify";
import auth from "./auth";
import routes from "./http/routes";
import fastifyMultipart from "@fastify/multipart";
import addGlobalErrorHandler from "./utils/errorHandler";
import websocket from "./websocket";

const httpServer = fastify()

addGlobalErrorHandler(httpServer);

// attachFieldsToBody puts every part on request.body — the file included, still
// carrying .mimetype — instead of leaving them behind request.file(). Only
// multipart requests are touched: the plugin's preValidation hook returns early
// on anything else, so the JSON routes are unaffected.
await httpServer.register(fastifyMultipart, {
    attachFieldsToBody: true,
    limits: {
        // UPPGIFT.md: max 10 MB per snap.
        fileSize: 10_000_000,
        files: 1,
    },
});

await httpServer.register(auth);
await httpServer.register(routes);
await httpServer.register(websocket)

const port = Number(process.env.PORT ?? 3000);

await httpServer.listen({ port });

console.log(`Listening on http://localhost:${port}`);
