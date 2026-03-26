import type { RequestHandler } from "express";
import { failure } from "./types.js";

export function createAuthMiddleware(token: string): RequestHandler {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const parts = authHeader.split(" ");
      if (parts[0] === "Bearer" && parts[1] === token) {
        next();
        return;
      }
    }

    // Fall back to query param
    const queryToken = req.query.token as string | undefined;
    if (queryToken === token) {
      next();
      return;
    }

    res.status(401).json(failure("unauthorized: missing or invalid token"));
  };
}
