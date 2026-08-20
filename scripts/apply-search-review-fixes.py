from pathlib import Path


# This script is temporary and is removed after the validated application commit.
def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return source.replace(old, new, 1)


renderer_path = Path("src/renderer.js")
renderer = renderer_path.read_text(encoding="utf-8")
renderer = replace_once(
    renderer,
    "const localTrackSearch = createTrackSearchEngine({\n  maxIndexes: 18\n});",
    "const localTrackSearch = createTrackSearchEngine({\n  maxIndexes: 8\n});",
    "bounded collection index cache"
)
renderer = replace_once(
    renderer,
    '''  if (!trimmedQuery || !state.settings.search.includeLibraryResults) {
    return [];
  }
''',
    '''  if (!trimmedQuery) {
    return [];
  }

  if (!state.settings.search.includeLibraryResults && !isCollectionScopedSearch()) {
    return [];
  }
''',
    "collection-scoped local filtering"
)
for fragment in (
    "maxIndexes: 8",
    "!state.settings.search.includeLibraryResults && !isCollectionScopedSearch()",
):
    if fragment not in renderer:
        raise SystemExit(f"missing renderer review fix: {fragment}")
renderer_path.write_text(renderer, encoding="utf-8")


index_path = Path("src/renderer/search-index.js")
index_source = index_path.read_text(encoding="utf-8")
index_source = replace_once(
    index_source,
    "const MAX_PREFIX_LENGTH = 16;\nconst SUBSTRING_GRAM_LENGTH = 3;",
    "const SUBSTRING_GRAM_LENGTH = 3;\nconst MAX_PREFIX_LENGTH = SUBSTRING_GRAM_LENGTH;",
    "short-prefix posting bound"
)
if "const MAX_PREFIX_LENGTH = SUBSTRING_GRAM_LENGTH;" not in index_source:
    raise SystemExit("missing bounded prefix length")
index_path.write_text(index_source, encoding="utf-8")

print("Applied collection filtering and bounded prefix-index fixes.")
