import 'dotenv/config';
import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import fs from "fs";
import path from "path";
import { parseMessage, executeCommand } from "./aiV2";

const { pathfinder } = pathfinderPkg;

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  app.use(express.json());

  let currentBot: mineflayer.Bot | null = null;
  let isBusy = false;

  const broadcast = (event: string, data?: any) => io.emit(event, data);
  const emitLog = (msg: string) => broadcast("log", msg);

  io.on("connection", (socket) => {
    socket.on("connect_bot", (config) => {
      if (currentBot) currentBot.end();
      isBusy = false;

      currentBot = mineflayer.createBot({
        host: config.host,
        port: parseInt(config.port, 10) || 25565,
        username: config.username || "Steve_AI",
        auth: config.auth || "offline",
        version: config.version || false,
      });

      currentBot.loadPlugin(pathfinder);

      currentBot.on("spawn", () => {
        emitLog("AI joined the game");
        broadcast("status", "connected");
        
        setInterval(() => {
          if (!currentBot?.inventory) return;
          broadcast("inventory", currentBot.inventory.items().map(item => ({
            name: item.name,
            displayName: item.displayName || item.name,
            count: item.count
          })));
          
          if (currentBot.entity?.position) {
            broadcast("position", {
              x: currentBot.entity.position.x.toFixed(1),
              y: currentBot.entity.position.y.toFixed(1),
              z: currentBot.entity.position.z.toFixed(1)
            });
          }
        }, 500);
      });

      currentBot.on("chat", async (username, message) => {
        broadcast("chat", { username, message });
        if (username === currentBot?.username) return;

        const command = parseMessage(message);
        if (command.type === "unknown") return;

        emitLog(`[CHAT] <${username}> ${message}`);

        if (isBusy) {
          currentBot?.chat("Attends, je suis occupé.");
          return;
        }

        isBusy = true;
        try {
          await executeCommand(currentBot!, command, emitLog);
        } catch (err: any) {
          emitLog(`[ERROR] ${err.message}`);
        } finally {
          isBusy = false;
        }
      });
    });

    socket.on("send_chat", (msg: string) => currentBot?.chat(msg));
    socket.on("disconnect_bot", () => { currentBot?.end(); isBusy = false; });
  });

  const projectRoot = process.cwd();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      root: projectRoot,
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      try {
        const indexPath = path.join(projectRoot, 'index.html');
        if (!fs.existsSync(indexPath)) return res.status(404).send(`Erreur : index.html introuvable`);
        
        const html = await vite.transformIndexHtml(req.originalUrl, fs.readFileSync(indexPath, 'utf-8'));
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    const distPath = path.join(projectRoot, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Serveur prêt sur http://localhost:${PORT}`);
  });
}

startServer();