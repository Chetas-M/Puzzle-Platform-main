import { createApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./prisma.js";

const app = createApp({ prisma, config });

const server = app.listen(config.API_PORT, "0.0.0.0", () => {
  console.log(`MVP API listening on 0.0.0.0:${config.API_PORT}`);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
});
