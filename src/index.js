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
  headers.set("Accept-Encoding", "identity");   // <-- AÑADE ESTA LÍNEA
  if (websocket) {
    headers.delete("Connection");
    headers.delete("Sec-WebSocket-Key");
    headers.delete("Sec-WebSocket-Version");
    headers.delete("Sec-WebSocket-Extensions");
  }
  return headers;
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const upgrade = (request.headers.get("Upgrade") || "").toLowerCase();
  const isWebSocket = upgrade === "websocket";
  const destination = findTarget(url.pathname, isWebSocket);

  console.log("REQ", request.method, url.pathname, "ws=" + isWebSocket);

  if (!destination) {
    const headers = new Headers();
    addCors(headers, request);
    return new Response("Not found: " + url.pathname, { status: 404, headers });
  }

  if (request.method === "OPTIONS") {
    const headers = new Headers();
    addCors(headers, request);
    return new Response(null, { status: 204, headers });
  }

  try {
    if (isWebSocket) {
      // WebSocket: usar Deno.upgradeWebSocket
      const upstreamUrl = new URL(destination.path + url.search, destination.origin);
      console.log("WS upstream ->", upstreamUrl.href);

      const upstreamResponse = await fetch(upstreamUrl, {
        headers: upstreamHeaders(request, true),
      });

      if (upstreamResponse.status !== 101 || !upstreamResponse.webSocket) {
        const headers = new Headers();
        addCors(headers, request);
        return new Response(
          "Upstream WS rejected: " + upstreamResponse.status,
          { status: 502, headers }
        );
      }

      const upstreamSocket = upstreamResponse.webSocket;
      const { socket: clientSocket, response } = Deno.upgradeWebSocket(request);

      upstreamSocket.accept();

      clientSocket.addEventListener("message", (e) => {
        try {
          if (upstreamSocket.readyState === 1) upstreamSocket.send(e.data);
        } catch (err) { console.error("C→U:", err); }
      });

      upstreamSocket.addEventListener("message", (e) => {
        try {
          if (clientSocket.readyState === 1) clientSocket.send(e.data);
        } catch (err) { console.error("U→C:", err); }
      });

      clientSocket.addEventListener("close", () => {
        try { upstreamSocket.close(); } catch {}
      });
      upstreamSocket.addEventListener("close", () => {
        try { clientSocket.close(); } catch {}
      });

      return response;
    }

    // HTTP normal
    const upstreamUrl = new URL(destination.path + url.search, destination.origin);
    const init = {
      method: request.method,
      headers: upstreamHeaders(request),
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    const upstream = await fetch(upstreamUrl, init);
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
  } catch (error) {
    console.error("Proxy error:", error);
    const headers = new Headers();
    addCors(headers, request);
    return new Response("Bad Gateway: " + (error?.message || String(error)), {
      status: 502,
      headers,
    });
  }
}

Deno.serve(handleRequest);
