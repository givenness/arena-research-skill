/**
 * Are.na API wrapper — v2 search (public discovery) + v3 everything else.
 * Uses Bearer token from env: ARENA_ACCESS_TOKEN
 */

const BASE = "https://api.are.na/v3";
const RATE_DELAY_MS = 200;

// --- Types ---

export interface Description {
  markdown: string;
  html: string;
  plain: string;
}

export interface Owner {
  id: number;
  type: "User" | "Group";
  name: string;
  slug: string;
  avatar: string | null;
  initials: string;
}

export interface Source {
  url: string;
  title: string;
  provider: { name: string; url: string };
}

export interface Channel {
  id: number;
  type: "Channel";
  created_at: string;
  updated_at: string;
  slug: string;
  title: string;
  description: Description | null;
  state: string;
  visibility: "public" | "closed" | "private";
  owner: Owner;
  counts: {
    blocks: number;
    channels: number;
    contents: number;
    collaborators: number;
  };
  can: Record<string, boolean>;
  _links: Record<string, { href: string }>;
}

export interface Block {
  id: number;
  type: "Text" | "Image" | "Link" | "Attachment" | "Embed";
  base_type: "Block";
  created_at: string;
  updated_at: string;
  title: string;
  description: Description | null;
  state: string;
  visibility: string;
  comment_count: number;
  user: Owner;
  source: Source | null;
  content: Description | null;
  image: { src: string; width: number; height: number } | null;
  attachment: { url: string } | null;
  embed: { url: string } | null;
  connection?: {
    id: number;
    position: number;
    pinned: boolean;
    connected_at: string;
    connected_by: { id: number; name: string };
  };
  _links: Record<string, { href: string }>;
}

export interface User {
  id: number;
  type: "User";
  created_at: string;
  updated_at: string;
  name: string;
  slug: string;
  avatar: string | null;
  initials: string;
  bio: Description | null;
  counts: {
    channels: number;
    followers: number;
    following: number;
  };
  _links: Record<string, { href: string }>;
}

