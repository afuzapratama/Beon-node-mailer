# Beon Mailer

Node.js CommonJS CLI using Nodemailer. Requires Node.js ^22.13.0 or >=24, npm >=10.

- `index.js`: interactive confirmation, --list, --dry-run, --preview, --resume.
- `mailer.js`: orchestration; accepts dependencies for tests (env/root/transport/signals/log).
- `src/config.js`: strict config, csv-parse, file/recipient preflight.
- `src/template.js`: per-job renderer with HTML/URL escaping, stable random values.
- `src/smtp.js`: separate transports, bounded verify/dispatch, round-robin/rate limits.
- `src/journal.js`: locked JSON snapshot, fsync/atomic rename, crash recovery.
- `smtp/servers.example.csv`: public example. Real SMTP files are Git ignored.
- `lists/suppressed.example.txt`: suppression format. Actual suppression list is ignored.

Read README and docs/rencana-perbaikan.md for current behavior and limitations.
Do not log credentials or enable raw SMTP debug. Keep certificate verification on
by default and support explicit per-server CA/exception settings. Disable internal
pool requeue (`maxRequeues=0`). Network errors labeled CONN can happen after DATA:
classify ambiguous outcomes uncertain, never automatically retry them.

Persist in_flight before I/O and result before auxiliary logging. Persistence errors
must stop new dispatch and must never turn an SMTP accepted result into a retry.
Resume pending only; accepted/rejected/uncertain are not resent. Keep content and
Message-ID stable across retries, record changes of SMTP/From. Use plain mailboxes,
validate before networking, and close transports/list/journal locks in finally.

Run npm test and npm audit --omit=dev. Tests use temporary directories, injected
transports, and a loopback TLS/STARTTLS SMTP server, never real recipients. Local
SMTP tests require openssl. Real VPS SMTP validation remains a separate step.
