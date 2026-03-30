# @zyx1121/apple-mail-mcp

MCP server for Apple Mail — read, search, compose, and manage emails via Claude Code.

## Install

```bash
claude mcp add apple-mail -- npx @zyx1121/apple-mail-mcp
```

## Prerequisites

- macOS with Apple Mail configured
- Node.js >= 18
- First run will prompt for Automation permission (System Settings > Privacy & Security > Automation)

## Tools

### Accounts & Mailboxes

| Tool | Description |
|------|-------------|
| `mail_get_accounts` | List all accounts and their mailboxes |
| `mail_list_mailboxes` | List mailboxes for an account with unread counts |
| `mail_count_unread` | Count unread messages per account/mailbox |
| `mail_create_mailbox` | Create a new mailbox (folder) in an account |

### Messages

| Tool | Description |
|------|-------------|
| `mail_list_messages` | List messages with filters (account, mailbox, date range, unread). Returns `account` and `mailbox` fields for each message |
| `mail_read_message` | Read full content of a message by ID |
| `mail_search` | Search by subject, sender, or both |
| `mail_send` | Compose and send an email |
| `mail_mark_read` | Mark a message as read |
| `mail_mark_unread` | Mark a message as unread |
| `mail_flag` | Flag or unflag a message |
| `mail_move` | Move a message to another mailbox (same account) |
| `mail_delete` | Delete a message (moves to Trash) |

### Rules

| Tool | Description |
|------|-------------|
| `mail_list_rules` | List all mail rules with conditions and status |
| `mail_create_rule` | Create a mail rule (writes directly to plist, bypasses AppleScript bugs) |
| `mail_delete_rule` | Delete a mail rule by name or ID |

## Examples

```
"List my mail accounts"          → mail_get_accounts
"Show unread count"              → mail_count_unread
"Today's emails"                 → mail_list_messages { date_from: "2026-03-29" }
"Search for GitHub emails"       → mail_search { query: "GitHub" }
"Read message 12345"             → mail_read_message { message_id: 12345 }
"Move to Payment folder"         → mail_move { message_id: 12345, account: "iCloud", to_mailbox: "Payment" }
"Create a new folder"            → mail_create_mailbox { account: "iCloud", name: "Reports" }
"List my mail rules"             → mail_list_rules
```

## Cross-account message moving

`mail_move` only works within the same account. To move messages across accounts (e.g. Outlook → iCloud), use AppleScript directly:

```applescript
tell application "Mail"
  set m to first message of mailbox "INBOX" of account "Outlook" whose id is 12345
  move m to mailbox "Payment" of account "iCloud"
end tell
```

## Known issues

- **Apple Mail rules API is broken**: AppleScript's `set move message of rule` does not properly set `ShouldTransferMessage` in the plist, and iCloud sync overwrites manual plist fixes. `mail_create_rule` writes directly to plist files as a workaround, but the move action may not persist through iCloud sync. For reliable rules with move actions, configure them manually in Mail > Settings > Rules.
- macOS only (uses AppleScript via `osascript`)
- Mail.app must be running
- Subject search is case-sensitive (AppleScript limitation)

## License

MIT
