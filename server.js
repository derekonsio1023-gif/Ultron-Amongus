const http = require('http');
const httpProxy = require('http-proxy');

const PORT = process.env.PORT || 8080;

const TARGETS = {
    '/api': 'https://api.realauad.com',
    '/na':  'https://na.realauad.com',
    '/eu':  'https://eu.realauad.com',
};

const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    ws: true,
    secure: false,
    xfwd: true,
});

proxy.on('proxyReq', (proxyReq) => {
    proxyReq.setHeader('Origin', 'https://realauad.com');
    proxyReq.setHeader('Referer', 'https://realauad.com/');
    proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
});

proxy.on('proxyReqWs', (proxyReq) => {
    proxyReq.setHeader('Origin', 'https://realauad.com');
    proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
});

proxy.on('error', (err, req, res) => {
    console.error('Proxy error:', err.message);
    if (res && res.writeHead && !res.headersSent) {
        res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
        res.end('Proxy error: ' + err.message);
    }
});

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    for (const [prefix, target] of Object.entries(TARGETS)) {
        if (req.url.startsWith(prefix)) {
            req.url = req.url.slice(prefix.length) || '/';
            proxy.web(req, res, { target });
            return;
        }
    }

    res.writeHead(404);
    res.end('Not found');
});

server.on('upgrade', (req, socket, head) => {
    console.log('WS upgrade:', req.url);
    for (const [prefix, target] of Object.entries(TARGETS)) {
        if (req.url.startsWith(prefix)) {
            req.url = req.url.slice(prefix.length) || '/';
            proxy.ws(req, socket, head, { target });
            return;
        }
    }
    socket.destroy();
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Proxy escuchando en 0.0.0.0:${PORT}`);
});
