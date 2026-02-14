# Are.na v3 API Reference

## Authentication

Personal access token from env var `ARENA_ACCESS_TOKEN`.

```
-H "Authorization: Bearer $ARENA_ACCESS_TOKEN"
```

Get a token at: https://www.are.na/settings/personal-access-tokens

Most endpoints work without auth (public content). Auth required for:
- `GET /v3/me`
- Private channels you're a member of
- Search with `scope=my` or `scope=following`

## Base URL

```
https://api.are.na/v3
```

## Rate Limits

| Tier | Requests/Minute |
|------|----------------|
| Guest (no auth) | 30 |
| Free | 120 |
| Premium | 300 |
| Supporter/Lifetime | 600 |

Response headers on every request:
- `X-RateLimit-Limit` — your tier's per-minute limit
- `X-RateLimit-Tier` — current tier (guest/free/premium/supporter)
- `X-RateLimit-Window` — always 60 (seconds)
- `X-RateLimit-Reset` — unix timestamp when limit resets

429 response when exceeded. Back off and retry after reset.

## Pagination

All list endpoints accept:
- `page` — page number (default: 1)
- `per` — items per page (default: 24, max: 100)

Response includes `meta` object:
```json
{
  "data": [...],
  "meta": {
    "current_page": 1,
    "next_page": 2,
    "prev_page": null,
    "per_page": 24,
    "total_pages": 5,
    "total_count": 120,
    "has_more_pages": true
  }
}
```

## Search

### CRITICAL: v2 for public discovery, v3 for auth-scoped search

The v3 search endpoint (`/v3/search`) is broken for public discovery — when authenticated, it
heavily biases results toward the token owner's network regardless of `scope=all`. Results are
dominated by the user's own channels/blocks and are essentially useless for finding new content.

**Solution:** Use the **v2 search endpoints** for public discovery. v2 search returns globally
relevant results even when an auth token is present (`authenticated: false` in response).

Use v3 search **only** for `--scope my` and `--scope following`, where auth-scoped results are
the desired behavior.

### v2 Search (public discovery — default)

Base URL: `https://api.are.na/v2`

**Endpoints by type:**

| Endpoint | Returns |
|----------|---------|
| `GET /v2/search?q={query}&per=&page=` | Mixed results (channels + blocks + users) |
| `GET /v2/search/channels?q={query}&per=&page=` | Channels only |
| `GET /v2/search/blocks?q={query}&per=&page=` | Blocks only |
| `GET /v2/search/users?q={query}&per=&page=` | Users only |

**Parameters:**

| Param | Values | Default |
|-------|--------|---------|
| `q` | query string (required) | — |
| `per` | integer (max 100) | 24 |
| `page` | integer | 1 |

**v2 does NOT reliably support `sort` or `scope` params.** Results are returned in API-default
relevance order. Client-side sorting is applied for `--sort created`, `--sort updated`, and
`--sort connections` (using `length` / item count as proxy).

**v2 Response shape (flat — NOT the same as v3):**
```json
{
  "term": "community radio",
  "per": 10,
  "current_page": 1,
  "total_pages": 4,
  "length": 10,
  "authenticated": false,
  "channels": [...],
  "blocks": [...],
  "users": [...]
}
```

**v2 field name differences from v3 (normalized in `lib/api.ts`):**

| v2 field | v3 equivalent | Notes |
|----------|--------------|-------|
| `class` | `type` | `"Channel"`, `"Link"`, `"Image"`, `"User"`, etc. |
| `base_class` | `base_type` | `"Channel"` or `"Block"` |
| `length` | `counts.contents` | Item count for channels |
| `status` | `visibility` | `"public"`, `"closed"`, `"private"` |
| `user` | `owner` | On channels; v2 uses `{username, full_name, slug, avatar}` |
| `user.username` | `owner.slug` | |
| `user.full_name` | `owner.name` | |
| `collaborator_count` | `counts.collaborators` | |
| `follower_count` | `counts.followers` | On users |
| `channel_count` | `counts.channels` | On users |

**v2 Channel object example:**
```json
{
  "id": 2500046,
  "class": "Channel",
  "base_class": "Channel",
  "title": "community + radio",
  "slug": "community-radio-allffjcwo8k",
  "length": 7,
  "status": "public",
  "created_at": "2023-11-16T03:01:36.029Z",
  "updated_at": "2024-01-10T05:12:00.000Z",
  "published": true,
  "open": true,
  "collaboration": false,
  "collaborator_count": 0,
  "follower_count": 0,
  "can_index": true,
  "nsfw?": false,
  "owner_id": 12345,
  "owner_slug": "lisa-glenn",
  "owner_type": "User",
  "user_id": 12345,
  "user": {
    "created_at": "...",
    "slug": "lisa-glenn",
    "username": "lisa-glenn",
    "first_name": "lisa",
    "last_name": "glenn",
    "full_name": "lisa glenn",
    "avatar": "...",
    "avatar_image": {...}
  },
  "metadata": {"description": "..."}
}
```

