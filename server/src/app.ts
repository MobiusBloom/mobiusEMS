import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { env } from "./config/env.js";
import { isPostgresConnected } from "./persistence/postgres.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { verifyRequestOrigin } from "./middleware/security.js";
import { apiRouter } from "./routes/index.js";

export const createApp = (isReady: () => boolean = () => true) => {
  const app = express(); app.set("trust proxy", 1); app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: env.NODE_ENV === "production" ? undefined : false }));
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  app.use(compression()); app.use(express.json({ limit: "1mb" })); app.use(express.urlencoded({ extended: false, limit: "1mb" })); app.use(cookieParser());
  app.use(verifyRequestOrigin);
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 200, standardHeaders: "draft-7", legacyHeaders: false }));
  app.get("/api/health", (_request, response) => {
    const databaseConnected = isPostgresConnected();
    const ready = databaseConnected && isReady();
    response.status(ready ? 200 : 503).json({
      success: ready,
      message: ready ? "MobiusEMS API is healthy" : databaseConnected ? "Application is initializing" : "API is running but PostgreSQL is unavailable",
      database: databaseConnected ? "connected" : "disconnected"
    });
  });
  app.use("/api/v1", (_request, response, next) => {
    if (isReady()) return next();
    response.setHeader("Retry-After", "5");
    response.status(503).json({ success: false, message: "Application is initializing. Please retry shortly.", code: "APP_INITIALIZING" });
  }, apiRouter);
  app.use("/api", notFound);
  if (env.NODE_ENV === "production") {
    const dirname = path.dirname(fileURLToPath(import.meta.url)); const clientDist = path.resolve(dirname, "../../client/dist");
    app.use(express.static(clientDist, { index: false, maxAge: "1y", immutable: true }));
    app.get("*", (_request, response) => {
      response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      response.setHeader("Pragma", "no-cache");
      response.setHeader("Expires", "0");
      response.sendFile(path.join(clientDist, "index.html"));
    });
  } else app.use(notFound);
  app.use(errorHandler); return app;
};

