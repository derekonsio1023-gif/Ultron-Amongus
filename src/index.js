const HTTP_TARGETS = {
  "/api": "https://api.realauad.com",
  "/na":  "https://na.realauad.com",
  "/eu":  "https://eu.realauad.com",
};

// Para WebSocket, el servidor de AUAD escucha en el puerto 22023
const WS_TARGETS = {
  "/api": "https://api.realauad.com",
  "/na":  "https://na.realauad.com:22023",
  "/eu":  "https://eu.realauad.com:22023",
};

const ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";

function findTarget(pathname, isWebSocket) {
  const targets = isWebSocket ? WS_TARGETS : HTTP_TARGETS;
  for (const [prefix, origin] of Object.entries(targets)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return { origin, path: pathname.slice(prefix.length) || "/" };
    }
  }
  return null;
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const isWebSocket = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
    const destination = findTarget(url.pathname, isWebSocket);

    // ... el resto igual
  }
};
