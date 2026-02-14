/**
 * Output formatters for Are.na results.
 * Terminal (default), markdown, and JSON.
 */

import type { Channel, Block, User, SearchResult, PaginationMeta } from "./api";

// --- Helpers ---

const truncate = (str: string, max: number): string =>
  str.length <= max ? str : str.slice(0, max - 3) + "...";

const getDescription = (desc: { markdown: string; html: string; plain: string } | null): string =>
  desc?.plain?.trim() || "";

const channelUrl = (channel: Channel): string =>
  `https://www.are.na/${channel.owner?.slug || "unknown"}/${channel.slug}`;

const blockUrl = (block: Block): string =>
  `https://www.are.na/block/${block.id}`;

const userUrl = (user: User): string =>
  `https://www.are.na/${user.slug}`;

// --- Terminal formatters ---

export const formatChannelTerminal = (ch: Channel): string => {
  const desc = getDescription(ch.description);
  const descLine = desc ? `\n  ${truncate(desc, 100)}` : "";
  return `${ch.title} | by ${ch.owner?.name || "?"} | ${ch.counts?.contents || 0} items | ${ch.visibility}\n  ${channelUrl(ch)}${descLine}`;
};

export const formatBlockTerminal = (block: Block): string => {
  const lines: string[] = [`[${block.type}] ${block.title || "(untitled)"}`];

  if (block.type === "Link" && block.source?.url) {
    lines.push(`  URL: ${block.source.url}`);
  }
  if (block.type === "Text" && block.content?.plain) {
    lines.push(`  ${truncate(block.content.plain, 120)}`);
  }

  const desc = getDescription(block.description);
  if (desc) {
    lines.push(`  Desc: ${truncate(desc, 100)}`);
  }

  lines.push(`  Block ID: ${block.id}`);
  return lines.join("\n");
};

export const formatUserTerminal = (user: User): string => {
  const bio = getDescription(user.bio);
  const bioLine = bio ? `\n  Bio: ${truncate(bio, 100)}` : "";
  return `${user.name} (@${user.slug})\n  ${user.counts?.channels || 0} channels | ${user.counts?.followers || 0} followers${bioLine}\n  ${userUrl(user)}`;
};

export const formatSearchResultTerminal = (item: SearchResult): string => {
  if (item.type === "Channel") return formatChannelTerminal(item as Channel);
  if (item.type === "User") return formatUserTerminal(item as User);
  return formatBlockTerminal(item as Block);
};

export const formatContentItemTerminal = (item: Block | Channel): string => {
  if (item.type === "Channel") return formatChannelTerminal(item as Channel);
  return formatBlockTerminal(item as Block);
};

export const formatChannelConnectionsTerminal = (channels: Channel[], meta: PaginationMeta): string => {
  const lines: string[] = [`${meta.total_count} connected channels:\n`];
  for (const ch of channels) {
    lines.push(formatChannelTerminal(ch));
    lines.push("");
  }
  return lines.join("\n");
};

export const formatBlockConnectionsTerminal = (channels: Channel[], meta: PaginationMeta): string => {
  const lines: string[] = [`This block appears in ${meta.total_count} channels:\n`];
  for (const ch of channels) {
    lines.push(formatChannelTerminal(ch));
    lines.push("");
  }
  return lines.join("\n");
};

// --- Pagination footer ---

export const formatPagination = (meta: PaginationMeta): string => {
  if (!meta || meta.total_pages <= 1) return "";
  return `\nPage ${meta.current_page}/${meta.total_pages} (${meta.total_count} total)`;
};

// --- Markdown formatters ---

export const formatChannelMarkdown = (ch: Channel): string => {
  const desc = getDescription(ch.description);
  const descLine = desc ? `\n  > ${truncate(desc, 200)}` : "";
  return `- **[${ch.title}](${channelUrl(ch)})** | by ${ch.owner?.name || "?"} | ${ch.counts?.contents || 0} items | ${ch.visibility}${descLine}`;
};

export const formatBlockMarkdown = (block: Block): string => {
  const url = block.type === "Link" && block.source?.url
    ? block.source.url
    : blockUrl(block);
  const desc = getDescription(block.description);
  const descLine = desc ? `\n  > ${truncate(desc, 200)}` : "";

  let content = "";
  if (block.type === "Text" && block.content?.plain) {
    content = `\n  > ${truncate(block.content.plain, 200)}`;
  }

  return `- **[${block.title || "(untitled)"}](${url})** [${block.type}]${descLine}${content}`;
};

export const formatSearchResultMarkdown = (item: SearchResult): string => {
  if (item.type === "Channel") return formatChannelMarkdown(item as Channel);
  if (item.type === "User") {
    const user = item as User;
    return `- **[${user.name}](${userUrl(user)})** (@${user.slug}) | ${user.counts?.channels || 0} channels | ${user.counts?.followers || 0} followers`;
  }
  return formatBlockMarkdown(item as Block);
};

export const formatResearchMarkdown = (
  query: string,
  results: SearchResult[],
  opts: { meta?: PaginationMeta; command?: string } = {}
): string => {
  const date = new Date().toISOString().split("T")[0];

  let out = `# Are.na Research: ${query}\n\n`;
  out += `**Date:** ${date}\n`;
  out += `**Results:** ${opts.meta?.total_count || results.length}\n\n`;

  // Group by type
  const channels = results.filter((r) => r.type === "Channel") as Channel[];
  const blocks = results.filter((r) => (r as Block).base_type === "Block") as Block[];
  const users = results.filter((r) => r.type === "User") as User[];

  if (channels.length > 0) {
    out += `## Channels (${channels.length})\n\n`;
    out += channels.map(formatChannelMarkdown).join("\n\n");
    out += "\n\n";
  }

  if (blocks.length > 0) {
    out += `## Blocks (${blocks.length})\n\n`;
    out += blocks.map(formatBlockMarkdown).join("\n\n");
    out += "\n\n";
  }

  if (users.length > 0) {
    out += `## Users (${users.length})\n\n`;
    out += users.map((u) => formatSearchResultMarkdown(u)).join("\n\n");
    out += "\n\n";
  }

  out += `---\n\n## Research Metadata\n`;
  out += `- **Query:** ${query}\n`;
  out += `- **Date:** ${date}\n`;
  if (opts.command) out += `- **Command:** \`${opts.command}\`\n`;
  out += `- **Results:** ${results.length}\n`;

  return out;
};

export const formatChannelContentsMarkdown = (
  channel: Channel,
  contents: Array<Block | Channel>,
  meta: PaginationMeta
): string => {
  const date = new Date().toISOString().split("T")[0];

  let out = `# ${channel.title}\n\n`;
  out += `**Owner:** ${channel.owner?.name || "?"}\n`;
  out += `**Items:** ${channel.counts?.contents || 0}\n`;
  out += `**Visibility:** ${channel.visibility}\n`;
  out += `**URL:** ${channelUrl(channel)}\n`;
  out += `**Date fetched:** ${date}\n\n`;

  const desc = getDescription(channel.description);
  if (desc) {
    out += `> ${desc}\n\n`;
  }

  out += `## Contents (page ${meta.current_page}/${meta.total_pages})\n\n`;

  for (const item of contents) {
    if (item.type === "Channel") {
      out += formatChannelMarkdown(item as Channel);
    } else {
      out += formatBlockMarkdown(item as Block);
    }
    out += "\n\n";
  }

  return out;
};
