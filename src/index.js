
const TARGETS = {
  "/api": "https://api.realauad.com",
  "/na": "https://na.realauad.com",
  "/eu": "https://eu.realauad.com",
};

const ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization";

function findTarget(pathname) {
  for (const [prefix, origin] of Object.entries(TARGETS)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      const path = pathname.slice(prefix.length) || "/";
      return { prefix, origin, path };
    }
  }

  return null;
}

function addCors(headers) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  headers.delete("Access-Control-Allow-Credentials");
  return headers;
}

function upstreamHeaders(request, websocket = false) {
  const headers = new Headers(request.headers);

  headers.set("Origin", "https://realauad.com");
  headers.set("Referer", "https://realauad.com/");
  headers.set(
    "User-Agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/120.0.0.0 Safari/537.36"
  );

  // El runtime gestiona las cabeceras del handshake WebSocket.
  if (websocket) {
    headers.set("Upgrade", "websocket");
    headers.delete("Connection");
    headers.delete("Sec-WebSocket-Key");
    headers.delete("Sec-WebSocket-Version");
    headers.delete("Sec-WebSocket-Extensions");
  }

  return headers;
}

async function proxyHttp(request, destination) {
  const url = new URL(destination.path + destination.search, destination.origin);

  const init = {
    method: request.method,
    headers: upstreamHeaders(request),
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const upstream = await fetch(url, init);
  const headers = addCors(new Headers(upstream.headers));

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function bridgeWebSockets(clientSocket, serverSocket, upstreamSocket) {
  serverSocket.accept({ allowHalfOpen: true });
  upstreamSocket.accept({ allowHalfOpen: true });

  let closing = false;

  function closeBoth(code = 1000, reason = "Connection closed") {
    if (closing) return;
    closing = true;

    try {
      if (serverSocket.readyState < WebSocket.CLOSING) {
        serverSocket.close(code, reason);
      }
    } catch {}

    try {
      if (upstreamSocket.readyState < WebSocket.CLOSING) {
        upstreamSocket.close(code, reason);
      }
    } catch {}
  }

  serverSocket.addEventListener("message", (event) => {
    try {
      if (upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.send(event.data);
      }
    } catch {
      closeBoth(1011, "Upstream send failed");
    }
  });

  upstreamSocket.addEventListener("message", (event) => {
    try {
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.send(event.data);
      }
    } catch {
      closeBoth(1011, "Client send failed");
    }
  });

  serverSocket.addEventListener("close", (event) => {
    closeBoth(event.code, event.reason);
  });

  upstreamSocket.addEventListener("close", (event) => {
    closeBoth(event.code, event.reason);
  });

  serverSocket.addEventListener("error", () => closeBoth(1011, "Client error"));
  upstreamSocket.addEventListener("error", () => closeBoth(1011, "Upstream error"));
}

async function proxyWebSocket(request, destination) {
  const url = new URL(destination.path + destination.search, destination.origin);

  const upstreamResponse = await fetch(url, {
    headers: upstreamHeaders(request, true),
  });

  const upstreamSocket = upstreamResponse.webSocket;

  if (upstreamResponse.status !== 101 || !upstreamSocket) {
    return new Response(
      `Upstream WebSocket rejected the handshake (HTTP ${upstreamResponse.status})`,
      { status: 502 }
    );
  }

  const [clientSocket, serverSocket] =
    Object.values(new WebSocketPair());

  bridgeWebSockets(clientSocket, serverSocket, upstreamSocket);

  return new Response(null, {
    status: 101,
    webSocket: clientSocket,
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const destination = findTarget(url.pathname);

    if (!destination) {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: addCors(new Headers()),
      });
    }

    try {
      if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        return await proxyWebSocket(request, {
          ...destination,
          search: url.search,
        });
      }

      return await proxyHttp(request, {
        ...destination,
        search: url.search,
      });
    } catch (error) {
      console.error("Proxy error:", error);

      return new Response("Bad Gateway", {
        status: 502,
        headers: addCors(new Headers()),
      });
    }
  },
};
