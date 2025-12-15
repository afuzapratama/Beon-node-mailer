# Beon Mailer - Copilot Instructions

## Project Overview

Node.js CLI bulk email sender using Nodemailer with SMTP. Interactive prompts via Inquirer, supports batch/sequential sending modes, dynamic content templating, retry mechanism, and file logging.

## Architecture

```
index.js          # CLI entry point - prompts user, calls sendMail()
mailer.js         # Core logic: SMTP transport, templating, batch processing, retry, logging
letters/          # HTML email templates with placeholders
links/            # URL templates for tracking links
lists/            # Target email lists (one per line)
data/             # Static data files (countries, devices) for randomization
logs/             # Auto-generated: success/failed email logs (timestamped)
```

## Running the Application

```bash
npm start          # Runs index.js - prompts for email list path
```

Configuration via `.env` file (see `.env.example`). Key variable groups:
- **SMTP**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_HOSTNAME`
- **Content**: `SENDER_NAME`, `EMAIL_SUBJECT`, `LETTER_PATH`, `CUSTOM_FROM_EMAIL`
- **Sending**: `ENABLE_BATCH_SENDING`, `BATCH_SIZE`, `SEND_DELAY_SECONDS`
- **Retry**: `RETRY_ATTEMPTS`, `RETRY_DELAY_SECONDS`
- **Logging**: `ENABLE_FILE_LOGGING`, `DEBUG_MODE`
- **List**: `REMOVE_DUPLICATE_EMAILS`, `REMOVE_SENT_EMAIL_FROM_LIST`

## Startup Validation

The app validates before sending:
1. **Required .env vars** - Checks SMTP_HOST, PORT, USER, PASS exist via `validateEnvConfig()`
2. **SMTP Connection Test** - Verifies credentials work via `testSmtpConnection()` before sending any email

## Dynamic Placeholder System

Templates support these placeholders (processed by `processDynamicPlaceholders()`):

**Random string generators:**
- `{lowercase_N}`, `{uppercase_N}`, `{numeric_N}`, `{mixed_N}`, `{mixedupper_N}` - N chars
- `{generateid}` - UUID v4

**Email template variables (in `letters/*.html`):**
- `{email_penerima}` - recipient email
- `{nama_penerima}` - derived from email (before @, cleaned)
- `{nama_pengirim}` - sender name
- `{tanggal}` - current date (Indonesian locale)
- `{negara}` - random country from `data/country.txt`
- `{perangkat}` - random device from `data/device.txt`
- `{email_acak}` - faker-generated email
- `{nama_acak}` - faker-generated name
- `{shortlink}` - processed link from `links/links.txt`

## Key Patterns

### Adding New Email Templates
1. Create HTML file in `letters/`
2. Use placeholders above for dynamic content
3. Update `LETTER_PATH` in `.env`

### Link Template Format (`links/links.txt`)
```
https://example.com/?id={lowercase_8}&user={email_penerima}&track={numeric_17}
```
Lines starting with `#` are ignored.

### Retry Mechanism
Set `RETRY_ATTEMPTS=2` to retry failed emails up to 2 times with `RETRY_DELAY_SECONDS` delay. Implemented via `sendWithRetry()` helper function.

### File Logging
Enable `ENABLE_FILE_LOGGING=true` to save results to `logs/success-{timestamp}.txt` and `logs/failed-{timestamp}.txt`. Uses `logToFile()` helper.

## Code Conventions

- Indonesian variable names and comments throughout
- `chalk` for colored console output with emoji indicators
- All file paths use `path.join(__dirname, ...)` for cross-platform compatibility
- Key functions: `validateEnvConfig()`, `testSmtpConnection()`, `processDynamicPlaceholders()`, `processAndSendSingleEmail()`, `sendMail()`
- All file paths use `path.join(__dirname, ...)` for cross-platform compatibility
- Validation functions: `validateEnvConfig()`, `testSmtpConnection()`
