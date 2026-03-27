import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runAppleScript, escapeForAppleScript } from "../applescript.js";
import { success, withErrorHandling } from "../helpers.js";

interface MessageSummary {
  id: number;
  subject: string;
  sender: string;
  date: string;
  read: boolean;
}

function parseMessages(raw: string): MessageSummary[] {
  if (!raw) return [];
  const messages: MessageSummary[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 5) continue;
    messages.push({
      id: parseInt(parts[0], 10),
      subject: parts[1],
      sender: parts[2],
      date: parts[3],
      read: parts[4] === "true",
    });
  }
  return messages;
}

export function registerSearchTools(server: McpServer) {
  server.tool(
    "mail_search",
    "Search messages by subject or sender",
    {
      query: z.string().min(1).describe("Search keyword"),
      field: z.enum(["subject", "sender", "all"]).default("all").describe("Field to search"),
      account: z.string().optional().describe("Account name"),
      mailbox: z.string().optional().describe("Mailbox name (default: INBOX)"),
      limit: z.number().int().positive().max(50).default(10).describe("Max results"),
    },
    withErrorHandling(async ({ query, field, account, mailbox, limit }) => {
      const escaped = escapeForAppleScript(query);
      const target = account
        ? (mailbox
          ? `mailbox "${escapeForAppleScript(mailbox)}" of account "${escapeForAppleScript(account)}"`
          : `mailbox "INBOX" of account "${escapeForAppleScript(account)}"`)
        : "inbox";

      // Subject search: use native AppleScript filter
      if (field === "subject") {
        const script = `
tell application "Mail"
  set msgs to (every message of ${target} whose subject contains "${escaped}")
  set maxCount to ${limit}
  if (count of msgs) < maxCount then set maxCount to (count of msgs)
  set output to ""
  repeat with i from 1 to maxCount
    set m to item i of msgs
    set output to output & (id of m) & "\\t" & (subject of m) & "\\t" & (sender of m) & "\\t" & (date received of m as string) & "\\t" & (read status of m) & "\\n"
  end repeat
  return output
end tell`;
        return success(parseMessages(await runAppleScript(script)));
      }

      // Sender or all: fetch recent messages, filter in JS
      const fetchLimit = 500;
      const script = `
tell application "Mail"
  set thirtyDaysAgo to (current date) - 30 * days
  set msgs to (every message of ${target} whose date received >= thirtyDaysAgo)
  set maxCount to ${fetchLimit}
  if (count of msgs) < maxCount then set maxCount to (count of msgs)
  set output to ""
  repeat with i from 1 to maxCount
    set m to item i of msgs
    set output to output & (id of m) & "\\t" & (subject of m) & "\\t" & (sender of m) & "\\t" & (date received of m as string) & "\\t" & (read status of m) & "\\n"
  end repeat
  return output
end tell`;

      const all = parseMessages(await runAppleScript(script));
      const q = query.toLowerCase();

      const filtered = all.filter((m) => {
        if (field === "sender") return m.sender.toLowerCase().includes(q);
        // "all" — match subject or sender
        return m.subject.toLowerCase().includes(q) || m.sender.toLowerCase().includes(q);
      });

      return success(filtered.slice(0, limit));
    }),
  );
}
