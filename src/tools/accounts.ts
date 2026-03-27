import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runAppleScript } from "../applescript.js";
import { success, error, withErrorHandling } from "../helpers.js";

export function registerAccountTools(server: McpServer) {
  server.tool(
    "mail_get_accounts",
    "List all mail accounts and their mailboxes",
    {},
    withErrorHandling(async () => {
      const accountNames = await runAppleScript(
        `tell application "Mail" to get name of every account`,
      );

      if (!accountNames) return success([]);

      const names = accountNames.split(", ");
      const accounts = [];

      for (const name of names) {
        const mailboxes = await runAppleScript(
          `tell application "Mail" to get name of every mailbox of account "${name}"`,
        );
        accounts.push({
          name,
          mailboxes: mailboxes ? mailboxes.split(", ") : [],
        });
      }

      return success(accounts);
    }),
  );

  server.tool(
    "mail_count_unread",
    "Count unread messages in a mailbox",
    {
      account: z.string().optional().describe("Account name (e.g. 'iCloud', 'Gmail'). Omit for all accounts."),
      mailbox: z.string().optional().describe("Mailbox name (e.g. 'INBOX'). Omit for inbox."),
    },
    withErrorHandling(async ({ account, mailbox }) => {
      if (account) {
        const target = mailbox
          ? `mailbox "${mailbox}" of account "${account}"`
          : `inbox`;
        const count = await runAppleScript(
          `tell application "Mail" to get unread count of ${target}`,
        );
        return success({ account, mailbox: mailbox || "INBOX", unread: parseInt(count, 10) });
      }

      // All accounts
      const accountNames = await runAppleScript(
        `tell application "Mail" to get name of every account`,
      );
      if (!accountNames) return success([]);

      const results = [];
      for (const name of accountNames.split(", ")) {
        const script = `
tell application "Mail"
  set acct to account "${name}"
  set output to ""
  repeat with mbox in every mailbox of acct
    set cnt to unread count of mbox
    if cnt > 0 then
      set output to output & (name of mbox) & "\\t" & cnt & "\\n"
    end if
  end repeat
  return output
end tell`;
        const raw = await runAppleScript(script);
        if (!raw) continue;
        for (const line of raw.split("\n")) {
          if (!line) continue;
          const [mboxName, cnt] = line.split("\t");
          results.push({ account: name, mailbox: mboxName, unread: parseInt(cnt, 10) });
        }
      }
      return success(results);
    }),
  );
}
