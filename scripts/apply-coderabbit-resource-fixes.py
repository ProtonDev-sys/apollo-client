from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return source.replace(old, new, 1)


def replace_block(source: str, start: str, end: str, replacement: str, label: str) -> str:
    start_count = source.count(start)
    end_count = source.count(end)
    if start_count != 1 or end_count != 1:
        raise SystemExit(
            f"{label}: expected one boundary each, found start={start_count}, end={end_count}"
        )
    start_index = source.index(start)
    end_index = source.index(end, start_index)
    return source[:start_index] + replacement + source[end_index:]


package_budget_path = Path("scripts/check-package-budget.js")
package_budget = package_budget_path.read_text(encoding="utf-8")
package_budget = replace_once(
    package_budget,
    '''function checkPackageBudget({
  projectRoot = path.resolve(__dirname, ".."),
  maxAsarBytes = Number(process.env.APOLLO_MAX_ASAR_BYTES) || DEFAULT_MAX_ASAR_BYTES
} = {}) {
  const asarPath = path.join(projectRoot, "release", "linux-unpacked", "resources", "app.asar");
''',
    '''function resolveMaxAsarBytes(value = process.env.APOLLO_MAX_ASAR_BYTES) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return DEFAULT_MAX_ASAR_BYTES;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError("The ASAR byte budget must be a finite positive number.");
  }
  return Math.trunc(parsed);
}

function checkPackageBudget({
  projectRoot = path.resolve(__dirname, ".."),
  maxAsarBytes
} = {}) {
  const resolvedMaxAsarBytes = resolveMaxAsarBytes(maxAsarBytes);
  const asarPath = path.join(projectRoot, "release", "linux-unpacked", "resources", "app.asar");
''',
    "finite ASAR budget resolution",
)
package_budget = package_budget.replace("if (size > maxAsarBytes) {", "if (size > resolvedMaxAsarBytes) {")
package_budget = package_budget.replace(
    "`Packaged app.asar exceeds the ${maxAsarBytes}-byte budget.`",
    "`Packaged app.asar exceeds the ${resolvedMaxAsarBytes}-byte budget.`",
)
package_budget = package_budget.replace(
    "return { ok: true, asarPath, size, maxAsarBytes };",
    "return { ok: true, asarPath, size, maxAsarBytes: resolvedMaxAsarBytes };",
)
package_budget = replace_once(
    package_budget,
    '''function run() {
  const result = checkPackageBudget();
  if (!result.ok) {
''',
    '''function run() {
  let result;
  try {
    result = checkPackageBudget();
  } catch (error) {
    process.stderr.write(`error: ${error?.message || "Invalid ASAR byte budget."}\n`);
    process.exitCode = 1;
    return false;
  }

  if (!result.ok) {
''',
    "ASAR configuration error reporting",
)
package_budget = replace_once(
    package_budget,
    '''  DEFAULT_MAX_ASAR_BYTES,
  checkPackageBudget,
''',
    '''  DEFAULT_MAX_ASAR_BYTES,
  checkPackageBudget,
  resolveMaxAsarBytes,
''',
    "ASAR resolver export",
)
package_budget_path.write_text(package_budget, encoding="utf-8")


resource_budget_path = Path("scripts/check-resource-budget.js")
resource_budget = resource_budget_path.read_text(encoding="utf-8")
resource_budget = replace_once(
    resource_budget,
    '''function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}
''',
    '''function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}
''',
    "distinguishable file-size failures",
)
resource_budget = replace_once(
    resource_budget,
    '''  const measured = {
    mainBytes: getFileSize(path.join(projectRoot, "main.js")),
    preloadBytes: getFileSize(path.join(projectRoot, "preload.js")),
    rendererBytes: getFileSize(path.join(projectRoot, "src", "renderer.js")),
    packagedSourceBytes: calculatePackagedSourceBytes(projectRoot)
  };

  for (const [name, limit] of Object.entries(budgets)) {
    if (measured[name] > limit) {
      errors.push(`${name} exceeds its resource budget: ${measured[name]} > ${limit} bytes`);
    }
  }
''',
    '''  const requiredTargets = {
    mainBytes: "main.js",
    preloadBytes: "preload.js",
    rendererBytes: path.join("src", "renderer.js")
  };
  const measured = {};
  for (const [name, relativePath] of Object.entries(requiredTargets)) {
    const size = getFileSize(path.join(projectRoot, relativePath));
    if (size === null) {
      errors.push(`Required resource budget target is missing or unreadable: ${relativePath}`);
      measured[name] = 0;
    } else {
      measured[name] = size;
    }
  }
  measured.packagedSourceBytes = calculatePackagedSourceBytes(projectRoot);

  for (const [name, limit] of Object.entries(budgets)) {
    if (measured[name] >= limit) {
      errors.push(`${name} exceeds its exclusive resource budget: ${measured[name]} >= ${limit} bytes`);
    }
  }
''',
    "required targets and exclusive budget boundary",
)
resource_budget = replace_once(
    resource_budget,
    '''  calculatePackagedSourceBytes,
  collectResourceBudgetErrors,
''',
    '''  calculatePackagedSourceBytes,
  collectResourceBudgetErrors,
  getFileSize,
''',
    "file-size helper export",
)
resource_budget_path.write_text(resource_budget, encoding="utf-8")


