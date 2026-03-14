const { EventEmitter } = require("node:events");
const dgram = require("node:dgram");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const os = require("node:os");

const MAX_REDIRECTS = 3;
const UPNP_DISCOVERY_TIMEOUT_MS = 2500;
const UPNP_SERVICE_TYPES = [
  "urn:schemas-upnp-org:service:WANIPConnection:1",
  "urn:schemas-upnp-org:service:WANPPPConnection:1"
];
const ALLOWED_UPSTREAM_PROTOCOLS = new Set(["http:", "https:"]);
const PRIVATE_IPV4_PATTERN = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

function dedupeStrings(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value || seen.has(value)) {
      return false;
    }

    seen.add(value);
    return true;
  });
}

function createToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function getAdvertisedHosts(publicHost = "") {
  const interfaces = os.networkInterfaces();
  const lanHosts = [];

  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (!entry || entry.internal || entry.family !== "IPv4") {
        return;
      }

      lanHosts.push(entry.address);
    });
  });

  return dedupeStrings([publicHost, ...lanHosts, "127.0.0.1"]);
}

function readXmlTag(xml, tagName) {
  const match = String(xml || "").match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  return match ? match[1].trim() : "";
}

function parseServiceList(xml) {
  return Array.from(String(xml || "").matchAll(/<service>([\s\S]*?)<\/service>/gi)).map((match) => {
    const block = match[1] || "";
    return {
      serviceType: readXmlTag(block, "serviceType"),
      controlURL: readXmlTag(block, "controlURL")
    };
  });
}

function isRoutableIpv4(address) {
  const value = String(address || "").trim();
  return Boolean(value) && !PRIVATE_IPV4_PATTERN.test(value);
}

function discoverGatewayDescriptionUrl() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const query = [
      "M-SEARCH * HTTP/1.1",
      "HOST: 239.255.255.250:1900",
      "MAN: \"ssdp:discover\"",
      "MX: 2",
      "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1",
      "",
      ""
    ].join("\r\n");
    let settled = false;

    const finish = (value = null) => {
      if (settled) {
        return;
      }

      settled = true;
      try {
        socket.close();
      } catch {
        // Ignore close failures.
      }
      resolve(value);
    };

    socket.on("error", () => finish(null));
    socket.on("message", (message) => {
      const payload = message.toString("utf8");
      const location = payload.match(/^\s*LOCATION:\s*(.+)$/im)?.[1]?.trim() || "";
      if (location) {
        finish(location);
      }
    });

    socket.bind(0, "0.0.0.0", () => {
      try {
        socket.setMulticastTTL(2);
        socket.send(Buffer.from(query), 1900, "239.255.255.250");
      } catch {
        finish(null);
      }
    });

    setTimeout(() => finish(null), UPNP_DISCOVERY_TIMEOUT_MS);
  });
}

async function discoverGatewayService() {
  const descriptionUrl = await discoverGatewayDescriptionUrl();
  if (!descriptionUrl) {
    return null;
  }

  const xml = await fetch(descriptionUrl).then((response) => {
    if (!response.ok) {
      throw new Error(`Gateway description request failed with ${response.status}.`);
    }

    return response.text();
  });
  const service = parseServiceList(xml).find((entry) => UPNP_SERVICE_TYPES.includes(entry.serviceType));
  if (!service?.controlURL || !service.serviceType) {
    return null;
  }

  return {
    serviceType: service.serviceType,
    controlUrl: new URL(service.controlURL, descriptionUrl).toString()
  };
}

async function invokeUpnpSoap(controlUrl, serviceType, action, innerXml) {
  const body = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${serviceType}">
      ${innerXml}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

  const response = await fetch(controlUrl, {
    method: "POST",
    headers: {
      SOAPAction: `"${serviceType}#${action}"`,
      "Content-Type": "text/xml; charset=\"utf-8\""
    },
    body
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`UPnP ${action} failed with ${response.status}.`);
  }

  return text;
}

async function ensureUpnpPortMapping(port) {
  const gateway = await discoverGatewayService();
  const localHost = getAdvertisedHosts().find((entry) => entry && entry !== "127.0.0.1") || "";
  if (!gateway || !localHost || !port) {
    return null;
  }

  await invokeUpnpSoap(gateway.controlUrl, gateway.serviceType, "AddPortMapping", `
<NewRemoteHost></NewRemoteHost>
<NewExternalPort>${port}</NewExternalPort>
<NewProtocol>TCP</NewProtocol>
<NewInternalPort>${port}</NewInternalPort>
<NewInternalClient>${localHost}</NewInternalClient>
<NewEnabled>1</NewEnabled>
<NewPortMappingDescription>Apollo Listen Along</NewPortMappingDescription>
<NewLeaseDuration>3600</NewLeaseDuration>`);

  const externalIpResponse = await invokeUpnpSoap(
    gateway.controlUrl,
    gateway.serviceType,
    "GetExternalIPAddress",
    ""
  ).catch(() => "");
  const externalIp = readXmlTag(externalIpResponse, "NewExternalIPAddress");
  if (!externalIp) {
    return null;
  }

  return {
    serviceType: gateway.serviceType,
    controlUrl: gateway.controlUrl,
    externalIp,
    externalPort: port
  };
}