export interface PaginationMeta {
  current_page: number;
  next_page: number | null;
  prev_page: number | null;
  per_page: number;
  total_pages: number;
  total_count: number;
  has_more_pages: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface RateLimitInfo {
  limit: number;
  tier: string;
  window: number;
  reset: number;
}

export type SearchResult = Channel | Block | User;

// --- Token ---

const getToken = (): string | null => {
  return process.env.ARENA_ACCESS_TOKEN || null;
};

export const requireToken = (): string => {
  const token = getToken();
  if (!token) {
    throw new Error(
      "ARENA_ACCESS_TOKEN not configured. Get one from https://www.are.na/settings/personal-access-tokens"
    );
  }
  return token;
};

// --- Helpers ---

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRequestTime = 0;

const parseRateLimitHeaders = (headers: Headers): RateLimitInfo => ({
  limit: parseInt(headers.get("x-ratelimit-limit") || "0"),
  tier: headers.get("x-ratelimit-tier") || "unknown",
  window: parseInt(headers.get("x-ratelimit-window") || "60"),
  reset: parseInt(headers.get("x-ratelimit-reset") || "0"),
});

// --- Core fetch ---

export const apiGet = async <T = unknown>(path: string): Promise<{ data: T; rateLimit: RateLimitInfo }> => {
  // Enforce minimum delay between requests
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < RATE_DELAY_MS) {
    await sleep(RATE_DELAY_MS - elapsed);
  }

  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const token = getToken();

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });
  lastRequestTime = Date.now();

  const rateLimit = parseRateLimitHeaders(res.headers);

  if (res.status === 401) {
    throw new Error(
      "ARENA_ACCESS_TOKEN not configured. Get one from https://www.are.na/settings/personal-access-tokens"
    );
  }

  if (res.status === 403) {
    throw new Error(
      "This channel is private. You need to be a collaborator to view it."
    );
  }

  if (res.status === 404) {
    // Extract the resource type and identifier from the path
    const parts = path.replace(/^\//, "").split("/");
    const resource = parts[0] === "channels" ? "Channel" : parts[0] === "blocks" ? "Block" : parts[0] === "users" ? "User" : "Resource";
    const identifier = parts[1] || path;
    throw new Error(`${resource} not found: ${identifier}`);
  }

  if (res.status === 429) {
    const waitSec = rateLimit.reset
      ? Math.max(rateLimit.reset - Math.floor(Date.now() / 1000), 1)
      : 60;
    throw new Error(
      `Rate limited. Resets in ${waitSec}s. Your tier: ${rateLimit.tier}`
    );
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Are.na API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as T;
  return { data, rateLimit };
};

// --- Endpoints ---

export const ping = async (): Promise<RateLimitInfo> => {
  const { rateLimit } = await apiGet("/ping");
  return rateLimit;
};

// --- v2 Search (public discovery — relevant results) ---

interface V2SearchResponse {
  term: string;
  per: number;
  current_page: number;
  total_pages: number;
  length: number;
  authenticated: boolean;
  channels: Channel[];
  blocks: Block[];
  users: User[];
}

const v2TypeEndpoint = (type?: string): string => {
  if (!type) return "/search";
  const t = type.toLowerCase();
  if (t === "channel") return "/search/channels";
  if (t === "user") return "/search/users";
  // Block, Text, Image, Link, Attachment, Embed → all go to /search/blocks
  return "/search/blocks";
};

const v2ToMeta = (r: V2SearchResponse, page: number, per: number): PaginationMeta => ({
  current_page: r.current_page || page,
  next_page: r.current_page < r.total_pages ? r.current_page + 1 : null,
  prev_page: r.current_page > 1 ? r.current_page - 1 : null,
  per_page: r.per || per,
  total_pages: r.total_pages,
  total_count: r.total_pages * (r.per || per),
  has_more_pages: r.current_page < r.total_pages,
});

const normalizeV2 = <T extends Record<string, unknown>>(item: T): T => {
  // v2 uses `class` where v3 uses `type`, and different field names
  const out = { ...item };
  if (!out.type && out.class) out.type = out.class;
  if (!out.base_type && out.class === "Channel") out.base_type = "Channel";
  if (!out.base_type && out.class !== "Channel" && out.class !== "User") out.base_type = "Block";
  // v2 channels: `length` → `counts.contents`, `status` → `visibility`, `user` → `owner`
  if (out.class === "Channel") {
    if (!out.counts && typeof out.length === "number") {
      out.counts = { blocks: 0, channels: 0, contents: out.length as number, collaborators: out.collaborator_count as number || 0 };
    }
    if (!out.visibility && out.status) out.visibility = out.status;
    if (!out.owner && out.user) {
      const u = out.user as Record<string, unknown>;
      out.owner = { id: u.id, type: "User" as const, name: u.full_name || u.username, slug: u.slug, avatar: u.avatar, initials: "" };
    }
  }
  // v2 blocks: `class` is the specific type (Link, Text, Image, etc.)
  if (out.class === "User") {
    if (!out.name && out.full_name) out.name = out.full_name;
    if (!out.name && out.username) out.name = out.username;
    if (!out.slug && out.username) out.slug = out.username;
    if (!out.counts) {
      out.counts = { channels: out.channel_count as number || 0, followers: out.follower_count as number || 0, following: out.following_count as number || 0 };
    }
  }
  return out;
};

const v2ToResults = (r: V2SearchResponse): SearchResult[] => {
  const results: SearchResult[] = [];
  if (r.channels) results.push(...r.channels.map((c) => normalizeV2(c as unknown as Record<string, unknown>) as unknown as Channel));
  if (r.blocks) results.push(...r.blocks.map((b) => normalizeV2(b as unknown as Record<string, unknown>) as unknown as Block));
  if (r.users) results.push(...r.users.map((u) => normalizeV2(u as unknown as Record<string, unknown>) as unknown as User));
  return results;
};

export const searchArena = async (
  query: string,
  opts: {
    type?: string;
    sort?: string;
    scope?: string;
    page?: number;
    per?: number;
  } = {}
): Promise<{ results: SearchResult[]; meta: PaginationMeta; rateLimit: RateLimitInfo }> => {
  // Auth-scoped searches (my, following) use v3 which respects scope
  if (opts.scope && opts.scope !== "all") {
    return searchArenaV3(query, opts);
  }

  const page = opts.page || 1;
  const per = opts.per || 24;
  const endpoint = v2TypeEndpoint(opts.type);
  const params = new URLSearchParams({ q: query, per: String(per), page: String(page) });

  const BASE_V2 = "https://api.are.na/v2";
  const { data, rateLimit } = await apiGet<V2SearchResponse>(
    `${BASE_V2}${endpoint}?${params.toString()}`
  );

  let results = v2ToResults(data);

  // Client-side sorting (v2 doesn't support sort params reliably)
  if (opts.sort) {
    results = sortResults(results, opts.sort);
  }

  return { results, meta: v2ToMeta(data, page, per), rateLimit };
};

// --- v3 Search (auth-scoped: my, following) ---

const searchArenaV3 = async (
  query: string,
  opts: {
    type?: string;
    sort?: string;
    scope?: string;
    page?: number;
    per?: number;
  } = {}
): Promise<{ results: SearchResult[]; meta: PaginationMeta; rateLimit: RateLimitInfo }> => {
  requireToken();

  const params = new URLSearchParams({ q: query });
  if (opts.type) params.set("type", opts.type);
  if (opts.sort) params.set("sort", opts.sort);
  params.set("scope", opts.scope || "all");
  if (opts.page) params.set("page", String(opts.page));
  if (opts.per) params.set("per", String(opts.per));

  const { data, rateLimit } = await apiGet<PaginatedResponse<SearchResult>>(
    `/search?${params.toString()}`
  );

  return { results: data.data, meta: data.meta, rateLimit };
};

// --- Client-side sort (for v2 results) ---

export const sortResults = (results: SearchResult[], sort: string): SearchResult[] => {
  const sorted = [...results];
  switch (sort) {
    case "created_at_desc":
      return sorted.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    case "updated_at_desc":
      return sorted.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    case "connections_count_desc":
      // Channels have `length` (item count) as a proxy for engagement
      return sorted.sort((a, b) => {
        const aCount = (a as Channel).counts?.contents || (a as any).length || 0;
        const bCount = (b as Channel).counts?.contents || (b as any).length || 0;
        return bCount - aCount;
      });
    default:
      // score_desc, random, etc. — return as-is (API default relevance)
      return sorted;
  }
};

export const getChannel = async (
  slugOrId: string
): Promise<{ channel: Channel; rateLimit: RateLimitInfo }> => {
  const { data, rateLimit } = await apiGet<Channel>(`/channels/${slugOrId}`);
  return { channel: data, rateLimit };
};

export const getChannelContents = async (
  slugOrId: string,
  opts: { sort?: string; type?: string; page?: number; per?: number } = {}
): Promise<{ contents: Array<Block | Channel>; meta: PaginationMeta; rateLimit: RateLimitInfo }> => {
  const params = new URLSearchParams();
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.type) params.set("type", opts.type);
  if (opts.page) params.set("page", String(opts.page));
  if (opts.per) params.set("per", String(opts.per));

  const qs = params.toString();
  const path = `/channels/${slugOrId}/contents${qs ? `?${qs}` : ""}`;
  const { data, rateLimit } = await apiGet<PaginatedResponse<Block | Channel>>(path);

  return { contents: data.data, meta: data.meta, rateLimit };
};

