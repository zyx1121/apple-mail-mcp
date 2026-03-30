import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { runAppleScript } from "../applescript.js";
import { success, error, withErrorHandling } from "../helpers.js";
import { randomUUID } from "node:crypto";

const MAIL_DATA = `${process.env.HOME}/Library/Mail/V10/MailData`;
const RULES_PLIST = `${MAIL_DATA}/SyncedRules.plist`;
const ACTIVE_PLIST = `${MAIL_DATA}/RulesActiveState.plist`;

const HEADER_MAP: Record<string, string> = {
  from: "From",
  subject: "Subject",
  to: "To",
  cc: "Cc",
  any_recipient: "AnyRecipient",
  body: "Body",
};

function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trimEnd());
    });
  });
}

async function readPlistAsJson(path: string): Promise<unknown> {
  const json = await execFileAsync("plutil", ["-convert", "json", "-o", "-", path]);
  return JSON.parse(json);
}

async function writePlist(path: string, data: unknown): Promise<void> {
  const tmpPath = `${path}.tmp.json`;
  await writeFile(tmpPath, JSON.stringify(data));
  await execFileAsync("plutil", ["-convert", "binary1", "-o", path, tmpPath]);
  await execFileAsync("rm", [tmpPath]);
}

async function restartMail(): Promise<void> {
  try {
    await runAppleScript('tell application "Mail" to quit');
  } catch { /* not running */ }
  await new Promise((r) => setTimeout(r, 2000));
  await execFileAsync("open", ["-a", "Mail"]);
}

async function resolveAccountUrl(accountName: string): Promise<string> {
  const escaped = accountName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const accountId = await runAppleScript(
    `tell application "Mail" to get id of account "${escaped}"`,
  );
  return `imap://${accountId}`;
}

interface RuleCriterion {
  CriterionUniqueId: string;
  Expression: string;
  Header: string;
}

interface RuleDict {
  RuleId: string;
  RuleName: string;
  AllCriteriaMustBeSatisfied: boolean;
  Criteria: RuleCriterion[];
  MailboxURL: string;
  CopyToMailboxURL: string;
  ShouldTransferMessage: boolean;
  ShouldCopyMessage: boolean;
  StopEvaluatingRules: boolean;
  Deletes: boolean;
  MarkFlagged: boolean;
  MarkRead: boolean;
  NotifyUser: boolean;
  SendNotification: boolean;
  HighlightTextUsingColor: boolean;
  AutoResponseType: number;
  TimeStamp: number;
}

export function registerRuleTools(server: McpServer) {
  server.tool(
    "mail_list_rules",
    "List all mail rules with their conditions and status",
    {},
    withErrorHandling(async () => {
      const rules = (await readPlistAsJson(RULES_PLIST)) as RuleDict[];
      const activeState = (await readPlistAsJson(ACTIVE_PLIST)) as Record<string, boolean>;

      return success(rules.map((r) => ({
        id: r.RuleId,
        name: r.RuleName,
        enabled: activeState[r.RuleId] ?? false,
        match_all: r.AllCriteriaMustBeSatisfied,
        stop_evaluating: r.StopEvaluatingRules,
        move_to: r.ShouldTransferMessage ? r.MailboxURL : null,
        conditions: r.Criteria.map((c) => ({
          header: Object.entries(HEADER_MAP).find(([, v]) => v === c.Header)?.[0] ?? c.Header,
          expression: c.Expression,
        })),
      })));
    }),
  );

  server.tool(
    "mail_create_rule",
    "Create a mail rule that automatically sorts incoming messages. Writes directly to Mail plist files (bypasses AppleScript bugs). Restarts Mail to apply.",
    {
      name: z.string().describe("Rule name"),
      conditions: z
        .array(
          z.object({
            header: z.enum(["from", "subject", "to", "cc", "any_recipient", "body"]).describe("Field to match"),
            expression: z.string().describe("Text to match (contains)"),
          }),
        )
        .min(1)
        .describe("Conditions (any must match by default)"),
      move_to_account: z.string().describe("Destination account name (e.g. 'iCloud')"),
      move_to_mailbox: z.string().describe("Destination mailbox name (e.g. 'Payment')"),
      match_all: z.boolean().default(false).describe("If true, ALL conditions must match. Default: ANY"),
      stop_evaluating: z.boolean().default(true).describe("Stop evaluating subsequent rules after match"),
    },
    withErrorHandling(async ({ name, conditions, move_to_account, move_to_mailbox, match_all, stop_evaluating }) => {
      const accountUrl = await resolveAccountUrl(move_to_account);
      const mailboxUrl = `${accountUrl}/${move_to_mailbox}`;
      const ruleId = randomUUID().toUpperCase();

      const rule: RuleDict = {
        RuleId: ruleId,
        RuleName: name,
        AllCriteriaMustBeSatisfied: match_all,
        Criteria: conditions.map((c) => ({
          CriterionUniqueId: randomUUID().toUpperCase(),
          Expression: c.expression,
          Header: HEADER_MAP[c.header] ?? c.header,
        })),
        MailboxURL: mailboxUrl,
        CopyToMailboxURL: mailboxUrl,
        ShouldTransferMessage: true,
        ShouldCopyMessage: false,
        StopEvaluatingRules: stop_evaluating,
        Deletes: false,
        MarkFlagged: false,
        MarkRead: false,
        NotifyUser: false,
        SendNotification: false,
        HighlightTextUsingColor: false,
        AutoResponseType: 0,
        TimeStamp: Math.floor(Date.now() / 1000),
      };

      // Quit Mail before modifying plists
      try { await runAppleScript('tell application "Mail" to quit'); } catch { /* ok */ }
      await new Promise((r) => setTimeout(r, 2000));

      const rules = (await readPlistAsJson(RULES_PLIST)) as RuleDict[];
      rules.push(rule);
      await writePlist(RULES_PLIST, rules);

      const activeState = (await readPlistAsJson(ACTIVE_PLIST)) as Record<string, boolean>;
      activeState[ruleId] = true;
      await writePlist(ACTIVE_PLIST, activeState);

      await execFileAsync("open", ["-a", "Mail"]);

      return success({ id: ruleId, name, conditions: conditions.length, move_to: mailboxUrl, created: true });
    }),
  );

  server.tool(
    "mail_delete_rule",
    "Delete a mail rule by name or ID. Restarts Mail to apply.",
    {
      name: z.string().optional().describe("Rule name to delete"),
      rule_id: z.string().optional().describe("Rule ID to delete"),
    },
    withErrorHandling(async ({ name, rule_id }) => {
      if (!name && !rule_id) return error("Provide either name or rule_id");

      const rules = (await readPlistAsJson(RULES_PLIST)) as RuleDict[];
      const idx = rules.findIndex((r) =>
        rule_id ? r.RuleId === rule_id : r.RuleName === name,
      );
      if (idx === -1) return error(`Rule not found: ${name || rule_id}`);

      const deleted = rules.splice(idx, 1)[0];

      try { await runAppleScript('tell application "Mail" to quit'); } catch { /* ok */ }
      await new Promise((r) => setTimeout(r, 2000));

      await writePlist(RULES_PLIST, rules);

      const activeState = (await readPlistAsJson(ACTIVE_PLIST)) as Record<string, boolean>;
      delete activeState[deleted.RuleId];
      await writePlist(ACTIVE_PLIST, activeState);

      await execFileAsync("open", ["-a", "Mail"]);

      return success({ id: deleted.RuleId, name: deleted.RuleName, deleted: true });
    }),
  );
}
