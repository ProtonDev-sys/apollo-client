function normaliseLineEndings(value) {
  return String(value || "").replace(/\r\n?/g, "\n");
}

function parseEventBlock(block) {
  const lines = normaliseLineEndings(block).split("\n");
  let eventName = "message";
  let eventId = "";
  const dataLines = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    let value = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : "";
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "event") {
      eventName = value || "message";
    } else if (field === "data") {
      dataLines.push(value);
    } else if (field === "id" && !value.includes("\0")) {
      eventId = value;
    }
  }

  if (!dataLines.length) {
    return null;
  }

  const rawData = dataLines.join("\n");
  if (rawData === "[DONE]") {
    return {
      event: eventName,
      id: eventId,
      data: null,
      done: true
    };
  }

  let data;
  try {
    data = JSON.parse(rawData);
  } catch (error) {
    const parseError = new Error(`Apollo returned invalid JSON in the ${eventName} search event.`);
    parseError.cause = error;
    throw parseError;
  }

  return {
    event: eventName,
    id: eventId,
    data,
    done: eventName === "done"
  };
}

export function createJsonEventStreamParser({ onEvent = () => {} } = {}) {
  if (typeof onEvent !== "function") {
    throw new TypeError("Event-stream onEvent must be a function.");
  }

  let buffer = "";
  let lastEvent = null;
  let pendingCarriageReturn = false;

  function appendChunk(chunk) {
    let nextChunk = String(chunk || "");
    if (pendingCarriageReturn) {
      nextChunk = `\r${nextChunk}`;
      pendingCarriageReturn = false;
    }

    if (nextChunk.endsWith("\r")) {
      pendingCarriageReturn = true;
      nextChunk = nextChunk.slice(0, -1);
    }

    buffer += normaliseLineEndings(nextChunk);
  }

  async function dispatchBlock(block) {
    const parsed = parseEventBlock(block);
    if (!parsed) {
      return null;
    }

    lastEvent = parsed;
    await onEvent(parsed);
    return parsed;
  }

  async function drainBlocks() {
    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      if (block.trim()) {
        await dispatchBlock(block);
      }
      separatorIndex = buffer.indexOf("\n\n");
    }
  }

  async function push(chunk) {
    appendChunk(chunk);
    await drainBlocks();
    return lastEvent;
  }

  async function finish() {
    if (pendingCarriageReturn) {
      pendingCarriageReturn = false;
      buffer += "\n";
    }

    await drainBlocks();
    if (buffer.trim()) {
      await dispatchBlock(buffer);
    }
    buffer = "";
    return lastEvent;
  }

  return {
    push,
    finish,
    getLastEvent: () => lastEvent
  };
}

export async function consumeJsonEventStream(response, {
  signal = null,
  onEvent = () => {}
} = {}) {
  if (!response?.body?.getReader) {
    throw new Error("Apollo returned a search stream without a readable body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createJsonEventStreamParser({ onEvent });

  try {
    while (true) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException("The search was aborted.", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (value?.length) {
        await parser.push(decoder.decode(value, { stream: true }));
      }
    }

    const trailingText = decoder.decode();
    if (trailingText) {
      await parser.push(trailingText);
    }

    return parser.finish();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore reader cleanup failures.
    }
  }
}
