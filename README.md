# arena-research

Are.na research agent for [Claude Code](https://code.claude.com) and [OpenClaw](https://openclaw.ai). Search, browse channels, follow the connection graph — all from the terminal.

## What it does

Wraps the Are.na API into a fast CLI so your AI agent (or you) can search for curated collections, browse channel contents, follow block connections across channels, and discover how people organize ideas.

- **Search** across channels, blocks, and users with type filtering
- **Browse** channel contents with sorting and type filters
- **Graph traversal** — find which channels a block appears in, or which channels share content
- **Quick mode** for fast, cached lookups
- **User profiles** — explore a curator's channels
- **Cache** to avoid redundant API calls (15min default, 1hr in quick mode)

## Install

### Claude Code
```bash
# From your project
mkdir -p .claude/skills
cd .claude/skills
git clone https://github.com/givenness/arena-research-skill.git arena-research
```

### OpenClaw
```bash
# From your workspace
mkdir -p skills
cd skills
git clone https://github.com/givenness/arena-research-skill.git arena-research
```

## Setup

1. **Are.na Personal Access Token** — Get one from [Are.na Settings](https://www.are.na/settings/personal-access-tokens)
2. **Set the env var:**
   ```bash
   export ARENA_ACCESS_TOKEN="your-token-here"
   ```
   Or save it to `~/.config/env/global.env`:
   ```
   ARENA_ACCESS_TOKEN=your-token-here
   ```
3. **Install Bun** (for CLI tooling): https://bun.sh

Most endpoints work with public content, but search requires a token.

## Usage

### Natural language (just talk to Claude)
- "Search Are.na for community radio"
- "What channels are about tools for thought?"
- "Browse the arena-influences channel"
- "Who's curating brutalist web design on Are.na?"
- "What other channels does this block appear in?"

### CLI commands

```bash
cd skills/arena-research
```

#### Search

```bash
# Search everything
bun run arena-search.ts search "community radio"

# Channels only
bun run arena-search.ts search "tools for thought" --type Channel

# Links only (external references)
bun run arena-search.ts search "cybernetics" --type Link --per 50

# Search your own collections
bun run arena-search.ts search "design" --scope my

# Search content from people you follow
bun run arena-search.ts search "design" --scope following

# Quick mode
bun run arena-search.ts search "brutalist web design" --quick
```

**Search options:**
```
--type Channel|Block|Text|Image|Link|User   Filter result type
--sort score|created|updated|connections     Sort order (default: score)
--scope all|my|following                     Search scope (default: all)
--per N                                      Results per page (default: 24, max: 100)
--page N                                     Page number
--quick                                      Quick mode (see below)
--save                                       Save to ~/clawd/drafts/
--json                                       Raw JSON output
--markdown                                   Formatted markdown output
```

#### Channel

```bash
# Browse channel contents
bun run arena-search.ts channel arena-influences

# Links only
bun run arena-search.ts channel arena-influences --type Link --per 50

# Sort by most recent
bun run arena-search.ts channel arena-influences --sort created

# Find connected channels (channels that share blocks with this one)
bun run arena-search.ts channel arena-influences --connections
```

**Channel options:**
```
--sort position|created|updated   Content sort (default: position)
--type Text|Image|Link|Channel    Filter content type
--per N / --page N                Pagination
--connections                     Show connected channels instead of contents
--save / --json / --markdown      Output format
```

#### Block

```bash
# View a single block
bun run arena-search.ts block 3235876

# Find which channels this block appears in
bun run arena-search.ts block 3235876 --connections
```

A block in many channels = high-signal content. The channels it appears in show how different people contextualize the same idea.

#### User

```bash
# View user profile and channels
bun run arena-search.ts user charles-broskoski
```

#### Me

```bash
# Your own profile (requires token)
bun run arena-search.ts me
```

#### Cache

```bash
# Clear all cached data
bun run arena-search.ts cache clear
```

## Quick Mode

`--quick` is designed for fast, cheap lookups.

**What it does:**
- Forces `--type Channel` (channels only)
- Forces `--sort connections` (most-connected first)
- Limits to 10 results
- Uses 1-hour cache TTL instead of 15 minutes

**Examples:**
```bash
bun run arena-search.ts search "tools for thought" --quick
bun run arena-search.ts search "brutalist web design" --quick
```

## How search works

Search uses the **Are.na v2 API** for public discovery. The v3 search endpoint biases results toward the authenticated user's network, making it useless for finding new content. v2 returns globally relevant results.

When you use `--scope my` or `--scope following`, search falls back to v3 where auth-scoped results are the intended behavior.

All other commands (channel, block, user) use the v3 API.

## File structure

```
arena-research/
├── SKILL.md              # Agent instructions (Claude reads this)
├── arena-search.ts       # CLI entry point
├── lib/
│   ├── api.ts            # Are.na API wrapper (v2 search + v3 everything else)
│   ├── cache.ts          # File-based cache (15min default TTL)
│   └── format.ts         # Terminal + markdown formatters
├── data/
│   └── cache/            # Auto-managed
└── references/
    └── arena-api.md      # API reference with confirmed response shapes
```

## Security

**Token handling:** arena-search reads your token from the `ARENA_ACCESS_TOKEN` env var or `~/.config/env/global.env`. The token is never printed to stdout, but be aware:

- **AI coding agents** (Claude Code, Codex, etc.) may log tool calls — including HTTP headers — in session transcripts. If you're running arena-search inside an agent session, your token could appear in those logs.
- **Recommendations:**
  - Set `ARENA_ACCESS_TOKEN` as a system env var (not inline in commands)
  - Review your agent's session log settings
  - Use a dedicated token for agent use
  - Rotate your token if you suspect exposure

## Limitations

- **Search relevance is API-default** — v2 search doesn't support sort params reliably. Client-side sorting is available for `--sort created`, `--sort updated`, and `--sort connections`, but `--sort score` returns results in whatever order the API provides.
- **Read-only** — never creates, modifies, or deletes Are.na content
- **Rate limits** — Guest: 30 req/min, Free: 120, Premium: 300, Supporter: 600. Cache and a 200ms inter-request delay help stay within limits.
- **Pagination, not cursor-based** — large result sets use `page`/`per` params
- **v2 search requires auth** — even though it returns globally-scoped results, unauthenticated requests get 401
- **Are.na v3 API is "work in progress"** — some endpoints may change

## Acknowledgments

Inspired by [x-research-skill](https://github.com/rohunvora/x-research-skill) by [@rohunvora](https://github.com/rohunvora).

## License

MIT
