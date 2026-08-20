const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function importTrackModel() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "track-model.js"),
    "utf8"
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Date.now()}-${Math.random()}`);
}

test("track metadata text is normalized consistently", async () => {
  const { normaliseMetadataText } = await importTrackModel();

  assert.equal(normaliseMetadataText("  The\tSong\nName  "), "the song name");
  assert.equal(normaliseMetadataText("ＡＰＯＬＬＯ"), "apollo");
});

test("release dates are canonical and reject impossible dates", async () => {
  const { normaliseTrackReleaseDate } = await importTrackModel();

  assert.equal(normaliseTrackReleaseDate("2024/02/29"), "2024-02-29");
  assert.equal(normaliseTrackReleaseDate("2023-02-29"), "");
  assert.equal(normaliseTrackReleaseDate("2024-13"), "");
  assert.equal(normaliseTrackReleaseDate("2024-06-07T12:30:00Z"), "2024-06-07");
  assert.equal(normaliseTrackReleaseDate("1999"), "1999");
});

test("track metadata snapshots preserve useful normalized fields", async () => {
  const { buildTrackMetadataSnapshot } = await importTrackModel();

  assert.deepEqual(
    buildTrackMetadataSnapshot({
      artist: "Primary Artist",
      artists: "Primary Artist, Guest",
      albumArtist: "",
      trackNumber: "03/12",
      discNumber: 2,
      releaseDate: "2024/04/05",
      genre: ["Electronic", "Ambient", ""],
      explicit: "clean",
      provider: "deezer",
      sourceUrl: " https://example.test/track ",
      providerIds: {
        isrc: "US-AAA-24-00001"
      }
    }),
    {
      artists: ["Primary Artist", "Guest"],
      albumArtist: "Primary Artist",
      trackNumber: 3,
      discNumber: 2,
      releaseDate: "2024-04-05",
      releaseYear: 2024,
      genre: "Electronic, Ambient",
      explicit: false,
      sourcePlatform: "deezer",
      sourceUrl: "https://example.test/track",
      isrc: "US-AAA-24-00001"
    }
  );
});

test("provider ids are normalized and can identify equivalent tracks", async () => {
  const {
    hasMatchingProviderIds,
    normaliseProviderIds
  } = await importTrackModel();

  assert.deepEqual(normaliseProviderIds({ spotify: " abc ", youtube: 42 }), {
    spotify: "abc",
    youtube: "42",
    soundcloud: "",
    itunes: "",
    deezer: "",
    isrc: ""
  });

  assert.equal(
    hasMatchingProviderIds(
      { providerIds: { spotify: "abc" } },
      { providerIds: { spotify: " abc " } }
    ),
    true
  );
});

test("metadata equivalence tolerates small duration differences only", async () => {
  const {
    areTracksEquivalent,
    hasMatchingNormalizedMetadata
  } = await importTrackModel();

  const base = {
    key: "youtube:one",
    title: "  Same   Song ",
    artist: "The Artist",
    duration: 200
  };

  assert.equal(
    hasMatchingNormalizedMetadata(base, {
      key: "deezer:two",
      title: "same song",
      artist: "the artist",
      duration: 203
    }),
    true
  );
  assert.equal(
    areTracksEquivalent(base, {
      key: "deezer:three",
      title: "same song",
      artist: "the artist",
      duration: 204
    }),
    false
  );
  assert.equal(areTracksEquivalent(base, { ...base }), true);
  assert.equal(areTracksEquivalent({}, {}), false);
  assert.equal(
    areTracksEquivalent(
      { title: "First", artist: "Artist A" },
      { title: "Second", artist: "Artist B" }
    ),
    false
  );
});

test("playability accepts resolvable provider metadata without requiring a direct url", async () => {
  const { isTrackLikelyPlayable } = await importTrackModel();

  assert.equal(isTrackLikelyPlayable({
    key: "deezer:123",
    provider: "deezer",
    title: "Song",
    artist: "Artist"
  }), true);
  assert.equal(isTrackLikelyPlayable({
    key: "remote:123",
    provider: "remote",
    title: "Song",
    artist: "Artist"
  }), false);
  assert.equal(isTrackLikelyPlayable({
    key: "custom:123",
    provider: "custom",
    title: "Song",
    artist: "Artist"
  }), false);
  assert.equal(isTrackLikelyPlayable({
    key: "remote:direct",
    provider: "remote",
    title: "Song",
    artist: "Artist",
    externalUrl: "https://example.test/audio"
  }), true);
  assert.equal(isTrackLikelyPlayable({
    key: "youtube:unknown",
    provider: "youtube",
    title: "Unknown Title",
    artist: "Artist"
  }), false);
  assert.equal(isTrackLikelyPlayable({
    key: "library:disabled",
    provider: "library",
    trackId: "disabled",
    playable: false
  }), false);
});

test("generic provider album labels are excluded from recommendation matching", async () => {
  const { isGenericAlbumName } = await importTrackModel();

  assert.equal(isGenericAlbumName(" YouTube "), true);
  assert.equal(isGenericAlbumName("Actual Album"), false);
});
