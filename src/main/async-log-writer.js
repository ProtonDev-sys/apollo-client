const path = require("node:path");

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_QUEUED_LINES = 512;
const DEFAULT_MAX_LINE_BYTES = 16 * 1024;

function sanitiseLogText(value, maxBytes = DEFAULT_MAX_LINE_BYTES) {
  const text = String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (!text) {
    return "";
  }

  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) {
    return text;
  }

  const byteLimit = Math.max(0, Math.trunc(Number(maxBytes) || 0));
  const suffix = Buffer.from("...", "utf8");
  if (byteLimit <= suffix.length) {
    return suffix.subarray(0, byteLimit).toString("utf8");
  }

  let end = byteLimit - suffix.length;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return Buffer.concat([buffer.subarray(0, end), suffix]).toString("utf8");
}

function createAsyncLogWriter({
  fs,
  targetPath = "",
  maxBytes = DEFAULT_MAX_BYTES,
  maxQueuedLines = DEFAULT_MAX_QUEUED_LINES,
  maxLineBytes = DEFAULT_MAX_LINE_BYTES,
  now = () => new Date()
} = {}) {
  if (!fs?.promises) {
    throw new TypeError("An fs implementation with promises is required.");
  }

  const byteLimit = Math.max(1024, Number(maxBytes) || DEFAULT_MAX_BYTES);
  const queueLimit = Math.max(1, Math.trunc(Number(maxQueuedLines) || DEFAULT_MAX_QUEUED_LINES));
  const lineLimit = Math.max(256, Math.trunc(Number(maxLineBytes) || DEFAULT_MAX_LINE_BYTES));
  const queuedLines = [];
  let filePath = String(targetPath || "").trim();
  let estimatedSize = null;
  let flushScheduled = false;
  let writeChain = Promise.resolve();
  let droppedLines = 0;

  function setPath(nextPath) {
    filePath = String(nextPath || "").trim();
    estimatedSize = null;
  }

  function formatLine(source, message) {
    const cleanSource = sanitiseLogText(source || "app", 256) || "app";
    const cleanMessage = sanitiseLogText(message, lineLimit);
    if (!cleanMessage) {
      return "";
    }

    const timestamp = now();
    const isoTimestamp = timestamp instanceof Date
      ? timestamp.toISOString()
      : new Date(timestamp).toISOString();
    return `[${isoTimestamp}] [${cleanSource}] ${cleanMessage}\n`;
  }

  async function resolveEstimatedSize() {
    if (estimatedSize !== null) {
      return estimatedSize;
    }

    try {
      estimatedSize = (await fs.promises.stat(filePath)).size;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      estimatedSize = 0;
    }
    return estimatedSize;
  }

  async function writeBatch(lines) {
    if (!filePath || !lines.length) {
      return;
    }

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const batch = Buffer.from(lines.join(""), "utf8");
    const currentSize = await resolveEstimatedSize();

    if (currentSize + batch.length > byteLimit) {
      const retained = batch.length > byteLimit
        ? batch.subarray(batch.length - byteLimit)
        : batch;
      await fs.promises.writeFile(filePath, retained);
      estimatedSize = retained.length;
      return;
    }

    await fs.promises.appendFile(filePath, batch);
    estimatedSize = currentSize + batch.length;
  }

  function drainQueue() {
    flushScheduled = false;
    if (!queuedLines.length || !filePath) {
      return writeChain;
    }

    const lines = queuedLines.splice(0, queuedLines.length);
    if (droppedLines) {
      lines.unshift(formatLine("log", `${droppedLines} queued log lines were dropped to protect memory.`));
      droppedLines = 0;
    }

    writeChain = writeChain
      .then(() => writeBatch(lines))
      .catch(() => {
        estimatedSize = null;
      });
    return writeChain;
  }

  function scheduleFlush() {
    if (flushScheduled) {
      return;
    }
    flushScheduled = true;
    queueMicrotask(drainQueue);
  }

  function write(source, message) {
    const line = formatLine(source, message);
    if (!filePath || !line) {
      return false;
    }

    if (queuedLines.length >= queueLimit) {
      queuedLines.shift();
      droppedLines += 1;
    }
    queuedLines.push(line);
    scheduleFlush();
    return true;
  }

  async function flush() {
    drainQueue();
    await writeChain;
  }

  return {
    write,
    flush,
    setPath,
    getPath: () => filePath,
    getQueuedLineCount: () => queuedLines.length,
    getDroppedLineCount: () => droppedLines
  };
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINE_BYTES,
  DEFAULT_MAX_QUEUED_LINES,
  createAsyncLogWriter,
  sanitiseLogText
};
