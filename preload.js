const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("apolloDesktop", {
  platform: process.platform,
  serverUrl: process.env.APOLLO_SERVER_URL || "http://127.0.0.1:4848",
  versions: process.versions
});
