function readMajorVersion(value) {
  const match = String(value || "").match(/^v?(\d+)/);
  return match ? Number.parseInt(match[1], 10) : NaN;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const nodeMajor = readMajorVersion(process.version);
if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
  fail(`Apollo Client requires Node.js 20 or newer. Current runtime: ${process.version}`);
}

const userAgent = String(process.env.npm_config_user_agent || "");
const npmMajor = readMajorVersion(userAgent.match(/\bnpm\/([^\s]+)/)?.[1] || "");
if (Number.isInteger(npmMajor) && npmMajor < 10) {
  fail(`Apollo Client requires npm 10 or newer. Current npm: ${npmMajor}`);
}