log_path = Path("src/main/async-log-writer.js")
log_source = log_path.read_text(encoding="utf-8")
log_source = replace_once(
    log_source,
    '''  return `${buffer.subarray(0, Math.max(0, maxBytes - 3)).toString("utf8")}...`;
''',
    '''  const byteLimit = Math.max(0, Math.trunc(Number(maxBytes) || 0));
  const suffix = Buffer.from("...", "utf8");
  if (byteLimit <= suffix.length) {
    return suffix.subarray(0, byteLimit).toString("utf8");
  }

  let end = byteLimit - suffix.length;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return Buffer.concat([buffer.subarray(0, end), suffix]).toString("utf8");
''',
    "UTF-8-safe log truncation",
)
log_path.write_text(log_source, encoding="utf-8")


controls_path = Path("src/renderer/resource-controls.js")
controls = controls_path.read_text(encoding="utf-8")
controls = replace_once(
    controls,
    '''      if (!force && currentTime - lastRunAt < interval) {
''',
    '''      if (!force && currentTime >= lastRunAt && currentTime - lastRunAt < interval) {
''',
    "backward-clock interval handling",
)
controls_path.write_text(controls, encoding="utf-8")


mqtt_path = Path("src/preload/mqtt-websocket.js")
mqtt = mqtt_path.read_text(encoding="utf-8")
mqtt = replace_once(
    mqtt,
    '''    this.pendingAcks = new Map();
    this.connectTimeoutHandle = null;
''',
    '''    this.pendingAcks = new Map();
    this.dataQueue = Promise.resolve();
    this.connectTimeoutHandle = null;
''',
    "serialized MQTT data queue",
)
mqtt = replace_once(
    mqtt,
    '''        void this.handleSocketData(event?.data);
''',
    '''        void this.handleSocketData(event?.data, socket);
''',
    "socket-scoped MQTT data handling",
)
mqtt = replace_block(
    mqtt,
    '''  async handleSocketData(data) {
''',
    '''  handlePacket(header, body) {
''',
    '''  handleSocketData(data, socket = this.socket) {
    this.dataQueue = this.dataQueue.then(() => this.consumeSocketData(data, socket));
    return this.dataQueue;
  }

  async consumeSocketData(data, socket) {
    try {
      let bytes;
      if (data instanceof ArrayBuffer) {
        bytes = Buffer.from(data);
      } else if (ArrayBuffer.isView(data)) {
        bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      } else if (typeof Blob !== "undefined" && data instanceof Blob) {
        bytes = Buffer.from(await data.arrayBuffer());
      } else {
        bytes = Buffer.from(data || []);
      }

      if (this.socket !== socket || this.ended) {
        return;
      }

      this.receiveBuffer = concatBuffers(this.receiveBuffer, bytes);
      while (this.receiveBuffer.length) {
        const frame = parsePacketFrame(this.receiveBuffer, this.options.maxPacketBytes);
        if (!frame) {
          break;
        }
        this.receiveBuffer = this.receiveBuffer.subarray(frame.consumed);
        this.handlePacket(frame.header, frame.body);
      }
    } catch (error) {
      if (this.socket !== socket || this.ended) {
        return;
      }
      this.emit("error", error);
      try {
        socket?.close();
      } catch {
        // Ignore teardown failures after malformed broker data.
      }
    }
  }

''',
    "serialized MQTT socket data consumption",
)
mqtt_path.write_text(mqtt, encoding="utf-8")


