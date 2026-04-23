import app from "./app";
import { logger } from "./lib/logger";
import { initStreamer, initTastytrade } from "./lib/tastytrade.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  initTastytrade({ info: (m) => logger.info(m), warn: (m) => logger.warn(m) });
  initStreamer().catch((err) => logger.warn({ err }, "Tastytrade streamer init failed"));
});
