function readVersion(value) {
  const match = String(value || "").match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map((part) => Number.parseInt(part, 10)) : null;
}

function isAtLeast(version, minimum) {
  if (!version) {
    return false;
  }
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] !== minimum[index]) {
      return version[index] > minimum[index];
    }
  }
  return true;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const nodeVersion = readVersion(process.version);
if (!isAtLeast(nodeVersion, [22, 12, 0])) {
  fail(`Apollo Client requires Node.js 22.12 or newer. Current runtime: ${process.version}`);
}

const userAgent = String(process.env.npm_config_user_agent || "");
const npmVersion = readVersion(userAgent.match(/\bnpm\/([^\s]+)/)?.[1] || "");
if (npmVersion && !isAtLeast(npmVersion, [10, 0, 0])) {
  fail(`Apollo Client requires npm 10 or newer. Current npm: ${npmVersion.join(".")}`);
}

module.exports = {
  isAtLeast,
  readVersion
};
