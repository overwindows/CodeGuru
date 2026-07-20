---
name: himalaya
description: CLI email client for IMAP/SMTP from terminal
when_to_use: When you need to manage emails from the terminal, including reading, composing, sending, searching, and organizing emails
---

# Himalaya Email CLI

Himalaya is a CLI email client that lets you manage emails from the terminal using IMAP, SMTP, Notmuch, or Sendmail backends.

## Prerequisites

1. Himalaya CLI installed
2. A configuration file at `~/.config/himalaya/config.toml`
3. IMAP/SMTP credentials configured

### Installation

```bash
# Pre-built binary (Linux/macOS)
curl -sSL https://raw.githubusercontent.com/pimalaya/himalaya/master/install.sh | PREFIX=~/.local sh

# macOS via Homebrew
brew install himalaya

# Or via cargo
cargo install himalaya --locked
```

## Configuration Setup

```bash
himalaya account configure
```

Or create `~/.config/himalaya/config.toml`:

```toml
[accounts.personal]
email = "you@example.com"
display-name = "Your Name"
default = true

backend.type = "imap"
backend.host = "imap.example.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "you@example.com"
backend.auth.type = "password"
backend.auth.cmd = "pass show email/imap"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.example.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
message.send.backend.login = "you@example.com"
message.send.backend.auth.type = "password"
message.send.backend.auth.cmd = "pass show email/smtp"

folder.aliases.inbox = "INBOX"
folder.aliases.sent = "Sent"
folder.aliases.drafts = "Drafts"
folder.aliases.trash = "Trash"
```

## Common Operations

### List Folders
```bash
himalaya folder list
```

### List Emails
```bash
himalaya envelope list
himalaya envelope list --folder "Sent"
himalaya envelope list --page 1 --page-size 20
```

### Search Emails
```bash
himalaya envelope list from john@example.com subject meeting
```

### Read an Email
```bash
himalaya message read 42
```

### Send Email (Non-interactive)
```bash
cat << 'EOF' | himalaya template send
From: you@example.com
To: recipient@example.com
Subject: Test Message

Hello from Himalaya!
EOF
```

### Reply to Email
```bash
himalaya template reply 42 | sed 's/^$/\nYour reply text here\n/' | himalaya template send
```

### Move/Copy Emails
```bash
himalaya message move "Archive" 42
himalaya message copy "Important" 42
```

### Delete Email
```bash
himalaya message delete 42
```

### Download Attachments
```bash
himalaya attachment download 42
```

## Output Formats
```bash
himalaya envelope list --output json
himalaya envelope list --output plain
```

## Tips

- Use `himalaya --help` for detailed usage
- Message IDs are relative to the current folder
- For rich emails with attachments, use MML syntax