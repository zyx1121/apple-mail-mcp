import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runAppleScript, escapeForAppleScript } from "../applescript.js";
import { success, error, withErrorHandling } from "../helpers.js";

function buildMailboxTarget(account?: string, mailbox?: string): string {
  if (account && mailbox) return `mailbox "${mailbox}" of account "${account}"`;
  if (account) return `mailbox "INBOX" of account "${account}"`;
  return "inbox";
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  });
}

interface MessageSummary {
  id: number;
  account: string;
  mailbox: string;
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
    if (parts.length < 7) continue;
    messages.push({
      id: parseInt(parts[0], 10),
      account: parts[1],
      mailbox: parts[2],
      subject: parts[3],
      sender: parts[4],
      date: parts[5],
      read: parts[6] === "true",
    });
  }
  return messages;
}

export function registerMessageTools(server: McpServer) {
  server.tool(
    "mail_list_messages",
    "List messages in a mailbox with optional filters",
    {
      account: z.string().optional().describe("Account name"),
      mailbox: z.string().optional().describe("Mailbox name (default: INBOX)"),
      limit: z.number().int().positive().max(100).default(20).describe("Max messages to return"),
      unread_only: z.boolean().default(false).describe("Only show unread messages"),
      date_from: z.string().optional().describe("ISO 8601 date, e.g. '2026-03-26'"),
      date_to: z.string().optional().describe("ISO 8601 date, e.g. '2026-03-27'"),
    },
    withErrorHandling(async ({ account, mailbox, limit, unread_only, date_from, date_to }) => {
      const target = buildMailboxTarget(account, mailbox);

      const conditions: string[] = [];
      if (unread_only) conditions.push("read status is false");
      if (date_from) conditions.push(`date received >= date "${formatDate(date_from)}"`);
      if (date_to) conditions.push(`date received <= date "${formatDate(date_to)}"`);

      const whereClause = conditions.length > 0
        ? ` whose ${conditions.join(" and ")}`
        : "";

      // When querying the global inbox (no account specified), mailbox of m
      // may return the physical storage name (e.g. "全部郵件" for Gmail) which
      // is unusable for subsequent operations. Report "INBOX" instead, since
      // that's the universal IMAP alias all accounts accept.
      const useGlobalInbox = !account;
      const mailboxExpr = useGlobalInbox
        ? `"INBOX"`
        : `(name of mbox)`;

      const script = `
tell application "Mail"
  set msgs to (every message of ${target}${whereClause})
  set maxCount to ${limit}
  if (count of msgs) < maxCount then set maxCount to (count of msgs)
  set output to ""
  repeat with i from 1 to maxCount
    set m to item i of msgs
    set mbox to mailbox of m
    set output to output & (id of m) & "\\t" & (name of account of mbox) & "\\t" & ${mailboxExpr} & "\\t" & (subject of m) & "\\t" & (sender of m) & "\\t" & (date received of m as string) & "\\t" & (read status of m) & "\\n"
  end repeat
  return output
end tell`;

      const raw = await runAppleScript(script);
      return success(parseMessages(raw));
    }),
  );

  server.tool(
    "mail_read_message",
    "Read the full content of a specific message",
    {
      message_id: z.coerce.number().int().describe("Message ID"),
      account: z.string().optional().describe("Account name (speeds up lookup)"),
      mailbox: z.string().optional().describe("Mailbox name (speeds up lookup)"),
    },
    withErrorHandling(async ({ message_id, account, mailbox }) => {
      // If account and mailbox provided, direct lookup
      if (account) {
        const target = mailbox
          ? `mailbox "${escapeForAppleScript(mailbox)}" of account "${escapeForAppleScript(account)}"`
          : `mailbox "INBOX" of account "${escapeForAppleScript(account)}"`;

        const script = `
tell application "Mail"
  set m to first message of ${target} whose id is ${message_id}
  set subj to subject of m
  set sndr to sender of m
  set rcvd to date received of m as string
  set isRead to (read status of m)
  set cnt to content of m
  set toStr to (address of every to recipient of m) as string
  set ccStr to (address of every cc recipient of m) as string
  return subj & "\\n===FIELD===\\n" & sndr & "\\n===FIELD===\\n" & rcvd & "\\n===FIELD===\\n" & isRead & "\\n===FIELD===\\n" & cnt & "\\n===FIELD===\\n" & toStr & "\\n===FIELD===\\n" & ccStr
end tell`;

        const raw = await runAppleScript(script);
        const fields = raw.split(/\n===FIELD===\n?/);
        return success({
          id: message_id,
          subject: fields[0] || "",
          sender: fields[1] || "",
          date: fields[2] || "",
          read: fields[3] === "true",
          content: fields[4] || "",
          to: fields[5] || "",
          cc: fields[6] || "",
        });
      }

      // Scan all accounts' inboxes
      const accountNames = await runAppleScript(
        `tell application "Mail" to get name of every account`,
      );
      if (!accountNames) return error(`Message ${message_id} not found.`);

      for (const acctName of accountNames.split(", ")) {
        try {
          const script = `
tell application "Mail"
  set m to first message of mailbox "INBOX" of account "${acctName}" whose id is ${message_id}
  set subj to subject of m
  set sndr to sender of m
  set rcvd to date received of m as string
  set isRead to (read status of m)
  set cnt to content of m
  set toStr to (address of every to recipient of m) as string
  set ccStr to (address of every cc recipient of m) as string
  return subj & "\\n===FIELD===\\n" & sndr & "\\n===FIELD===\\n" & rcvd & "\\n===FIELD===\\n" & isRead & "\\n===FIELD===\\n" & cnt & "\\n===FIELD===\\n" & toStr & "\\n===FIELD===\\n" & ccStr
end tell`;
          const raw = await runAppleScript(script);
          const fields = raw.split(/\n===FIELD===\n?/);
          return success({
            id: message_id,
            account: acctName,
            subject: fields[0] || "",
            sender: fields[1] || "",
            date: fields[2] || "",
            read: fields[3] === "true",
            content: fields[4] || "",
            to: fields[5] || "",
            cc: fields[6] || "",
          });
        } catch {
          continue; // Not in this account, try next
        }
      }

      return error(`Message ${message_id} not found in any inbox.`);
    }),
  );

  server.tool(
    "mail_mark_read",
    "Mark a message as read",
    {
      message_id: z.coerce.number().int().describe("Message ID"),
      account: z.string().optional().describe("Account name"),
      mailbox: z.string().optional().describe("Mailbox name"),
    },
    withErrorHandling(async ({ message_id, account, mailbox }) => {
      const target = account
        ? (mailbox
          ? `mailbox "${escapeForAppleScript(mailbox)}" of account "${escapeForAppleScript(account)}"`
          : `mailbox "INBOX" of account "${escapeForAppleScript(account)}"`)
        : "inbox";

      await runAppleScript(`
tell application "Mail"
  set m to first message of ${target} whose id is ${message_id}
  set read status of m to true
end tell`);
      return success({ message_id, marked_read: true });
    }),
  );

  server.tool(
    "mail_mark_unread",
    "Mark a message as unread",
    {
      message_id: z.coerce.number().int().describe("Message ID"),
      account: z.string().optional().describe("Account name"),
      mailbox: z.string().optional().describe("Mailbox name"),
    },
    withErrorHandling(async ({ message_id, account, mailbox }) => {
      const target = account
        ? (mailbox
          ? `mailbox "${escapeForAppleScript(mailbox)}" of account "${escapeForAppleScript(account)}"`
          : `mailbox "INBOX" of account "${escapeForAppleScript(account)}"`)
        : "inbox";
      await runAppleScript(`
tell application "Mail"
  set m to first message of ${target} whose id is ${message_id}
  set read status of m to false
end tell`);
      return success({ message_id, marked_unread: true });
    }),
  );

  server.tool(
    "mail_flag",
    "Flag or unflag a message",
    {
      message_id: z.coerce.number().int().describe("Message ID"),
      account: z.string().optional().describe("Account name"),
      mailbox: z.string().optional().describe("Mailbox name"),
      flagged: z.coerce.boolean().default(true).describe("true to flag, false to unflag"),
    },
    withErrorHandling(async ({ message_id, account, mailbox, flagged }) => {
      const target = account
        ? (mailbox
          ? `mailbox "${escapeForAppleScript(mailbox)}" of account "${escapeForAppleScript(account)}"`
          : `mailbox "INBOX" of account "${escapeForAppleScript(account)}"`)
        : "inbox";
      await runAppleScript(`
tell application "Mail"
  set m to first message of ${target} whose id is ${message_id}
  set flagged status of m to ${flagged}
end tell`);
      return success({ message_id, flagged });
    }),
  );

  server.tool(
    "mail_move",
    "Move a message to another mailbox",
    {
      message_id: z.coerce.number().int().describe("Message ID"),
      account: z.string().describe("Account name"),
      from_mailbox: z.string().default("INBOX").describe("Source mailbox name"),
      to_mailbox: z.string().describe("Destination mailbox name"),
      to_account: z.string().optional().describe("Destination account name (if different from source account)"),
    },
    withErrorHandling(async ({ message_id, account, from_mailbox, to_mailbox, to_account }) => {
      const esc = escapeForAppleScript;
      const destAccount = to_account || account;
      const isCrossAccount = destAccount !== account;
      await runAppleScript(`
tell application "Mail"
  set m to first message of mailbox "${esc(from_mailbox)}" of account "${esc(account)}" whose id is ${message_id}
  ${isCrossAccount
    ? `duplicate m to mailbox "${esc(to_mailbox)}" of account "${esc(destAccount)}"
  delete m`
    : `move m to mailbox "${esc(to_mailbox)}" of account "${esc(destAccount)}"`}
end tell`);
      return success({ message_id, moved_to: to_mailbox, to_account: destAccount });
    }),
  );

  server.tool(
    "mail_delete",
    "Delete a message (moves to Deleted Messages / Trash)",
    {
      message_id: z.coerce.number().int().describe("Message ID"),
      account: z.string().describe("Account name"),
      mailbox: z.string().default("INBOX").describe("Mailbox containing the message"),
    },
    withErrorHandling(async ({ message_id, account, mailbox }) => {
      const esc = escapeForAppleScript;
      await runAppleScript(`
tell application "Mail"
  set m to first message of mailbox "${esc(mailbox)}" of account "${esc(account)}" whose id is ${message_id}
  delete m
end tell`);
      return success({ message_id, deleted: true });
    }),
  );

  server.tool(
    "mail_list_attachments",
    "List attachments of a message (name, size, MIME type)",
    {
      message_id: z.coerce.number().int().describe("Message ID"),
      account: z.string().describe("Account name"),
      mailbox: z.string().default("INBOX").describe("Mailbox name"),
    },
    withErrorHandling(async ({ message_id, account, mailbox }) => {
      const esc = escapeForAppleScript;
      const target = `mailbox "${esc(mailbox)}" of account "${esc(account)}"`;
      const raw = await runAppleScript(`
tell application "Mail"
  set m to first message of ${target} whose id is ${message_id}
  set atts to every mail attachment of m
  set output to ""
  repeat with a in atts
    set mimeType to "unknown"
    try
      set mimeType to MIME type of a
    end try
    set output to output & (name of a) & "\\t" & mimeType & "\\t" & (file size of a) & "\\n"
  end repeat
  return output
end tell`);

      const attachments = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parts = line.split("\t");
          return { name: parts[0], mime_type: parts[1], size: parseInt(parts[2], 10) || 0 };
        });

      return success({ message_id, attachments });
    }),
  );

  server.tool(
    "mail_save_attachment",
    "Save a specific attachment to disk by message ID and attachment name",
    {
      message_id: z.coerce.number().int().describe("Message ID"),
      account: z.string().describe("Account name"),
      mailbox: z.string().default("INBOX").describe("Mailbox name"),
      attachment_name: z.string().describe("Name of the attachment to save"),
      save_path: z.string().default("/tmp/").describe("Directory path to save the attachment to"),
    },
    withErrorHandling(async ({ message_id, account, mailbox, attachment_name, save_path }) => {
      const esc = escapeForAppleScript;
      const target = `mailbox "${esc(mailbox)}" of account "${esc(account)}"`;
      await runAppleScript(`
tell application "Mail"
  set m to first message of ${target} whose id is ${message_id}
  set atts to every mail attachment of m whose name is "${esc(attachment_name)}"
  if (count of atts) is 0 then error "Attachment not found: ${esc(attachment_name)}"
  set a to item 1 of atts
  save a in POSIX file "${esc(save_path)}${esc(attachment_name)}"
end tell`);

      return success({ message_id, attachment_name, saved_to: `${save_path}${attachment_name}` });
    }),
  );
}
