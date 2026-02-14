#!/usr/bin/env bun
/**
 * arena-search — CLI for Are.na research.
 *
 * Commands:
 *   search <query> [options]    Search Are.na
 *   channel <slug-or-id> [opts] Browse channel contents
 *   block <id> [opts]           View a single block
 *   user <slug-or-id> [opts]    View user profile + channels
 *   me                          Authenticated user profile
 *   cache clear                 Clear cache
 *   ping                        Test API connectivity
 *
 * Search options:
 *   --type Channel|Block|Link|Image|Text|User   Filter by type
 *   --sort score|created|updated|connections|random   Sort order
 *   --scope all|my|following   Search scope (my/following need auth)
 *   --per N                    Results per page (max 100)
 *   --page N                   Page number
 *   --quick                    Quick mode: channels only, top 10, 1hr cache
 *
 * Channel options:
 *   --sort position|created|updated   Sort contents
 *   --type Link|Text|Image|...        Filter content type
 *   --connections                     Show connected channels instead
 *   --per N                           Items per page
 *   --page N                          Page number
 *
 * Block options:
 *   --connections                     Show channels this block appears in
 *
 * Output options:
 *   --json                     Raw JSON output
 *   --markdown                 Markdown output
 *   --save                     Save to ~/clawd/drafts/
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import * as api from "./lib/api";
import * as cache from "./lib/cache";
import * as fmt from "./lib/format";

const DRAFTS_DIR = join(process.env.HOME!, "clawd", "drafts");

// --- Arg parsing (matches x-research pattern) ---

const args = process.argv.slice(2);
const command = args[0];

const getFlag = (name: string): boolean => {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0) {
    args.splice(idx, 1);
    return true;
  }
  return false;
};

const getOpt = (name: string): string | undefined => {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) {
    const val = args[idx + 1];
    args.splice(idx, 2);
    return val;
  }
  return undefined;
};

// --- Commands ---

const cmdPing = async () => {
  const rateLimit = await api.ping();
  console.log(`Are.na API is reachable.`);
  console.error(`Rate limit: ${rateLimit.limit} req/min | Tier: ${rateLimit.tier}`);
};

const cmdSearch = async () => {
  const quick = getFlag("quick");
  const save = getFlag("save");
  const asJson = getFlag("json");
  const asMarkdown = getFlag("markdown");
  const connections = getFlag("connections");

  let type = getOpt("type");
  let sort = getOpt("sort") || "score";
  const scope = getOpt("scope");
  let per = parseInt(getOpt("per") || "24");
  const page = parseInt(getOpt("page") || "1");

  // Quick mode overrides
  if (quick) {
    type = "Channel";
    sort = "connections";
    per = 10;
  }

  const queryParts = args.slice(1).filter((a) => !a.startsWith("--"));
  const query = queryParts.join(" ");

  if (!query) {
    console.error("Usage: arena-search.ts search <query> [options]");
    process.exit(1);
  }

  const apiSort = api.mapSearchSort(sort);
  const cacheTtlMs = quick ? 3_600_000 : 900_000;
  const cacheParams = `type=${type || ""}&sort=${apiSort}&scope=${scope || "all"}&per=${per}&page=${page}`;

  const cached = cache.get(query, cacheParams, cacheTtlMs);

  let results: api.SearchResult[];
  let meta: api.PaginationMeta;
  let rateLimit: api.RateLimitInfo | null = null;

  if (cached) {
    const c = cached as { results: api.SearchResult[]; meta: api.PaginationMeta };
    results = c.results;
    meta = c.meta;
    console.error(`(cached — ${results.length} results)`);
  } else {
    const res = await api.searchArena(query, {
      type: type || undefined,
      sort: apiSort,
      scope: scope || undefined,
      page,
      per,
    });
    results = res.results;
    meta = res.meta;
    rateLimit = res.rateLimit;
    cache.set(query, cacheParams, { results, meta });
  }

  // Output
  if (asJson) {
    console.log(JSON.stringify({ data: results, meta }, null, 2));
  } else if (asMarkdown) {
    const md = fmt.formatResearchMarkdown(query, results, { meta, command: `search "${query}"` });
    console.log(md);
  } else {
    for (const item of results) {
      console.log(fmt.formatSearchResultTerminal(item));
      console.log();
    }
    const pagination = fmt.formatPagination(meta);
    if (pagination) console.log(pagination);
  }

  // Save
  if (save) {
    if (!existsSync(DRAFTS_DIR)) mkdirSync(DRAFTS_DIR, { recursive: true });
    const slug = query
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)
      .toLowerCase();
    const date = new Date().toISOString().split("T")[0];
    const path = join(DRAFTS_DIR, `arena-research-${slug}-${date}.md`);
    const md = fmt.formatResearchMarkdown(query, results, { meta, command: `search "${query}"` });
    writeFileSync(path, md);
    console.error(`\nSaved to ${path}`);
  }

  // Stats to stderr
  if (rateLimit) {
    console.error(`\n${results.length} results | sorted by ${sort} | page ${meta.current_page}/${meta.total_pages} (${meta.total_count} total)`);
    console.error(`Rate limit: ${rateLimit.limit} req/min | Tier: ${rateLimit.tier}`);
  }
};

const cmdChannel = async () => {
  const save = getFlag("save");
  const asJson = getFlag("json");
  const asMarkdown = getFlag("markdown");
  const showConnections = getFlag("connections");

  const sort = getOpt("sort") || "position";
  const type = getOpt("type");
  const per = parseInt(getOpt("per") || "24");
  const page = parseInt(getOpt("page") || "1");

  const slugOrId = args[1];
  if (!slugOrId) {
    console.error("Usage: arena-search.ts channel <slug-or-id> [options]");
    process.exit(1);
  }

  if (showConnections) {
    // Fetch connections
    const cacheParams = `connections&per=${per}&page=${page}`;
    const cached = cache.get(slugOrId, cacheParams);

    let channels: api.Channel[];
    let meta: api.PaginationMeta;
    let rateLimit: api.RateLimitInfo | null = null;

    if (cached) {
      const c = cached as { channels: api.Channel[]; meta: api.PaginationMeta };
      channels = c.channels;
      meta = c.meta;
      console.error(`(cached — ${channels.length} connections)`);
    } else {
      const res = await api.getChannelConnections(slugOrId, { page, per });
      channels = res.channels;
      meta = res.meta;
      rateLimit = res.rateLimit;
      cache.set(slugOrId, cacheParams, { channels, meta });
    }

    if (asJson) {
      console.log(JSON.stringify({ data: channels, meta }, null, 2));
    } else if (asMarkdown) {
      let md = `# Connections for channel: ${slugOrId}\n\n`;
      md += `**Connected channels:** ${meta.total_count}\n\n`;
      md += channels.map(fmt.formatChannelMarkdown).join("\n\n");
      console.log(md);
    } else {
      console.log(fmt.formatChannelConnectionsTerminal(channels, meta));
      const pagination = fmt.formatPagination(meta);
      if (pagination) console.log(pagination);
    }

    if (rateLimit) {
      console.error(`Rate limit: ${rateLimit.limit} req/min | Tier: ${rateLimit.tier}`);
    }
    return;
  }

  // Fetch channel info + contents
  const apiSort = api.mapChannelSort(sort);
  const cacheParams = `contents&sort=${apiSort}&type=${type || ""}&per=${per}&page=${page}`;

  const cached = cache.get(slugOrId, cacheParams);

  let channel: api.Channel;
  let contents: Array<api.Block | api.Channel>;
  let meta: api.PaginationMeta;
  let rateLimit: api.RateLimitInfo | null = null;

  if (cached) {
    const c = cached as { channel: api.Channel; contents: Array<api.Block | api.Channel>; meta: api.PaginationMeta };
    channel = c.channel;
    contents = c.contents;
    meta = c.meta;
    console.error(`(cached — ${contents.length} items)`);
  } else {
    const chRes = await api.getChannel(slugOrId);
    channel = chRes.channel;

    const contentsRes = await api.getChannelContents(slugOrId, {
      sort: apiSort,
      type: type || undefined,
      page,
      per,
    });
    contents = contentsRes.contents;
    meta = contentsRes.meta;
    rateLimit = contentsRes.rateLimit;
    cache.set(slugOrId, cacheParams, { channel, contents, meta });
  }

  if (asJson) {
    console.log(JSON.stringify({ channel, contents, meta }, null, 2));
  } else if (asMarkdown) {
    console.log(fmt.formatChannelContentsMarkdown(channel, contents, meta));
  } else {
    // Channel header
    console.log(fmt.formatChannelTerminal(channel));
    console.log();

    // Contents
    for (const item of contents) {
      console.log(fmt.formatContentItemTerminal(item));
      console.log();
    }
    const pagination = fmt.formatPagination(meta);
    if (pagination) console.log(pagination);
  }

  // Save
  if (save) {
    if (!existsSync(DRAFTS_DIR)) mkdirSync(DRAFTS_DIR, { recursive: true });
    const date = new Date().toISOString().split("T")[0];
    const path = join(DRAFTS_DIR, `arena-research-${channel.slug}-${date}.md`);
    const md = fmt.formatChannelContentsMarkdown(channel, contents, meta);
    writeFileSync(path, md);
    console.error(`\nSaved to ${path}`);
  }

  if (rateLimit) {
    console.error(`\n${contents.length} items | sorted by ${sort} | page ${meta.current_page}/${meta.total_pages} (${meta.total_count} total)`);
    console.error(`Rate limit: ${rateLimit.limit} req/min | Tier: ${rateLimit.tier}`);
  }
};

const cmdBlock = async () => {
  const asJson = getFlag("json");
  const asMarkdown = getFlag("markdown");
  const showConnections = getFlag("connections");

  const per = parseInt(getOpt("per") || "24");
  const page = parseInt(getOpt("page") || "1");

  const blockId = args[1];
  if (!blockId) {
    console.error("Usage: arena-search.ts block <id> [options]");
    process.exit(1);
  }

  if (showConnections) {
    const cacheParams = `block-connections&per=${per}&page=${page}`;
    const cached = cache.get(blockId, cacheParams);

    let channels: api.Channel[];
    let meta: api.PaginationMeta;
    let rateLimit: api.RateLimitInfo | null = null;

    if (cached) {
      const c = cached as { channels: api.Channel[]; meta: api.PaginationMeta };
      channels = c.channels;
      meta = c.meta;
      console.error(`(cached — ${channels.length} connections)`);
    } else {
      const res = await api.getBlockConnections(blockId, { page, per });
      channels = res.channels;
      meta = res.meta;
      rateLimit = res.rateLimit;
      cache.set(blockId, cacheParams, { channels, meta });
    }

    if (asJson) {
      console.log(JSON.stringify({ data: channels, meta }, null, 2));
    } else if (asMarkdown) {
      let md = `# Connections for block: ${blockId}\n\n`;
      md += `**Appears in:** ${meta.total_count} channels\n\n`;
      md += channels.map(fmt.formatChannelMarkdown).join("\n\n");
      console.log(md);
    } else {
      console.log(fmt.formatBlockConnectionsTerminal(channels, meta));
      const pagination = fmt.formatPagination(meta);
      if (pagination) console.log(pagination);
    }

    if (rateLimit) {
      console.error(`Rate limit: ${rateLimit.limit} req/min | Tier: ${rateLimit.tier}`);
    }
    return;
  }

  // Fetch single block
  const cached = cache.get(`block-${blockId}`, "");

  let block: api.Block;
  let rateLimit: api.RateLimitInfo | null = null;

  if (cached) {
    block = cached as api.Block;
    console.error(`(cached)`);
  } else {
    const res = await api.getBlock(blockId);
    block = res.block;
    rateLimit = res.rateLimit;
    cache.set(`block-${blockId}`, "", block);
  }

  if (asJson) {
    console.log(JSON.stringify(block, null, 2));
  } else if (asMarkdown) {
    console.log(fmt.formatBlockMarkdown(block));
  } else {
    console.log(fmt.formatBlockTerminal(block));
    console.log(`\n  ${`https://www.are.na/block/${block.id}`}`);
  }

  if (rateLimit) {
    console.error(`Rate limit: ${rateLimit.limit} req/min | Tier: ${rateLimit.tier}`);
  }
};

const cmdUser = async () => {
  const asJson = getFlag("json");
  const asMarkdown = getFlag("markdown");

  const per = parseInt(getOpt("per") || "24");
  const page = parseInt(getOpt("page") || "1");

  const slugOrId = args[1];
  if (!slugOrId) {
    console.error("Usage: arena-search.ts user <slug-or-id> [options]");
    process.exit(1);
  }

  const cacheParams = `user&per=${per}&page=${page}`;
  const cached = cache.get(slugOrId, cacheParams);

  let user: api.User;
  let channels: api.Channel[];
  let meta: api.PaginationMeta;
  let rateLimit: api.RateLimitInfo | null = null;

  if (cached) {
    const c = cached as { user: api.User; channels: api.Channel[]; meta: api.PaginationMeta };
    user = c.user;
    channels = c.channels;
    meta = c.meta;
    console.error(`(cached)`);
  } else {
    const userRes = await api.getUser(slugOrId);
    user = userRes.user;

    const contentsRes = await api.getUserContents(slugOrId, { page, per });
    channels = contentsRes.contents;
    meta = contentsRes.meta;
    rateLimit = contentsRes.rateLimit;
    cache.set(slugOrId, cacheParams, { user, channels, meta });
  }

  if (asJson) {
    console.log(JSON.stringify({ user, channels, meta }, null, 2));
  } else if (asMarkdown) {
    let md = `# ${user.name} (@${user.slug})\n\n`;
    md += `**Channels:** ${user.counts?.channels || 0}\n`;
    md += `**Followers:** ${user.counts?.followers || 0}\n`;
    md += `**Following:** ${user.counts?.following || 0}\n`;
    const bio = user.bio?.plain;
    if (bio) md += `\n> ${bio}\n`;
    md += `\n**URL:** https://www.are.na/${user.slug}\n\n`;
    md += `## Channels (page ${meta.current_page}/${meta.total_pages})\n\n`;
    md += channels.map(fmt.formatChannelMarkdown).join("\n\n");
    console.log(md);
  } else {
    console.log(fmt.formatUserTerminal(user));
    console.log();

    if (channels.length > 0) {
      console.log(`Channels:\n`);
      for (const ch of channels) {
        console.log(fmt.formatChannelTerminal(ch));
        console.log();
      }
      const pagination = fmt.formatPagination(meta);
      if (pagination) console.log(pagination);
    }
  }

  if (rateLimit) {
    console.error(`Rate limit: ${rateLimit.limit} req/min | Tier: ${rateLimit.tier}`);
  }
};

const cmdMe = async () => {
  const asJson = getFlag("json");

  const { user, rateLimit } = await api.getMe();

  if (asJson) {
    console.log(JSON.stringify(user, null, 2));
  } else {
    console.log(fmt.formatUserTerminal(user));
  }

  console.error(`Rate limit: ${rateLimit.limit} req/min | Tier: ${rateLimit.tier}`);
};

const cmdCache = async () => {
  const sub = args[1];
  if (sub === "clear") {
    const removed = cache.clear();
    console.log(`Cleared ${removed} cached entries.`);
  } else {
    const removed = cache.prune();
    console.log(`Pruned ${removed} expired entries.`);
  }
};

const usage = () => {
  console.log(`arena-search — Are.na research CLI

Commands:
  search <query> [options]    Search Are.na
  channel <slug-or-id> [opts] Browse channel contents
  block <id> [opts]           View a single block
  user <slug-or-id> [opts]    View user profile + channels
  me                          Authenticated user profile
  cache clear                 Clear cache
  ping                        Test API connectivity

Search options:
  --type Channel|Block|Link|Image|Text|User   Filter by type
  --sort score|created|updated|connections|random
  --scope all|my|following   (my/following need auth)
  --per N                    Results per page (max 100)
  --page N                   Page number
  --quick                    Channels only, top 10, 1hr cache

Channel options:
  --sort position|created|updated
  --type Link|Text|Image|...
  --connections              Show connected channels
  --per N / --page N

Block options:
  --connections              Show channels containing this block

Output:
  --json                     Raw JSON
  --markdown                 Markdown format
  --save                     Save to ~/clawd/drafts/`);
};

// --- Main ---

const main = async () => {
  switch (command) {
    case "search":
    case "s":
      await cmdSearch();
      break;
    case "channel":
    case "ch":
      await cmdChannel();
      break;
    case "block":
    case "b":
      await cmdBlock();
      break;
    case "user":
    case "u":
      await cmdUser();
      break;
    case "me":
      await cmdMe();
      break;
    case "cache":
      await cmdCache();
      break;
    case "ping":
      await cmdPing();
      break;
    default:
      usage();
  }
};

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
