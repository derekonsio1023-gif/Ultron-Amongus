
const TARGETS = {
  "/api": "https://api.realauad.com",
  "/na": "https://na.realauad.com",
  "/eu": "https://eu.realauad.com",
};

const ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";

function findTarget(pathname) {
  for (const [prefix, origin] of Object.entries(TARGETS)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return {
        origin,
        path: pathname.slice(prefix.length) || "/",
      };
    }
  }
  return null;
}

function addCors(headers, request) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);

  const requestedHeaders = request?.headers.get(
    "Access-Control-Request-Headers"
  );

  headers.set(
    "Access-Control-Allow-Headers",
    requestedHeaders || "Content-Type, Authorization"
  );

  headers.delete("Access-Control-Allow-Credentials");
  return headers;
}

function upstreamHeaders(request, websocket = false) {
  const headers = new Headers(request.headers);

  headers.set("Origin", "https://realauad.com");
  headers.set("Referer", "https://realauad.com/");

  if (websocket) {
    headers.delete("Connection");
    headers.delete("Sec-WebSocket-Key");
    headers.delete("Sec-WebSocket-Version");
    headers.delete("Sec-WebSocket-Extensions");
  }

  return headers;
}

async function proxyHttp(request, destination) {
  const url = new URL(
    destination.path + destination.search,
    destination.origin
  );

  const init = {
    method: request.method,
    headers: upstreamHeaders(request),
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const upstream = await fetch(url, init);
  const headers = addCors(new Headers(upstream.headers), request);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

function bridgeWebSockets(clientSocket, serverSocket, upstreamSocket) {
  serverSocket.accept();
  upstreamSocket.accept();

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

  serverSocket.addEventListener("message", event => {
    try {
      if (upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.send(event.data);
      }
    } catch {
      closeBoth(1011, "Upstream send failed");
    }
  });

  upstreamSocket.addEventListener("message", event => {
    try {
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.send(event.data);
      }
    } catch {
      closeBoth(1011, "Client send failed");
    }
  });

  serverSocket.addEventListener("close", event => {
    closeBoth(event.code, event.reason);
  });

  upstreamSocket.addEventListener("close", event => {
    closeBoth(event.code, event.reason);
  });

  serverSocket.addEventListener("error", () => {
    closeBoth(1011, "Client error");
  });

  upstreamSocket.addEventListener("error", () => {
    closeBoth(1011, "Upstream error");
  });
}

async function proxyWebSocket(request, destination) {
  const url = new URL(
    destination.path + destination.search,
    destination.origin
  );

  const upstreamResponse = await fetch(url, {
    headers: upstreamHeaders(request, true),
  });

  const upstreamSocket = upstreamResponse.webSocket;

  if (upstreamResponse.status !== 101 || !upstreamSocket) {
    return new Response(
      `Upstream WebSocket rejected the handshake (HTTP ${upstreamResponse.status})`,
      {
        status: 502,
        headers: addCors(new Headers(), request),
      }
    );
  }

  const pair = new WebSocketPair();
  const clientSocket = pair[0];
  const serverSocket = pair[1];

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
      return new Response("Not found", {
        status: 404,
        headers: addCors(new Headers(), request),
      });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: addCors(new Headers(), request),
      });
    }

    try {
      const target = {
        ...destination,
        search: url.search,
      };

      if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        return await proxyWebSocket(request, target);
      }

      return await proxyHttp(request, target);
    } catch (error) {
      console.error("Proxy error:", error);

      return new Response("Bad Gateway", {
        status: 502,
        headers: addCors(new Headers(), request),
      });
    }
  },
};
