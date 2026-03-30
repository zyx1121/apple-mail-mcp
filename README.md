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
| `mail_list_messages` | List messages with filters (account, mailbox, date range, unread) |
| `mail_read_message` | Read full content of a message by ID |
| `mail_search` | Search by subject, sender, or both |
| `mail_send` | Compose and send an email |
| `mail_mark_read` | Mark a message as read |
| `mail_mark_unread` | Mark a message as unread |
| `mail_flag` | Flag or unflag a message |
| `mail_move` | Move a message to another mailbox (same account) |
| `mail_delete` | Delete a message (moves to Trash) |

### Attachments

| Tool | Description |
|------|-------------|
| `mail_list_attachments` | List attachments of a message (name, MIME type, size) |
| `mail_save_attachment` | Save an attachment to a local path |

### Drafts

| Tool | Description |
|------|-------------|
| `mail_create_draft` | Create a new draft email |
| `mail_list_drafts` | List all drafts in an account |
| `mail_delete_draft` | Delete a draft by ID |

### Rules

| Tool | Description |
|------|-------------|
| `mail_list_rules` | List all mail rules with conditions and status |
| `mail_create_rule` | Create a mail rule (writes directly to plist) |
| `mail_delete_rule` | Delete a mail rule by name or ID |

## Examples

```
"List my mail accounts"          → mail_get_accounts
"Show unread count"              → mail_count_unread
"Today's emails"                 → mail_list_messages { date_from: "2026-03-30" }
"Search for GitHub emails"       → mail_search { query: "GitHub" }
"Read message 12345"             → mail_read_message { message_id: 12345 }
"List attachments"               → mail_list_attachments { message_id: 12345, account: "iCloud", mailbox: "INBOX" }
"Save attachment"                → mail_save_attachment { message_id: 12345, account: "iCloud", mailbox: "INBOX", attachment_name: "file.pdf", save_path: "/tmp" }
"Create a draft"                 → mail_create_draft { account: "iCloud", subject: "Hello", body: "Hi there" }
"List my drafts"                 → mail_list_drafts { account: "iCloud" }
```

## Known issues

- **MIME type**: `MIME type` property crashes on some macOS versions — the tool returns `"unknown"` as fallback
- **Apple Mail rules API is broken**: AppleScript's `set move message of rule` does not properly set `ShouldTransferMessage` in the plist. `mail_create_rule` writes directly to plist files as a workaround
- macOS only (uses AppleScript via `osascript`)
- Mail.app must be running
- Subject search is case-sensitive (AppleScript limitation)

## License

MIT