resource_test_path = Path("test/resource-budget.test.js")
resource_test = resource_test_path.read_text(encoding="utf-8")
if 'test("resource budget rejects unavailable required targets and exact exclusive limits"' not in resource_test:
    resource_test = resource_test.rstrip() + '''


test("resource budget rejects unavailable required targets and exact exclusive limits", (context) => {
  const root = createProject();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.rmSync(path.join(root, "preload.js"));
  let errors = collectResourceBudgetErrors(root).errors.join("\n");
  assert.match(errors, /missing or unreadable: preload\.js/);

  fs.writeFileSync(path.join(root, "preload.js"), "module.exports = {};\n");
  const mainSize = fs.statSync(path.join(root, "main.js")).size;
  errors = collectResourceBudgetErrors(root, { mainBytes: mainSize }).errors.join("\n");
  assert.match(errors, /mainBytes exceeds its exclusive resource budget/);
});

test("package budget rejects non-finite and non-positive limits", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-package-budget-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () => checkPackageBudget({ projectRoot: root, maxAsarBytes: Number.POSITIVE_INFINITY }),
    /finite positive number/
  );
  assert.throws(
    () => checkPackageBudget({ projectRoot: root, maxAsarBytes: 0 }),
    /finite positive number/
  );
});
'''
resource_test_path.write_text(resource_test + ("" if resource_test.endswith("\n") else "\n"), encoding="utf-8")


log_test_path = Path("test/async-log-writer.test.js")
log_test = log_test_path.read_text(encoding="utf-8")
log_test = replace_once(
    log_test,
    '''test("log text is byte bounded", () => {
  const value = sanitiseLogText("é".repeat(1000), 100);
  assert.ok(Buffer.byteLength(value) <= 103);
});
''',
    '''test("log text is exactly byte bounded without corrupting UTF-8", () => {
  const value = sanitiseLogText("é".repeat(1000), 100);
  assert.ok(Buffer.byteLength(value) <= 100);
  assert.doesNotMatch(value, /�/);
  assert.match(value, /\.\.\.$/);
});
''',
    "exact UTF-8 log budget test",
)
log_test_path.write_text(log_test, encoding="utf-8")


controls_test_path = Path("test/resource-controls.test.js")
controls_test = controls_test_path.read_text(encoding="utf-8")
controls_test = replace_once(
    controls_test,
    '''  currentTime = 1350;
  assert.equal(gate.shouldRun(), true);
  gate.reset();
''',
    '''  currentTime = 1350;
  assert.equal(gate.shouldRun(), true);
  currentTime = 1200;
  assert.equal(gate.shouldRun(), true);
  gate.reset();
''',
    "backward clock interval test",
)
controls_test_path.write_text(controls_test, encoding="utf-8")


mqtt_test_path = Path("test/mqtt-websocket.test.js")
mqtt_test = mqtt_test_path.read_text(encoding="utf-8")
if 'test("native adapter serializes asynchronous Blob frames in arrival order"' not in mqtt_test:
    mqtt_test = mqtt_test.rstrip() + '''


test("native adapter serializes asynchronous Blob frames in arrival order", async () => {
  const { client, socket } = connectClient();
  const messages = [];
  client.on("message", (topic, payload) => messages.push([topic, payload.toString("utf8")]));
  const firstPacket = createPacket(0x30, Buffer.concat([
    encodeUtf8String("first"),
    Buffer.from("1")
  ]));
  const secondPacket = createPacket(0x30, Buffer.concat([
    encodeUtf8String("second"),
    Buffer.from("2")
  ]));

  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  class DelayedBlob extends Blob {
    async arrayBuffer() {
      await firstGate;
      return super.arrayBuffer();
    }
  }

  const firstTask = client.handleSocketData(new DelayedBlob([firstPacket]), socket);
  const secondTask = client.handleSocketData(new Blob([secondPacket]), socket);
  await new Promise(setImmediate);
  assert.deepEqual(messages, []);
  releaseFirst();
  await Promise.all([firstTask, secondTask]);
  assert.deepEqual(messages, [["first", "1"], ["second", "2"]]);
  client.end(true);
});
'''
mqtt_test_path.write_text(mqtt_test + ("" if mqtt_test.endswith("\n") else "\n"), encoding="utf-8")

for file_path, fragments in {
    package_budget_path: ("resolveMaxAsarBytes", "finite positive number"),
    resource_budget_path: ("missing or unreadable", ">= ${limit}"),
    log_path: ("buffer[end] & 0xc0",),
    controls_path: ("currentTime >= lastRunAt",),
    mqtt_path: ("this.dataQueue", "consumeSocketData(data, socket)"),
}.items():
    source = file_path.read_text(encoding="utf-8")
    for fragment in fragments:
        if fragment not in source:
            raise SystemExit(f"missing reviewed fix in {file_path}: {fragment}")

print("Applied all reviewed Electron resource hardening fixes.")
