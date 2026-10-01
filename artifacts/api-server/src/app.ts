import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
const configuredOrigins = new Set(
  (process.env.DASHBOARD_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
);
function isDashboardOrigin(origin: string): boolean {
  if (configuredOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    const secure = url.protocol === "https:";
    if (!secure && process.env.NODE_ENV !== "development") return false;
    return host === "afuchat.com" || host.endsWith(".afuchat.com") ||
      (process.env.NODE_ENV === "development" && (host.endsWith(".replit.dev") || host.endsWith(".replit.app")));
  } catch {
    return false;
  }
}
app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, false);
      return;
    }
    callback(null, isDashboardOrigin(origin) ? origin : false);
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Afu-CSRF"],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", router);

app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Keep unexpected route failures from becoming Express's HTML error page.
// Clients always receive a stable JSON response, while the server log keeps
// the diagnostic details for debugging.
app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  logger.error({
    operation: "http.request",
    method: req.method,
    path: req.path,
    error: error instanceof Error ? error.message : String(error),
  }, "Unhandled API error");

  res.status(500).json({ error: "Internal server error" });
});

export default app;