async function removeUpnpPortMapping(mapping) {
  if (!mapping?.controlUrl || !mapping?.serviceType || !mapping?.externalPort) {
    return;
  }

  await invokeUpnpSoap(mapping.controlUrl, mapping.serviceType, "DeletePortMapping", `
<NewRemoteHost></NewRemoteHost>
<NewExternalPort>${mapping.externalPort}</NewExternalPort>
<NewProtocol>TCP</NewProtocol>`);
}

function sendCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
}

function readToken(requestUrl) {
  return String(requestUrl.searchParams.get("token") || "").trim();
}

function buildSessionSnapshot(session, serverState, requestHost = "") {
  const resolvedHost = String(requestHost || "").trim() || (serverState.advertisedHosts[0] ? `${serverState.advertisedHosts[0]}:${serverState.port}` : "");
  const streamUrl = resolvedHost
    ? `http://${resolvedHost}/stream/${encodeURIComponent(session.sessionId)}?token=${encodeURIComponent(session.token)}`
    : "";

  return {
    sessionId: session.sessionId,
    trackId: session.trackId,
    title: session.title,
    artist: session.artist,
    album: session.album,
    artwork: session.artwork,
    durationSeconds: session.durationSeconds,
    status: session.status,
    positionSeconds: session.positionSeconds,
    playbackRate: session.playbackRate,
    capturedAt: session.capturedAt,
    streamUrl,
    updatedAt: session.updatedAt
  };
}

function createServerState(server, available, message = "", options = {}) {
  const address = server?.address?.();
  const running = Boolean(address && typeof address === "object" && address.port);
  const publicHost = String(options.publicHost || "").trim();
  return {
    available,
    running,
    port: running ? address.port : 0,
    advertisedHosts: running ? getAdvertisedHosts(publicHost) : [],
    publicHost,
    message: message || (available ? "" : "Listen along server is unavailable.")
  };
}

