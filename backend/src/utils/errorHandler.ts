import type { FastifyInstance } from "fastify";
import { BaseError, InternalError } from "../errors";

function addGlobalErrorHandler(httpServer: FastifyInstance) {


    // Om funktionen nedan körs, så innebär det att ett fel har kastats någonstans
    // i vår applikation. Den har inte fångats upp någonstans, och har därför tagit sig upp
    // hela vägen hit. Eftersom vi har satt en error handler i fastify, så kommer fastify
    // fånga felet och förhindra att appen kraschar. Den kommer ge oss felet i nedanstående
    // funktion, samt även ge oss request och reply som felet uppstod i.
    httpServer.setErrorHandler((error: any, request, reply) => {
        // Det första vi kollar är huruvida felet är en instans av våran BaseError
        if (error instanceof BaseError) {
            // Vi omvandlar våran baseError till den publika varianten
            const publicError = error.toPublicError();

            // Och sedan returnerar vi detta tillbaka till klienten.
            return reply.status(error.statusCode).send(publicError);
        }

        // Om felet inte är en instans av våran BaseError innebär det att det är ett fel
        // som uppstått utanför våran kontroll. Eftersom vi inte vet isåfall vad det är,
        // så skapar vi en InternalError som är vår generiska fel ifall något oväntat uppstår som vi
        // inte vet. Vi väljer att inkludera originalfelet i våran InternalError.
        const unknownError = new InternalError("Unknown error", error);

        console.log("Unknown error occurred", unknownError);

        // Vi skickar felet till error-service

        // Vi returnerar felet tillbaka till klienten i en publik form.
        return reply
            .status(unknownError.statusCode)
            .send(unknownError.toPublicError());
    });
}

export default addGlobalErrorHandler;
