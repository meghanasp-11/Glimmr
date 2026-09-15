import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const allowedOrigins = new Set(
  (process.env["CORS_ORIGIN"] ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const requests = new Map<string, { count: number; resetAt: number }>();

app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  if (process.env["NODE_ENV"] === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use((req, res, next) => {
  const key = req.ip || "unknown";
  const now = Date.now();
  const entry = requests.get(key);
  const active = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + 15 * 60_000 };
  active.count += 1;
  requests.set(key, active);
  if (active.count > 100) {
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return;
  }
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    callback(new Error("Origin is not allowed by CORS policy"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86_400,
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.use("/api", router);

export default app;
