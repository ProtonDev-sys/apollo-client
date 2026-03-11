const JSON_CONTENT_TYPE_PATTERN = /\bjson\b/i;

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
  return async function requestJson(path, options = {}) {
    const { skipAuth = false, suppressConnectionModal = false, ...fetchOptions } = options;
    const headers = new Headers(fetchOptions.headers || {});
    const authHeader = typeof getAuthorizationHeader === "function" ? getAuthorizationHeader() : "";

    if (fetchOptions.body != null && !(fetchOptions.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (!skipAuth && authHeader && !headers.has("Authorization")) {
      headers.set("Authorization", authHeader);
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

    let response;
    try {
      response = await fetch(requestUrl, {
        ...fetchOptions,
        headers
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw error;
      }

      const connectionError = createConnectionError(
        buildConnectionFailureMessage(error, getApiBase()),
        error
      );
      if (!suppressConnectionModal) {
        onConnectionFailure?.(connectionError);
      }
      throw connectionError;
    }

    onConnectionRecovered?.();

    const payload = await parseResponseBody(response);
    if (!response.ok) {
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

    return payload;
  };
}
