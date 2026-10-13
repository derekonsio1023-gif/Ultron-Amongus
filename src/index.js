const HTTP_TARGETS = {
  "/api": "https://api.realauad.com",
  "/na":  "https://na.realauad.com",
  "/eu":  "https://eu.realauad.com",
};

const WS_TARGETS = {
  "/api": "https://api.realauad.com",
  "/na":  "https://na.realauad.com:22023",
  "/eu":  "https://eu.realauad.com:22023",
};

const ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";

function addCors(headers, request) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  const requested = request?.headers.get("Access-Control-Request-Headers");
  headers.set(
    "Access-Control-Allow-Headers",
    requested || "Content-Type, Authorization"
  );
  headers.delete("Access-Control-Allow-Credentials");
}

function findTarget(pathname, isWebSocket) {
  const targets = isWebSocket ? WS_TARGETS : HTTP_TARGETS;
  for (const [prefix, origin] of Object.entries(targets)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return { origin, path: pathname.slice(prefix.length) || "/" };
    }
  }
  return null;
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

async function proxyHttp(request, destination, search) {
  const url = new URL(destination.path + search, destination.origin);
  const init = {
    method: request.method,
    headers: upstreamHeaders(request),
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const upstream = await fetch(url, init);
  const headers = new Headers(upstream.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.delete("connection");
  addCors(headers, request);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function proxyWebSocket(request, destination, search) {
  const url = new URL(destination.path + search, destination.origin);

  const upstreamResponse = await fetch(url, {
    headers: upstreamHeaders(request, true),
  });

  const upstreamSocket = upstreamResponse.webSocket;
  if (upstreamResponse.status !== 101 || !upstreamSocket) {
    const headers = new Headers();
    addCors(headers, request);
    return new Response(
      `Upstream WebSocket rejected (HTTP ${upstreamResponse.status})`,
      { status: 502, headers }
    );
  }

  const { socket: clientSocket, response } = Deno.upgradeWebSocket(request);
  const serverSocket = clientSocket;

  upstreamSocket.accept();

  serverSocket.addEventListener("message", (event) => {
    try {
      if (upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.send(event.data);
      }
    } catch (e) {
      console.error("Client→Upstream error:", e);
    }
  });

  upstreamSocket.addEventListener("message", (event) => {
    try {
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.send(event.data);
      }
    } catch (e) {
      console.error("Upstream→Client error:", e);
    }
  });

  serverSocket.addEventListener("close", () => {
    try { upstreamSocket.close(); } catch {}
  });
  upstreamSocket.addEventListener("close", () => {
    try { serverSocket.close(); } catch {}
  });

  return response;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const isWebSocket =
      (request.headers.get("Upgrade") || "").toLowerCase() === "websocket";
    const destination = findTarget(url.pathname, isWebSocket);

    if (!destination) {
      const headers = new Headers();
      addCors(headers, request);
      return new Response("Not found", { status: 404, headers });
    }

    if (request.method === "OPTIONS") {
      const headers = new Headers();
      addCors(headers, request);
      return new Response(null, { status: 204, headers });
    }

    try {
      if (isWebSocket) {
        return await proxyWebSocket(request, destination, url.search);
      }
      return await proxyHttp(request, destination, url.search);
    } catch (error) {
      console.error("Proxy error:", error);
      const headers = new Headers();
      addCors(headers, request);
      return new Response("Bad Gateway: " + (error?.message || error), {
        status: 502,
        headers,
      });
    }
  },
};