export const getChannelConnections = async (
  slugOrId: string,
  opts: { page?: number; per?: number } = {}
): Promise<{ channels: Channel[]; meta: PaginationMeta; rateLimit: RateLimitInfo }> => {
  const params = new URLSearchParams();
  if (opts.page) params.set("page", String(opts.page));
  if (opts.per) params.set("per", String(opts.per));

  const qs = params.toString();
  const path = `/channels/${slugOrId}/connections${qs ? `?${qs}` : ""}`;
  const { data, rateLimit } = await apiGet<PaginatedResponse<Channel>>(path);

  return { channels: data.data, meta: data.meta, rateLimit };
};

export const getBlock = async (
  id: string | number
): Promise<{ block: Block; rateLimit: RateLimitInfo }> => {
  const { data, rateLimit } = await apiGet<Block>(`/blocks/${id}`);
  return { block: data, rateLimit };
};

export const getBlockConnections = async (
  id: string | number,
  opts: { page?: number; per?: number } = {}
): Promise<{ channels: Channel[]; meta: PaginationMeta; rateLimit: RateLimitInfo }> => {
  const params = new URLSearchParams();
  if (opts.page) params.set("page", String(opts.page));
  if (opts.per) params.set("per", String(opts.per));

  const qs = params.toString();
  const path = `/blocks/${id}/connections${qs ? `?${qs}` : ""}`;
  const { data, rateLimit } = await apiGet<PaginatedResponse<Channel>>(path);

  return { channels: data.data, meta: data.meta, rateLimit };
};

export const getUser = async (
  slugOrId: string
): Promise<{ user: User; rateLimit: RateLimitInfo }> => {
  const { data, rateLimit } = await apiGet<User>(`/users/${slugOrId}`);
  return { user: data, rateLimit };
};

export const getUserContents = async (
  slugOrId: string,
  opts: { page?: number; per?: number } = {}
): Promise<{ contents: Channel[]; meta: PaginationMeta; rateLimit: RateLimitInfo }> => {
  const params = new URLSearchParams();
  if (opts.page) params.set("page", String(opts.page));
  if (opts.per) params.set("per", String(opts.per));

  const qs = params.toString();
  const path = `/users/${slugOrId}/contents${qs ? `?${qs}` : ""}`;
  const { data, rateLimit } = await apiGet<PaginatedResponse<Channel>>(path);

  return { contents: data.data, meta: data.meta, rateLimit };
};

export const getMe = async (): Promise<{ user: User; rateLimit: RateLimitInfo }> => {
  requireToken();
  const { data, rateLimit } = await apiGet<User>("/me");
  return { user: data, rateLimit };
};

// --- Sort flag mapping ---

export const mapSearchSort = (sort: string): string => {
  const map: Record<string, string> = {
    score: "score_desc",
    created: "created_at_desc",
    updated: "updated_at_desc",
    connections: "connections_count_desc",
    random: "random",
    "name-asc": "name_asc",
    "name-desc": "name_desc",
  };
  return map[sort] || sort;
};

export const mapChannelSort = (sort: string): string => {
  const map: Record<string, string> = {
    position: "position_desc",
    created: "created_at_desc",
    updated: "updated_at_desc",
  };
  return map[sort] || sort;
};
