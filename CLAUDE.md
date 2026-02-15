# Arena Research Skill

CLI tool for searching and browsing Are.na. Designed as a skill for Claude Code and OpenClaw.

## Stack
- Bun + TypeScript (no build step, no external dependencies)
- Are.na v2 REST API for search (https://api.are.na/v2/) — public discovery
- Are.na v3 REST API for everything else (https://api.are.na/v3/) — channels, blocks, users
- File-based cache (same pattern as x-research)

## Reference Implementation
Follow the x-research skill at `~/.openclaw/workspace/skills/x-research/` as the reference for all patterns:
- Token loading: `lib/api.ts` → reads `process.env.ARENA_ACCESS_TOKEN`
- Cache: `lib/cache.ts` → MD5 key, file-based JSON, configurable TTL
- Formatters: `lib/format.ts` → terminal (default) and markdown
- CLI: `arena-search.ts` → arg parsing, command dispatch, flag/option extraction
- File structure, naming, error handling — match x-research exactly

## Commands
```
arena-search.ts search "<query>" [options]    Search Are.na
arena-search.ts channel <slug-or-id> [opts]   Browse channel contents
arena-search.ts block <id> [opts]             View a single block
arena-search.ts user <slug-or-id> [opts]      View user profile + channels
arena-search.ts me                            Authenticated user profile
arena-search.ts cache clear                   Clear cache
```

## Architecture
```
arena-search.ts          — CLI entry point, arg parsing, command dispatch
lib/api.ts               — Are.na API wrapper (v2 search + v3 everything else)
lib/cache.ts             — File-based cache with configurable TTL (copy x-research pattern exactly)
lib/format.ts            — Output formatters (terminal default, --markdown, --json)
data/cache/              — Auto-managed cache directory
references/arena-api.md  — Full API reference with confirmed v2/v3 response shapes
```

## API Details

### CRITICAL: Search uses v2, everything else uses v3

**Search** uses Are.na **v2** (`https://api.are.na/v2`) for public discovery.
The v3 search endpoint is broken — when authenticated, it biases results toward the token
owner's network regardless of `scope=all`. v2 returns globally relevant results.

v3 search is only used as fallback for `--scope my` and `--scope following`.

**All other endpoints** (channels, blocks, users, me) use v3 (`https://api.are.na/v3`).

### Key Endpoints

| Method | Endpoint | Returns |
|--------|----------|---------|
| GET | `/v2/search?q={query}&per=&page=` | `{channels: [], blocks: [], users: [], ...}` (v2 flat) |
| GET | `/v2/search/channels?q={query}&per=&page=` | Channels only (v2 flat) |
| GET | `/v2/search/blocks?q={query}&per=&page=` | Blocks only (v2 flat) |
| GET | `/v2/search/users?q={query}&per=&page=` | Users only (v2 flat) |
| GET | `/v3/search?q={query}&type=&sort=&scope=&page=&per=` | `{data: [...], meta: {...}}` (v3, auth-scoped only) |
| GET | `/v3/channels/{slug_or_id}` | Single channel object (NOT wrapped in data) |
| GET | `/v3/channels/{id}/contents?sort=&type=&page=&per=` | `{data: [...], meta: {...}}` |
| GET | `/v3/channels/{id}/connections?page=&per=` | `{data: [Channel...], meta: {...}}` |
| GET | `/v3/blocks/{id}` | Single block object (NOT wrapped in data) |
| GET | `/v3/blocks/{id}/connections?page=&per=` | `{data: [Channel...], meta: {...}}` |
| GET | `/v3/users/{slug_or_id}` | Single user object |
| GET | `/v3/users/{id}/contents?page=&per=` | `{data: [...], meta: {...}}` |
| GET | `/v3/me` | Single user object (requires auth) |
| GET | `/v3/ping` | Empty 200 |

### CRITICAL: Response shape differences
- **v2 search** returns flat: `{term, per, current_page, total_pages, length, authenticated, channels: [], blocks: [], users: []}`
- **v2 uses `class` instead of `type`** and different field names — `normalizeV2()` in `lib/api.ts` converts to v3 shapes
- **v3 single objects** (channel by slug, block by id, user by slug, me) return the object directly — NOT wrapped in `{data: ...}`
- **v3 list endpoints** (search, contents, connections, user contents) return `{data: [...], meta: {...}}`

### v2 Search Type Mapping
| `--type` flag | v2 endpoint |
|---------------|-------------|
| (none) | `/v2/search` (mixed results) |
| `Channel` | `/v2/search/channels` |
| `Block`, `Text`, `Image`, `Link`, `Attachment`, `Embed` | `/v2/search/blocks` |
| `User` | `/v2/search/users` |

### v2 Search Limitations
- **No `sort` param** — results returned in API-default relevance order
- **No `scope` param** — always searches globally
- **No `type` param** — use the type-specific endpoints instead
- Client-side sorting applied for `--sort created`, `--sort updated`, `--sort connections`
- `--sort score` and `--sort random` return results as-is from API

### v3 Search Parameters (auth-scoped only)
- `q` — query string (required)
- `type` — `Channel`, `Block`, `Text`, `Image`, `Link`, `Attachment`, `Embed`, `User`, `Group`
- `sort` — `score_desc`, `created_at_desc`, `created_at_asc`, `updated_at_desc`, `updated_at_asc`, `name_asc`, `name_desc`, `connections_count_desc`, `random`
- `scope` — `all` (default), `my`, `following` (last two require auth)
- `page`, `per` (max 100)

### Channel Contents Parameters
- `sort` — `position` (default, manual order), `created_at_desc`, `updated_at_desc`
- `type` — `Text`, `Image`, `Link`, `Attachment`, `Embed`, `Channel`, `Block`
- `page`, `per`

### Pagination Meta
```json
{
  "current_page": 1,
  "next_page": 2,
  "prev_page": null,
  "per_page": 24,
  "total_pages": 5,
  "total_count": 120,
  "has_more_pages": true
}
```

## Data Model

### Channel
```typescript
interface Channel {
  id: number;
  type: "Channel";
  created_at: string;
  updated_at: string;
  slug: string;
  title: string;
  description: Description | null;  // {markdown, html, plain} or null
  state: string;
  visibility: "public" | "closed" | "private";
  owner: Owner;          // {id, type: "User"|"Group", name, slug, avatar, initials}
  counts: {
    blocks: number;
    channels: number;
    contents: number;     // blocks + channels
    collaborators: number;
  };
  can: { add_to: boolean; update: boolean; destroy: boolean; manage_collaborators: boolean };
  _links: HypermediaLinks;
}
```

### Block (discriminated union on `type`)
```typescript
interface BlockBase {
  id: number;
  type: "Text" | "Image" | "Link" | "Attachment" | "Embed";
  base_type: "Block";
  created_at: string;
  updated_at: string;
  title: string;
  description: Description | null;
  state: "available" | "processing" | "failed";
  visibility: "public" | "private" | "closed";
  comment_count: number;
  user: UserStub;
  source: Source | null;        // {url, title, provider: {name, url}} — present on Link blocks
  can: { manage: boolean; comment: boolean; connect: boolean };
  _links: HypermediaLinks;
}

// In channel contents responses, blocks also have:
interface ConnectionMeta {
  connection: {
    id: number;
    position: number;
    pinned: boolean;
    connected_at: string;
    connected_by: { id: number; name: string };
  };
}

// Type-specific fields:
// Link:       source.url is the external URL. May also have image and content.
// Text:       content field has {markdown, html, plain} with the text content.
// Image:      image field has {src, width, height, small, medium, large, square}.
// Attachment: attachment field has file URL.
// Embed:      embed field has embed URL.
```

### User
```typescript
interface User {
  id: number;
  type: "User";
  created_at: string;
  updated_at: string;
  name: string;
  slug: string;
  avatar: string | null;
  initials: string;
  bio: Description | null;   // {markdown, html, plain}
  counts: {
    channels: number;
    followers: number;
    following: number;
  };
  _links: HypermediaLinks;
}
```

### Shared Types
```typescript
interface Description {
  markdown: string;
  html: string;
  plain: string;
}

interface Owner {
  id: number;
  type: "User" | "Group";
  name: string;
  slug: string;
  avatar: string | null;
  initials: string;
}

type UserStub = Owner;  // Same shape when embedded in blocks

interface Source {
  url: string;
  title: string;
  provider: { name: string; url: string };
}
```

## Auth
- `ARENA_ACCESS_TOKEN` read from `process.env.ARENA_ACCESS_TOKEN`
- Bearer token in Authorization header: `Authorization: Bearer {token}`
- Most endpoints work without auth (public content)
- Auth needed for: `/v3/me`, private channels, `--scope my|following`
- The skill does NOT read token files — it expects the env var to be set by the agent framework or shell environment

## Rate Limits
- Guest: 30 req/min, Free: 120, Premium: 300, Supporter: 600
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Tier`, `X-RateLimit-Window`, `X-RateLimit-Reset`
- On 429: parse `X-RateLimit-Reset` header, wait, retry
- Cache prevents redundant requests (15min default TTL, 1hr for --quick)
- Use 200ms delay between requests as safety buffer

## CLI Flag Mapping

### Search flags → API params
| Flag | API param |
|------|-----------|
| `--type Channel` | `type=Channel` |
| `--sort score` | `sort=score_desc` |
| `--sort created` | `sort=created_at_desc` |
| `--sort updated` | `sort=updated_at_desc` |
| `--sort connections` | `sort=connections_count_desc` |
| `--sort random` | `sort=random` |
| `--scope my` | `scope=my` |
| `--scope following` | `scope=following` |
| `--per N` | `per=N` |
| `--page N` | `page=N` |

### Channel flags → API params
| Flag | API param |
|------|-----------|
| `--sort position` | `sort=position` (default) |
| `--sort created` | `sort=created_at_desc` |
| `--sort updated` | `sort=updated_at_desc` |
| `--type Link` | `type=Link` |
| `--connections` | Fetch `/v3/channels/{id}/connections` instead of contents |

### Quick mode overrides
When `--quick` is passed:
- `--type Channel` (force channels only)
- `--sort connections` (most-connected first)
- `--per 10` (small result set)
- Cache TTL: 1 hour instead of 15 minutes

## Output Formatting

### Terminal (default)
For channels:
```
Channel Title | by Owner Name | N items | visibility
  https://www.are.na/owner-slug/channel-slug
  Description preview (first 100 chars)...
```

For blocks:
```
[Link] Block Title
  URL: https://source-url.com/...
  Desc: Description preview...
  Block ID: 12345
```

For users:
```
User Name (@slug)
  N channels | N followers
  Bio: bio preview...
  https://www.are.na/slug
```

For block connections:
```
This block appears in N channels:

Channel Title | by Owner | N items
  https://www.are.na/owner/slug
```

For channel connections:
```
N connected channels:

Channel Title | by Owner | N items
  https://www.are.na/owner/slug
```

### Markdown (--markdown)
Research doc format matching x-research's `formatResearchMarkdown`.

### JSON (--json)
Raw API response, pretty-printed.

## Constructing Are.na URLs
```
Channel: https://www.are.na/{owner.slug}/{channel.slug}
Block:   https://www.are.na/block/{block.id}
User:    https://www.are.na/{user.slug}
```

## Conventions
- Follow x-research patterns EXACTLY (token loading, cache, CLI args, output format)
- No package.json — zero dependencies, pure Bun
- Error messages should be user-friendly, not raw API errors
- 401 → "ARENA_ACCESS_TOKEN not configured. Get one from https://www.are.na/settings/personal-access-tokens"
- 403 → "This channel is private. You need to be a collaborator to view it."
- 404 → "Channel/block/user not found: {slug}"
- 429 → "Rate limited. Resets in Ns. Your tier: {tier}"
- `description` is always `{markdown, html, plain}` or null — never a plain string. Use `.plain` for terminal output.
- `owner.type` can be "User" or "Group" — handle both when constructing URLs

## Environment Variables
- `ARENA_ACCESS_TOKEN` — personal access token from https://www.are.na/settings/personal-access-tokens

## Gotchas
- **v3 search is broken for discovery** — when authenticated, results are biased toward the token owner's network. `scope=all` is ignored. Always use v2 search for public discovery. v3 search is only for `--scope my` / `--scope following`.
- **v2 search uses different field names** — `class` instead of `type`, `length` instead of `counts.contents`, `status` instead of `visibility`, `user` instead of `owner`. The `normalizeV2()` function in `lib/api.ts` handles this translation.
- **v2 search requires auth but reports `authenticated: false`** — the token must be sent (401 without it) but the response ignores the user's network for ranking.
- Are.na v3 API is "work in progress" — some endpoints may change
- Pagination uses `page`/`per` (not cursor-based)
- Block `type` field is the discriminator: "Text", "Image", "Link", "Attachment", "Embed"
- `base_type: "Block"` appears on all block types in addition to the specific type
- Slug OR numeric ID accepted for channels and users
- Search `scope: my|following` requires authentication
- Rate limit tier shown in response headers, not body
- `/v3/channels/:slug/thumb` does NOT exist in v3 (returns 404)
- Single-object endpoints return raw object; list endpoints return `{data, meta}`
- Image blocks have massive response bodies (multiple resolution URLs) — keep terminal output concise
