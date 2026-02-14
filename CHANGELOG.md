# Changelog

## v1.0.0 — 2026-02-14

Initial release.

### Commands
- `search` — search Are.na for channels, blocks, and users with type filtering, sorting, and pagination
- `channel` — browse channel contents with sort/type filters; `--connections` for graph traversal
- `block` — view a single block; `--connections` to find which channels it appears in
- `user` — view user profile and channel list
- `me` — authenticated user profile
- `cache clear` — clear file-based cache

### Search architecture
- Uses **Are.na v2 API** (`/v2/search`, `/v2/search/channels`, `/v2/search/blocks`, `/v2/search/users`) for public discovery — v3 search biases results toward the authenticated user's network
- Falls back to **v3 search** for `--scope my` and `--scope following` where auth-scoped results are intended
- v2 response fields (`class`, `length`, `status`, `user`) normalized to v3 shapes (`type`, `counts`, `visibility`, `owner`) via `normalizeV2()` in `lib/api.ts`
- Client-side sorting for `--sort created`, `--sort updated`, `--sort connections` (v2 doesn't support sort params reliably)

### Output formats
- Terminal (default) — concise, human-readable
- Markdown (`--markdown`) — research doc format
- JSON (`--json`) — raw API response

### Infrastructure
- Zero dependencies — pure Bun + TypeScript, no package.json
- File-based cache with configurable TTL (15min default, 1hr for `--quick`)
- 200ms inter-request delay for rate limit safety
- Token loaded from `ARENA_ACCESS_TOKEN` env var or `~/.config/env/global.env`
