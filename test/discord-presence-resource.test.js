const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

class FakeDiscordClient extends EventEmitter {
  constructor() {
    super();
    this.activities = [];
  }

  async login() {
    this.emit("ready");
  }

  async subscribe() {}

  async setActivity(activity) {
    this.activities.push(activity);
  }

  async clearActivity() {}

  async destroy() {}
}

test("Discord RPC remains unloaded until enabled playback requires it", async () => {
  let loadCount = 0;
  let client = null;
  const fakeRpc = {
    Client: class extends FakeDiscordClient {
      constructor() {
        super();
        client = this;
      }
    },
    register() {}
  };
  const { createDiscordPresenceController } = require("../discord-presence");
  const controller = createDiscordPresenceController({
    loadRpc() {
      loadCount += 1;
      return fakeRpc;
    }
  });

  await controller.configure({
    enabled: true,
    clientId: "1234567890"
  });
  assert.equal(loadCount, 0);

  await controller.updatePlayback({
    title: "Song",
    artist: "Artist",
    status: "playing",
    duration: 180,
    currentTime: 10
  });
  assert.equal(loadCount, 1);
  assert.equal(client.activities.length, 1);

  await controller.updatePlayback({
    title: "Song",
    artist: "Artist",
    status: "paused"
  });
  assert.equal(loadCount, 1);
  await controller.destroy();
});