### v3 Search (auth-scoped only — `--scope my` / `--scope following`)

```
GET /v3/search?q={query}
```

| Param | Values | Default |
|-------|--------|---------|
| `q` | query string (required) | — |
| `type` | `Channel`, `Block`, `Text`, `Image`, `Link`, `Attachment`, `Embed`, `User`, `Group` | all types |
| `sort` | `score_desc`, `created_at_desc`, `created_at_asc`, `updated_at_desc`, `updated_at_asc`, `name_asc`, `name_desc`, `connections_count_desc`, `random` | `score_desc` |
| `scope` | `all`, `my`, `following` | `all` |
| `page` | integer | 1 |
| `per` | integer (max 100) | 24 |

`scope=my` and `scope=following` require authentication. `scope=all` is sent explicitly but
the v3 endpoint still biases toward the authenticated user's network — this is why v3 is only
used for intentionally auth-scoped searches.

**v3 Response shape:**
```json
{
  "data": [...],
  "meta": {
    "current_page": 1,
    "next_page": 2,
    "prev_page": null,
    "per_page": 24,
    "total_pages": 5,
    "total_count": 120,
    "has_more_pages": true
  }
}
```

## Channels

### Get Channel

```
GET /v3/channels/{slug_or_id}
```

```bash
curl -s "https://api.are.na/v3/channels/arena-influences"
```

Response (single object, not wrapped in `data`):
```json
{
  "id": 275,
  "type": "Channel",
  "created_at": "2011-08-12T17:53:48Z",
  "updated_at": "2026-02-11T06:07:17Z",
  "slug": "arena-influences",
  "title": "Arena Influences",
  "description": {
    "markdown": "...",
    "html": "...",
    "plain": "..."
  },
  "state": "available",
  "visibility": "closed",
  "owner": {
    "id": 289,
    "type": "Group",
    "name": "Are.na Team",
    "slug": "are-na-team"
  },
  "counts": {
    "blocks": 126,
    "channels": 2,
    "contents": 128,
    "collaborators": 9
  },
  "_links": {
    "self": {"href": "..."},
    "owner": {"href": "..."},
    "contents": {"href": "..."},
    "connections": {"href": "..."},
    "followers": {"href": "..."}
  }
}
```

### Get Channel Contents

```
GET /v3/channels/{slug_or_id}/contents
```

Parameters: `page`, `per`, `sort` (position, created_at_desc, updated_at_desc), `type` (Text, Image, Link, Attachment, Embed, Channel, Block)

Returns paginated blocks and nested channels. Each block includes a `connection` field with channel-specific metadata:

```json
{
  "data": [{
    "id": 3235876,
    "type": "Link",
    "base_type": "Block",
    "title": "Isaac Asimov Asks, \"How Do People Get New Ideas?\"",
    "description": {
      "markdown": "...",
      "plain": "..."
    },
    "state": "available",
    "visibility": "public",
    "user": {
      "id": 15,
      "name": "Charles Broskoski",
      "slug": "charles-broskoski"
    },
    "source": {
      "url": "https://www.technologyreview.com/s/531911/...",
      "title": "Isaac Asimov Asks, \"How Do People Get New Ideas?\" - MIT Technology Review",
      "provider": {
        "name": "www.technologyreview.com",
        "url": "https://www.technologyreview.com"
      }
    },
    "content": null,
    "connection": {
      "id": 12345,
      "position": 1,
      "pinned": false,
      "connected_at": "2018-12-19T20:35:55Z",
      "connected_by": {"id": 15, "name": "Charles Broskoski"}
    },
    "_links": {
      "self": {"href": "..."},
      "connections": {"href": "..."},
      "comments": {"href": "..."}
    }
  }],
  "meta": {"current_page": 1, "total_pages": 64, "total_count": 128, "has_more_pages": true}
}
```

### Get Channel Connections

```
GET /v3/channels/{slug_or_id}/connections
```

Returns channels that share blocks with this channel. Full channel objects with counts.

```bash
curl -s "https://api.are.na/v3/channels/arena-influences/connections?per=10"
```

Response: paginated list of Channel objects (same shape as search results).

**Note:** The `arena-influences` channel has 150 connections. This is the graph traversal endpoint — it shows where content from this channel also lives.

### Channel Thumb

`/v3/channels/{slug}/thumb` returns 404 on v3. Not available. Use the main channel endpoint instead.

## Blocks

### Get Block

```
GET /v3/blocks/{id}
```

```bash
curl -s "https://api.are.na/v3/blocks/3235876"
```

Response (single object). Shape depends on `type` field:

