# @zyx1121/apple-mail-mcp

MCP server for Apple Mail — read, search, and manage emails via Claude Code.

## Install

```bash
claude mcp add apple-mail -- npx @zyx1121/apple-mail-mcp
```

## Prerequisites

- macOS with Apple Mail configured
- Node.js >= 18
- First run will prompt for Automation permission (System Settings > Privacy & Security > Automation)

## Tools

| Tool | Description |
|------|-------------|
| `mail_get_accounts` | List all accounts and their mailboxes |
| `mail_count_unread` | Count unread messages per account/mailbox |
| `mail_list_messages` | List messages with filters (account, mailbox, date range, unread) |
| `mail_read_message` | Read full content of a message by ID |
| `mail_search` | Search by subject, sender, or both |
| `mail_mark_read` | Mark a message as read |

## Examples

```
"List my mail accounts"         → mail_get_accounts
"Show unread count"             → mail_count_unread
"Yesterday's emails"            → mail_list_messages { date_from: "2026-03-26" }
"Search for GitHub emails"      → mail_search { query: "GitHub" }
"Read message 12345"            → mail_read_message { message_id: 12345 }
```

## Limitations

- macOS only (uses AppleScript via `osascript`)
- Subject search is case-sensitive (AppleScript limitation)
- Sender/body search fetches recent messages and filters in JS (last 30 days, max 500)
- Mail.app must be running

## License

MIT