function normaliseStreamUrl(value) {
  const rawUrl = String(value || "").trim();
  if (!rawUrl) {
    throw new Error("Listen along source stream URL is required.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("Listen along source stream URL is invalid.");
  }

  if (!ALLOWED_UPSTREAM_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error("Listen along source streams must use http:// or https:// URLs.");
  }

  return parsedUrl.toString();
}

function createUpstreamRequest(urlString, headers = {}) {
  const targetUrl = new URL(normaliseStreamUrl(urlString));
  const transport = targetUrl.protocol === "https:" ? https : http;

  return transport.request(targetUrl, {
    method: "GET",
    headers,
    timeout: 20000
  });
}

function createListenAlongServer({ logger = () => {} } = {}) {
  const emitter = new EventEmitter();
  const sessions = new Map();
  let server = null;
  let upnpMapping = null;
  let serverState = {
    available: false,
    running: false,
    port: 0,
    advertisedHosts: [],
    publicHost: "",
    message: "Listen along server is starting."
  };

  function log(message) {
    try {
      logger(`[listen-along] ${message}`);
    } catch {
      // Ignore logger failures.
    }
  }

  function emitState() {
    emitter.emit("state", getState());
  }

  function getState() {
    return {
      ...serverState,
      advertisedHosts: [...serverState.advertisedHosts]
    };
  }

  function writeJson(response, statusCode, payload) {
    sendCorsHeaders(response);
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(payload));
  }

  function writeText(response, statusCode, message) {
    sendCorsHeaders(response);
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(String(message || ""));
  }

  function validateSession(requestUrl, sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        ok: false,
        statusCode: 404,
        message: "Listen along session not found."
      };
    }

    if (readToken(requestUrl) !== session.token) {
      return {
        ok: false,
        statusCode: 403,
        message: "Invalid listen along token."
      };
    }

    return {
      ok: true,
      session
    };
  }

  function proxyStream(request, response, session, redirectCount = 0) {
    if (!session.sourceStreamUrl) {
      writeText(response, 404, "Stream unavailable.");
      return;
    }

    const upstreamRequest = createUpstreamRequest(session.sourceStreamUrl, {
      Range: request.headers.range || "",
      "User-Agent": "Apollo-Client-ListenAlong"
    });

    const destroyUpstream = () => {
      upstreamRequest.destroy();
    };

    request.on("close", destroyUpstream);
    upstreamRequest.on("timeout", destroyUpstream);
    upstreamRequest.on("error", () => {
      if (!response.headersSent) {
        writeText(response, 502, "Unable to proxy listen along stream.");
      } else {
        response.destroy();
      }
    });

    upstreamRequest.on("response", (upstreamResponse) => {
      const statusCode = Number(upstreamResponse.statusCode) || 500;
      const location = upstreamResponse.headers.location;
      if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirectCount < MAX_REDIRECTS) {
        session.sourceStreamUrl = normaliseStreamUrl(new URL(location, session.sourceStreamUrl).toString());
        upstreamResponse.resume();
        proxyStream(request, response, session, redirectCount + 1);
        return;
      }

      sendCorsHeaders(response);
      response.statusCode = statusCode;

      [
        "accept-ranges",
        "cache-control",
        "content-length",
        "content-range",
        "content-type",
        "etag",
        "last-modified"
      ].forEach((headerName) => {
        const value = upstreamResponse.headers[headerName];
        if (value) {
          response.setHeader(headerName, value);
        }
      });

      if (request.method === "HEAD") {
        upstreamResponse.resume();
        response.end();
        return;
      }

      upstreamResponse.pipe(response);
    });

    upstreamRequest.end();
  }

  function handleRequest(request, response) {
    if (!request.url) {
      writeText(response, 400, "Invalid request.");
      return;
    }

    const requestUrl = new URL(request.url, "http://127.0.0.1");
    if (request.method === "OPTIONS") {
      sendCorsHeaders(response);
      response.statusCode = 204;
      response.end();
      return;
    }

    if (requestUrl.pathname === "/health") {
      writeJson(response, 200, {
        ok: true,
        state: getState()
      });
      return;
    }

    if (requestUrl.pathname.startsWith("/session/")) {
      const sessionId = decodeURIComponent(requestUrl.pathname.slice("/session/".length));
      const validation = validateSession(requestUrl, sessionId);
      if (!validation.ok) {
        writeText(response, validation.statusCode, validation.message);
        return;
      }

      writeJson(response, 200, buildSessionSnapshot(validation.session, serverState, request.headers.host || ""));
      return;
    }

    if (requestUrl.pathname.startsWith("/stream/")) {
      const sessionId = decodeURIComponent(requestUrl.pathname.slice("/stream/".length));
      const validation = validateSession(requestUrl, sessionId);
      if (!validation.ok) {
        writeText(response, validation.statusCode, validation.message);
        return;
      }

      proxyStream(request, response, validation.session);
      return;
    }

    writeText(response, 404, "Not found.");
  }

  async function start() {
    if (server) {
      return getState();
    }

    server = http.createServer(handleRequest);
    server.on("error", (error) => {
      serverState = createServerState(server, false, error?.message || "Listen along server failed.");
      log(`server error=${serverState.message}`);
      emitState();
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "0.0.0.0", () => {
        server.off("error", reject);
        resolve();
      });
    });

    try {
      upnpMapping = await ensureUpnpPortMapping(server.address().port);
    } catch (error) {
      log(`upnp unavailable error=${error?.message || "unknown"}`);
      upnpMapping = null;
    }

    if (upnpMapping?.externalIp && !isRoutableIpv4(upnpMapping.externalIp)) {
      log(`upnp mapped external ip is non-routable value=${upnpMapping.externalIp}`);
    }

    serverState = createServerState(server, true, "", {
      publicHost: isRoutableIpv4(upnpMapping?.externalIp) ? upnpMapping.externalIp : ""
    });
    log(`server listening port=${serverState.port} hosts=${serverState.advertisedHosts.join(",")}`);
    emitState();
    return getState();
  }

  async function stop() {
    sessions.clear();
    const previousMapping = upnpMapping;
    upnpMapping = null;
    if (!server) {
      serverState = createServerState(null, false, "Listen along server stopped.");
      emitState();
      return;
    }

    const currentServer = server;
    server = null;
    await new Promise((resolve) => {
      currentServer.close(() => {
        resolve();
      });
    });

    if (previousMapping) {
      await removeUpnpPortMapping(previousMapping).catch(() => {});
    }

    serverState = createServerState(null, false, "Listen along server stopped.");
    emitState();
  }

  async function publishSession(payload = {}) {
    await start();

    const sessionId = String(payload.sessionId || "").trim();
    const token = String(payload.token || createToken()).trim();
    const trackId = String(payload.trackId || "").trim();
    const sourceStreamUrl = normaliseStreamUrl(payload.sourceStreamUrl);

    if (!sessionId || !token || !trackId || !sourceStreamUrl) {
      throw new Error("Listen along publish payload is incomplete.");
    }

    const now = Date.now();
    const nextSession = {
      sessionId,
      token,
      trackId,
      title: String(payload.title || "Unknown Title"),
      artist: String(payload.artist || "Unknown Artist"),
      album: String(payload.album || ""),
      artwork: String(payload.artwork || ""),
      durationSeconds: Math.max(0, Number(payload.durationSeconds) || 0),
      status: payload.status === "playing" ? "playing" : "paused",
      positionSeconds: Math.max(0, Number(payload.positionSeconds) || 0),
      playbackRate: Math.max(0.25, Number(payload.playbackRate) || 1),
      capturedAt: Math.max(0, Number(payload.capturedAt) || now),
      updatedAt: now,
      sourceStreamUrl
    };

    sessions.set(sessionId, nextSession);
    return {
      ...getState(),
      sessionId,
      token
    };
  }

  function clearSession(sessionId) {
    sessions.delete(String(sessionId || "").trim());
  }

  return {
    start,
    stop,
    getState,
    publishSession,
    clearSession,
    on: (...args) => emitter.on(...args)
  };
}

module.exports = {
  createListenAlongServer,
  createToken
};
