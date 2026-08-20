import { consumeJsonEventStream } from "./event-stream.js";

const JSON_CONTENT_TYPE_PATTERN = /\bjson\b/i;
const EVENT_STREAM_CONTENT_TYPE_PATTERN = /^text\/event-stream\b/i;

async function parseResponseBody(response) {
  if (!response || response.status === 204 || response.status === 205) {
    return null;
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength === "0") {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();
  if (!rawBody) {
    return null;
  }

  if (!JSON_CONTENT_TYPE_PATTERN.test(contentType)) {
    return rawBody;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error("Apollo returned an invalid JSON response.");
  }
}

function isFormDataBody(value) {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

export function isConnectionError(error) {
  return error?.code === "APOLLO_CONNECTION_FAILED";
}

export function createConnectionError(message, cause) {
  const error = new Error(message);
  error.code = "APOLLO_CONNECTION_FAILED";
  if (cause) {
    error.cause = cause;
  }
  return error;
}

export function buildConnectionFailureMessage(error, apiBase) {
  if (error?.message?.includes("Invalid URL")) {
    return "The Apollo server address is invalid. Update the protocol, IP, or port in Settings.";
  }

  return `Couldn't reach Apollo at ${apiBase}. Check that the server is running and that the IP and port are correct.`;
}

export function createApolloTransport({
  getApiBase,
  getAuthorizationHeader,
  onConnectionRecovered,
  onConnectionFailure,
  onAuthFailure
}) {
  function prepareRequest(path, options = {}, accept = "") {
    const { skipAuth = false, suppressConnectionModal = false, ...fetchOptions } = options;
    const headers = new Headers(fetchOptions.headers || {});
    const authHeader = typeof getAuthorizationHeader === "function" ? getAuthorizationHeader() : "";

    if (fetchOptions.body != null && !isFormDataBody(fetchOptions.body) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (!skipAuth && authHeader && !headers.has("Authorization")) {
      headers.set("Authorization", authHeader);
    }
    if (accept && !headers.has("Accept")) {
      headers.set("Accept", accept);
    }

    let requestUrl = "";
    try {
      requestUrl = new URL(path, `${getApiBase()}/`).toString();
    } catch (error) {
      const connectionError = createConnectionError(
        buildConnectionFailureMessage(error, getApiBase()),
        error
      );
      if (!suppressConnectionModal) {
        onConnectionFailure?.(connectionError);
      }
      throw connectionError;
    }

    return {
      requestUrl,
      skipAuth,
      suppressConnectionModal,
      fetchOptions: {
        ...fetchOptions,
        headers
      }
    };
  }

  async function performRequest(path, options = {}, accept = "") {
    const prepared = prepareRequest(path, options, accept);
    let response;
    try {
      response = await fetch(prepared.requestUrl, prepared.fetchOptions);
    } catch (error) {
      if (error?.name === "AbortError") {
        throw error;
      }

      const connectionError = createConnectionError(
        buildConnectionFailureMessage(error, getApiBase()),
        error
      );
      if (!prepared.suppressConnectionModal) {
        onConnectionFailure?.(connectionError);
      }
      throw connectionError;
    }

    onConnectionRecovered?.();
    return {
      response,
      skipAuth: prepared.skipAuth
    };
  }

  async function throwResponseError(response, skipAuth) {
    const payload = await parseResponseBody(response);
    const errorMessage = typeof payload === "object" && payload?.error
      ? payload.error
      : typeof payload === "string" && payload.trim()
        ? payload.trim()
        : `Request failed with ${response.status}`;

    if (response.status === 401 && !skipAuth) {
      onAuthFailure?.(errorMessage);
      const authError = new Error(errorMessage);
      authError.code = "AUTH_REQUIRED";
      throw authError;
    }

    throw new Error(errorMessage);
  }

  async function requestJson(path, options = {}) {
    const { response, skipAuth } = await performRequest(path, options, "application/json");
    if (!response.ok) {
      await throwResponseError(response, skipAuth);
    }
    return parseResponseBody(response);
  }

  requestJson.requestEventStream = async function requestEventStream(
    path,
    options = {},
    onEvent = () => {}
  ) {
    if (typeof onEvent !== "function") {
      throw new TypeError("Event-stream onEvent must be a function.");
    }

    const { response, skipAuth } = await performRequest(path, options, "text/event-stream");
    if (!response.ok) {
      await throwResponseError(response, skipAuth);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!EVENT_STREAM_CONTENT_TYPE_PATTERN.test(contentType)) {
      const payload = await parseResponseBody(response);
      const event = {
        event: "done",
        id: "",
        data: payload,
        done: true
      };
      await onEvent(event);
      return event;
    }

    const lastEvent = await consumeJsonEventStream(response, {
      signal: options.signal || null,
      onEvent
    });
    if (!lastEvent?.done && lastEvent?.event !== "done") {
      const incompleteError = new Error("Apollo search stream ended before the final result arrived.");
      incompleteError.code = "APOLLO_INCOMPLETE_STREAM";
      throw incompleteError;
    }

    return lastEvent;
  };

  return requestJson;
}
