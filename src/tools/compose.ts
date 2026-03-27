import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runAppleScript, escapeForAppleScript } from "../applescript.js";
import { success, withErrorHandling } from "../helpers.js";

export function registerComposeTools(server: McpServer) {
  server.tool(
    "mail_send",
    "Send a new email or reply to an existing message",
    {
      to: z.string().optional().describe("Recipient email (required for new message)"),
      subject: z.string().optional().describe("Subject (required for new message)"),
      body: z.string().describe("Email body (plain text)"),
      cc: z.string().optional().describe("CC email address"),
      from_account: z.string().optional().describe("Account name to send from"),
      reply_to_id: z.number().int().optional().describe("Message ID to reply to"),
      reply_to_account: z.string().optional().describe("Account of message being replied to"),
      reply_to_mailbox: z.string().optional().describe("Mailbox of message being replied to (default: INBOX)"),
    },
    withErrorHandling(async ({ to, subject, body, cc, from_account, reply_to_id, reply_to_account, reply_to_mailbox }) => {
      const esc = escapeForAppleScript;

      if (reply_to_id) {
        // Reply mode
        const acct = reply_to_account || "";
        const mbox = reply_to_mailbox || "INBOX";
        const target = acct
          ? `mailbox "${esc(mbox)}" of account "${esc(acct)}"`
          : "inbox";

        await runAppleScript(`
tell application "Mail"
  set orig to first message of ${target} whose id is ${reply_to_id}
  set r to reply orig reply to all false
  set content of r to "${esc(body)}" & return & return & content of r
  send r
end tell`);
        return success({ replied_to: reply_to_id, sent: true });
      }

      // New message mode
      if (!to || !subject) throw new Error("to and subject are required for new messages");

      const ccLine = cc
        ? `\n    make new cc recipient at end of cc recipients with properties {address: "${esc(cc)}"}`
        : "";

      const senderLine = from_account
        ? `\n    set sender to "${esc(from_account)}"`
        : "";

      await runAppleScript(`
tell application "Mail"
  set newMsg to make new outgoing message with properties {subject: "${esc(subject)}", content: "${esc(body)}", visible: false}
  tell newMsg${senderLine}
    make new to recipient at end of to recipients with properties {address: "${esc(to)}"}${ccLine}
  end tell
  send newMsg
end tell`);
      return success({ to, subject, sent: true });
    }),
  );
}
