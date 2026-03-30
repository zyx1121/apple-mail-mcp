import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runAppleScript, escapeForAppleScript } from "../applescript.js";
import { success, error, withErrorHandling } from "../helpers.js";

export function registerDraftTools(server: McpServer) {
  server.tool(
    "mail_create_draft",
    "Create a draft email message (visible but not sent)",
    {
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body (plain text)"),
      cc: z.string().optional().describe("CC email address"),
      bcc: z.string().optional().describe("BCC email address"),
      from_account: z.string().optional().describe("Account name to send from"),
    },
    withErrorHandling(async ({ to, subject, body, cc, bcc, from_account }) => {
      const esc = escapeForAppleScript;

      const ccLine = cc
        ? `\n    make new cc recipient at end of cc recipients with properties {address: "${esc(cc)}"}`
        : "";
      const bccLine = bcc
        ? `\n    make new bcc recipient at end of bcc recipients with properties {address: "${esc(bcc)}"}`
        : "";
      const senderLine = from_account
        ? `\n    set sender to "${esc(from_account)}"`
        : "";

      await runAppleScript(`
tell application "Mail"
  set newMsg to make new outgoing message with properties {subject: "${esc(subject)}", content: "${esc(body)}", visible: true}
  tell newMsg${senderLine}
    make new to recipient at end of to recipients with properties {address: "${esc(to)}"}${ccLine}${bccLine}
  end tell
end tell`);

      return success({ to, subject, draft_created: true });
    }),
  );

  server.tool(
    "mail_list_drafts",
    "List draft messages in an account's Drafts mailbox",
    {
      account: z.string().describe("Account name"),
      limit: z.number().int().positive().max(100).default(20).describe("Max drafts to return"),
    },
    withErrorHandling(async ({ account, limit }) => {
      const esc = escapeForAppleScript;
      const raw = await runAppleScript(`
tell application "Mail"
  set msgs to every message of mailbox "Drafts" of account "${esc(account)}"
  set maxCount to ${limit}
  if (count of msgs) < maxCount then set maxCount to (count of msgs)
  set output to ""
  repeat with i from 1 to maxCount
    set m to item i of msgs
    set output to output & (id of m) & "\\t" & (subject of m) & "\\t" & (sender of m) & "\\t" & (date received of m as string) & "\\n"
  end repeat
  return output
end tell`);

      const drafts = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parts = line.split("\t");
          return {
            id: parseInt(parts[0], 10),
            subject: parts[1] || "",
            sender: parts[2] || "",
            date: parts[3] || "",
          };
        });

      return success({ account, drafts });
    }),
  );

  server.tool(
    "mail_delete_draft",
    "Delete a draft message by ID",
    {
      message_id: z.coerce.number().int().describe("Draft message ID"),
      account: z.string().describe("Account name"),
    },
    withErrorHandling(async ({ message_id, account }) => {
      const esc = escapeForAppleScript;
      await runAppleScript(`
tell application "Mail"
  set m to first message of mailbox "Drafts" of account "${esc(account)}" whose id is ${message_id}
  delete m
end tell`);
      return success({ message_id, deleted: true });
    }),
  );
}
