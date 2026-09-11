import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import clickAccount from "./Applications/clickAccount.js";
import leaveAccount from "./Applications/leaveAccount.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");

function getAccounts() {
  if (fs.existsSync(ACCOUNTS_FILE)) {
    try {
      const data = fs.readFileSync(ACCOUNTS_FILE, "utf-8");
      return JSON.parse(data);
    } catch (err) {
      console.error("Error reading accounts.json:", err);
      return [];
    }
  }
  return [];
}

function saveAccounts(accounts) {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing accounts.json:", err);
  }
}

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // API Endpoints
  if (url.pathname === "/api/accounts") {
    if (req.method === "GET") {
      const accounts = getAccounts();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(accounts));
      return;
    } else if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const newAccount = JSON.parse(body);
          const accounts = getAccounts();
          const existingIdx = accounts.findIndex((a) => a.account === newAccount.account);
          if (existingIdx >= 0) {
            accounts[existingIdx] = { ...accounts[existingIdx], ...newAccount };
          } else {
            accounts.push(newAccount);
          }
          saveAccounts(accounts);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(newAccount));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON payload" }));
        }
      });
      return;
    } else if (req.method === "DELETE") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { account } = JSON.parse(body);
          let accounts = getAccounts();
          accounts = accounts.filter((a) => a.account !== account);
          saveAccounts(accounts);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON payload" }));
        }
      });
      return;
    }
  }

  // Static File Serving
  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

let client;
const maxConcurrency = 50;
let activeRequests = 0;
const queue = [];

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3006;
server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});

io.on("connection", async (socket) => {
  client = socket;
  console.log("New server connection");

  socket.onAny((event, ...args) => {
    console.log(event, args);
  });

  socket.on("click", async (data) => {
    let { account, password, rank, battleLink, side, tankiConfig, proxyUrl } = data;
    side = side == "Alpha" ? "A" : side == "Bravo" ? "B" : "J";
    queue.push({ account, password, rank, battleLink, side, socket, tankiConfig: JSON.parse(tankiConfig), proxyUrl });
    socket.emit("update-status", { account: account, status: "Queue" });
    processQueue();
  });

  socket.on("unglitch-account", async (data) => {
    const { account, password, tankiConfig, proxyUrl } = data;
    socket.emit("update-status", { account: account, status: "Unglitching" });
    leaveAccount(account, password, true, null, socket, JSON.parse(tankiConfig), proxyUrl);
  });

  socket.on("restart-clicker", async (data) => {
    // Restarts pm2
    socket.emit("new-message", { color: "green", message: `Clicker ${data} was restarted.` });
    process.exit();
  });
});

async function processQueue() {
  if (activeRequests >= maxConcurrency || queue.length === 0) {
    return;
  }

  const batchCount = Math.min(maxConcurrency - activeRequests, queue.length);
  const batch = queue.splice(0, batchCount);
  activeRequests += batchCount;

  await (async () => {
    await Promise.all(
      batch.map(async ({ account, password, rank, battleLink, side, socket, tankiConfig, proxyUrl }) => {
        try {
          console.log(`Processing account: ${account}`);
          await clickAccount(account, password, rank, battleLink, side, socket, tankiConfig, proxyUrl);
          console.log(`Successfully processed account: ${account}`);
        } catch (error) {
          console.log(`Error processing account: ${account}`);
          console.error(error);
        } finally {
          activeRequests--;
        }
      })
    );
  })();

  processQueue(); // Call processQueue after the batch has been processed
}

function updateStatus(account, status) {
  if (client) {
    client.emit("update-status", { account: account, status: status });
  }
}

export default updateStatus;