**Block types:**
- `Text` — has `content` field (markdown text)
- `Image` — has `image` field (multi-resolution URLs)
- `Link` — has `source.url` (the linked URL), may also have `image` and `content`
- `Attachment` — has `attachment` field (file URL)
- `Embed` — has `embed` field (video/audio)

**Link block example:**
```json
{
  "id": 3235876,
  "type": "Link",
  "base_type": "Block",
  "title": "Isaac Asimov Asks, \"How Do People Get New Ideas?\"",
  "description": {
    "markdown": "Note from Arthur Obermayer...",
    "plain": "Note from Arthur Obermayer..."
  },
  "state": "available",
  "visibility": "public",
  "comment_count": 0,
  "user": {
    "id": 15,
    "type": "User",
    "name": "Charles Broskoski",
    "slug": "charles-broskoski"
  },
  "source": {
    "url": "https://www.technologyreview.com/s/531911/...",
    "title": "Isaac Asimov Asks, \"How Do People Get New Ideas?\" - MIT Technology Review",
    "provider": {
      "name": "www.technologyreview.com",
      "url": "https://www.technologyreview.com"
    }
  },
  "content": null,
  "image": { "src": "...", "small": {...}, "medium": {...}, "large": {...} },
  "_links": {
    "self": {"href": "..."},
    "user": {"href": "..."},
    "connections": {"href": "..."},
    "comments": {"href": "..."}
  }
}
```

### Get Block Connections

```
GET /v3/blocks/{id}/connections
```

Returns all channels this block appears in. **This is the key graph traversal endpoint.** A block in many channels = high signal content.

```bash
curl -s "https://api.are.na/v3/blocks/3235876/connections?per=10"
```

Response: paginated list of Channel objects with full metadata (title, slug, owner, counts, visibility).

Example: block 3235876 appears in 28 channels (`total_count: 28`).

### Get Block Comments

```
GET /v3/blocks/{id}/comments
```

Paginated list of comments. Most blocks have 0 comments. Low priority for research.

## Users

### Get User

```
GET /v3/users/{slug_or_id}
```

```bash
curl -s "https://api.are.na/v3/users/charles-broskoski"
```

```json
{
  "id": 15,
  "type": "User",
  "name": "Charles Broskoski",
  "slug": "charles-broskoski",
  "avatar": "https://...",
  "initials": "CB",
  "bio": {
    "markdown": "One of the many Are.na co-founders...",
    "plain": "..."
  },
  "counts": {
    "channels": 441,
    "followers": 4821,
    "following": 10855
  },
  "_links": {
    "self": {"href": "..."},
    "contents": {"href": "..."},
    "followers": {"href": "..."},
    "following": {"href": "..."}
  }
}
```

### Get User Contents

```
GET /v3/users/{slug_or_id}/contents
```

Returns the user's channels. Paginated.

## Authenticated User

```
GET /v3/me
```

Returns same shape as User but for the authenticated user. Requires auth.

## System

```
GET /v3/ping
```

Health check. Returns 200 with empty body.

## Constructing Are.na URLs

```
Channel: https://www.are.na/{owner_slug}/{channel_slug}
Block:   https://www.are.na/block/{block_id}
User:    https://www.are.na/{user_slug}
```

## Key Observations from Testing

1. **`type` is the discriminator.** Channels have `type: "Channel"`, blocks have `type: "Link"` / `"Image"` / `"Text"` etc., users have `type: "User"`.
2. **`base_type: "Block"`** appears on all block types in addition to the specific type.
3. **Single objects (channel, block, user) are returned directly**, not wrapped in `data`. List endpoints return `{data: [...], meta: {...}}`.
4. **`_links` on every object** provides HATEOAS-style navigation. Useful for following connections.
5. **`counts` on channels** gives `blocks`, `channels`, `contents` (blocks + channels), and `collaborators` without fetching contents.
6. **`owner` can be User or Group** — check `owner.type`.
7. **`description` is an object** with `markdown`, `html`, and `plain` variants (not a plain string). Can be null.
8. **`source.url` on Link blocks** is the external URL being saved. This is what you WebFetch for deep-dives.
9. **`connection` field in channel contents** shows position, pinned status, and who connected it.
10. **v3 search is broken for discovery.** When authenticated, `score_desc` and `connections_count_desc` both return results biased toward the token owner's network. `scope=all` is ignored. Use v2 search for public discovery.
11. **v2 search uses `class` instead of `type`** and has different field names. `lib/api.ts` normalizes v2 responses to v3 shapes via `normalizeV2()`.
12. **v2 search uses separate endpoints per type** (`/v2/search/channels`, `/v2/search/blocks`, `/v2/search/users`) rather than a `type` query param.
13. **v2 search requires auth** — unauthenticated requests get 401 — but the response says `authenticated: false` and returns globally relevant results (not scoped to user network).
