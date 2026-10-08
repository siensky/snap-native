export abstract class BaseError extends Error {
  abstract statusCode: number;
  full_error: unknown;
  params: Record<string, any>;

  constructor(message: string, params = {}, full_error = {}) {
    super(message); // Anropar vår parents (Error) konstruktor, och skickar in message

    this.params = params;
    this.full_error = full_error;
  }

  toPublicError() {
    return {
      success: false,
      code: this.statusCode,
      message: this.message,
    };
  }
}

export class InternalError extends BaseError {
  statusCode = 500;

  constructor(message: string = "Internal Server Error", full_error = {}) {
    super(message, full_error);
  }
}

export class Unauthorized extends BaseError {
  statusCode = 401;

  constructor(message: string = "You are not authorized", full_error = {}) {
    super(message, full_error);
  }
}

export class AlreadyExists extends BaseError {
  statusCode = 409;

  constructor(
    message: string = "The resource you are trying to create already exists.",
    full_error = {},
  ) {
    super(message, full_error);
  }
}

export class BadRequest extends BaseError {
  statusCode = 400;

  constructor(
    message: string = "Invalid request, please send all the required fields as expected.",
    full_error = {},
  ) {
    super(message, full_error);
  }
}



export class NotFound extends BaseError {
  statusCode = 404;

  constructor(message: string = "Not found", full_error = {}) {
    super(message, full_error);
  }
}

// Superclass och Subclass

// throw new BadRequest("Password is required")
// throw new NotFound("Account was not found for the given email")
