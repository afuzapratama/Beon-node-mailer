const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { parse } = require('csv-parse/sync');

function bool(value, fallback, name) {
    if (value === undefined || value === '') return fallback;
    if (value !== 'true' && value !== 'false') throw new Error(`${name}: harus true atau false`);
    return value === 'true';
}
function integer(value, fallback, min, max, name) {
    if (value === undefined || value === '') return fallback;
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
        throw new Error(`${name}: harus integer ${min}–${max}`);
    }
    return Number(value);
}
function email(value) {
    // Deliberately accept plain ASCII mailboxes only, not display names/comments.
    if (typeof value !== 'string' || value.length > 254) return false;
    const parts = value.split('@');
    return parts.length === 2 && parts[0].length <= 64 &&
        /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(parts[0]) &&
        !parts[0].startsWith('.') && !parts[0].endsWith('.') && !parts[0].includes('..') &&
        parts[1].includes('.') && hostname(parts[1]);
}
function hostname(value) {
    return typeof value === 'string' && value.length <= 253 && value.split('.').every(part =>
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(part));
}
function read(file) {
    try { return fs.readFileSync(file, 'utf8'); }
    catch { throw new Error(`Tidak dapat membaca file: ${file}`); }
}
function lines(text) { return text.replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')); }
function recipientList(file, deduplicate) {
    const list = lines(read(file));
    const invalid = list.map((item, i) => email(item) ? null : i + 1).filter(Boolean);
    if (invalid.length) throw new Error(`Alamat invalid di ${file}, entri ${invalid.join(', ')} (format: alamat saja)`);
    // Preserve local-part case; normalize domain only.
    const canonical = list.map(value => { const [local, domain] = value.split('@'); return `${local}@${domain.toLowerCase()}`; });
    return deduplicate ? [...new Set(canonical)] : canonical;
}
function server(row, label, root, defaults) {
    const field = key => typeof row[key] === 'string' ? row[key].trim() : row[key];
    for (const key of ['host', 'port', 'user', 'pass', 'secure']) {
        if (row[key] === undefined || row[key] === '') throw new Error(`${label}: ${key} wajib diisi`);
    }
    const host = field('host');
    if (!net.isIP(host) && !hostname(host)) throw new Error(`${label}: host invalid`);
    const user = field('user');
    if (!user || /[\r\n\x00]/.test(user) || /[\r\n\x00]/.test(row.pass)) throw new Error(`${label}: kredensial invalid`);
    const fromEmail = field('from_email') || defaults.customFrom || user;
    if (!email(fromEmail)) throw new Error(`${label}: from_email wajib berupa alamat email valid`);
    const replyTo = field('reply_to') || defaults.replyTo || '';
    if (replyTo && !email(replyTo)) throw new Error(`${label}: reply_to wajib berupa satu alamat email valid`);
    const servername = field('tls_servername') || (net.isIP(host) ? '' : host);
    if (!servername || !hostname(servername)) throw new Error(`${label}: tls_servername wajib valid (terutama host IP)`);
    const caPath = field('tls_ca_path');
    const port = integer(field('port'), undefined, 1, 65535, `${label}.port`);
    const secure = bool(field('secure'), false, `${label}.secure`);
    if (port === 465 && !secure) throw new Error(`${label}: port 465 membutuhkan secure=true`);
    if (port === 587 && secure) throw new Error(`${label}: port 587 membutuhkan secure=false (STARTTLS)`);
    const id = field('id') || label;
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) throw new Error(`${label}: id invalid`);
    return {
        id, host, port, user, pass: row.pass, fromEmail, replyTo, secure,
        enabled: bool(field('enabled'), true, `${label}.enabled`),
        requireTLS: bool(field('require_tls'), true, `${label}.require_tls`),
        rejectUnauthorized: bool(field('tls_reject_unauthorized'), true, `${label}.tls_reject_unauthorized`),
        servername, ca: caPath ? read(path.resolve(root, caPath)) : undefined,
        maxConnections: integer(field('max_connections'), defaults.connections, 1, 50, `${label}.max_connections`),
        rateLimit: integer(field('rate_limit'), defaults.rateLimit, 1, 100000, `${label}.rate_limit`),
        rateDelta: integer(field('rate_delta_ms'), defaults.rateDelta, 1, 3600000, `${label}.rate_delta_ms`),
    };
}
function smtpCsv(text, root, defaults) {
    const required = ['host', 'port', 'user', 'pass', 'secure'];
    const allowed = [...required, 'id', 'from_email', 'reply_to', 'enabled', 'require_tls', 'tls_servername', 'tls_ca_path',
        'tls_reject_unauthorized', 'max_connections', 'rate_limit', 'rate_delta_ms'];
    let rows;
    try {
        rows = parse(text, { bom: true, skip_empty_lines: true, info: true, max_record_size: 65536,
            columns(headers) {
                if (new Set(headers).size !== headers.length || required.some(key => !headers.includes(key)) || headers.some(key => !allowed.includes(key))) {
                    throw new Error('header invalid');
                }
                return headers;
            },
        });
    } catch (error) { throw new Error(`CSV SMTP invalid${error.lines ? `, baris ${error.lines}` : ''}: periksa header, kutip, dan jumlah kolom`); }
    if (!rows.length) throw new Error('CSV SMTP kosong');
    const servers = rows.map(({ record, info }) => server(record, `smtp-line-${info.lines}`, root, defaults));
    const ids = new Set(), endpoints = new Set();
    for (const item of servers) {
        const endpoint = JSON.stringify([item.host.toLowerCase(), item.port, item.user]);
        if (ids.has(item.id) || endpoints.has(endpoint)) throw new Error(`SMTP duplikat: ${item.id}`);
        ids.add(item.id); endpoints.add(endpoint);
    }
    return servers.filter(item => item.enabled);
}
function loadConfig(env = process.env, options = {}, root = path.resolve(__dirname, '..')) {
    const file = (name, fallback) => path.resolve(root, env[name] || fallback);
    const number = (name, fallback, min, max) => integer(env[name], fallback, min, max, name);
    const boolean = (name, fallback) => bool(env[name], fallback, name);
    const mode = env.SMTP_MODE || 'single';
    if (!['single', 'multiple'].includes(mode)) throw new Error('SMTP_MODE: single atau multiple');
    if (env.SMTP_SELECTION && env.SMTP_SELECTION !== 'round_robin') throw new Error('SMTP_SELECTION: round_robin');
    const defaults = {
        customFrom: env.CUSTOM_FROM_EMAIL || '',
        replyTo: (env.REPLY_TO || '').trim(),
        connections: number('SMTP_MAX_CONNECTIONS', 2, 1, 50),
        rateLimit: number('SMTP_RATE_LIMIT', 10, 1, 100000),
        rateDelta: number('SMTP_RATE_DELTA_MS', 1000, 1, 3600000),
    };
    if (defaults.replyTo && !email(defaults.replyTo)) throw new Error('REPLY_TO wajib berupa satu alamat email valid');
    const servers = mode === 'multiple' ? smtpCsv(read(file('SMTP_LIST_PATH', 'smtp/servers.csv')), root, defaults) : [server({
        host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS,
        secure: env.SMTP_SECURE === undefined ? 'false' : env.SMTP_SECURE,
        require_tls: env.SMTP_REQUIRE_TLS, tls_reject_unauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED,
        tls_servername: env.SMTP_TLS_SERVERNAME, tls_ca_path: env.SMTP_TLS_CA_PATH,
    }, 'single', root, defaults)];
    if (!servers.length) throw new Error('Tidak ada SMTP aktif');
    const ehlo = env.SMTP_HOSTNAME || 'localhost';
    if (!hostname(ehlo)) throw new Error('SMTP_HOSTNAME harus hostname stabil yang valid');
    const priority = env.EMAIL_PRIORITY || 'normal';
    if (!['high', 'normal', 'low'].includes(priority)) throw new Error('EMAIL_PRIORITY invalid');
    const locale = env.EMAIL_LOCALE || 'id-ID', timezone = env.EMAIL_TIMEZONE || 'Asia/Jakarta';
    try { new Intl.DateTimeFormat(locale, { timeZone: timezone }).format(); }
    catch { throw new Error('EMAIL_LOCALE/EMAIL_TIMEZONE invalid'); }
    const listPath = path.resolve(root, options.emailListPath || 'lists/emails.txt');
    const suppressionPath = file('SUPPRESSION_LIST_PATH', 'lists/suppressed.txt');
    const suppressed = new Set(!env.SUPPRESSION_LIST_PATH && !fs.existsSync(suppressionPath) ? [] : recipientList(suppressionPath, true));
    const recipients = options.resume ? [] : recipientList(listPath, boolean('REMOVE_DUPLICATE_EMAILS', true));
    const batch = boolean('ENABLE_BATCH_SENDING', false);
    return {
        root, servers, ehlo, listPath, suppressed,
        recipients: recipients.filter(item => !suppressed.has(item)),
        suppressedCount: recipients.filter(item => suppressed.has(item)).length,
        letter: read(file('LETTER_PATH', 'letters/letter.html')),
        text: env.TEXT_LETTER_PATH ? read(file('TEXT_LETTER_PATH')) : '',
        countries: lines(read(path.join(root, 'data/country.txt'))),
        devices: lines(read(path.join(root, 'data/device.txt'))),
        links: lines(read(path.join(root, 'links/links.txt'))),
        sender: env.SENDER_NAME || 'Pengirim Default', subject: env.EMAIL_SUBJECT || 'Subjek Default',
        unsubscribe: env.UNSUBSCRIBE_URL_TEMPLATE || '', enableUnsubscribe: boolean('ENABLE_UNSUBSCRIBE', true),
        locale, timezone, promoEnd: env.PROMO_END_DATE || '',
        priority, minimalHeaders: boolean('USE_MINIMAL_HEADERS', false),
        batchSize: number('BATCH_SIZE', 10, 1, 1000), batch,
        concurrency: batch ? number('MAX_CONCURRENCY', 5, 1, 50) : 1,
        delay: number('SEND_DELAY_SECONDS', 1, 0, 86400) * 1000,
        retries: number('RETRY_ATTEMPTS', 2, 0, 10), retryDelay: number('RETRY_DELAY_SECONDS', 3, 0, 3600) * 1000,
        cooldown: number('SMTP_COOLDOWN_SECONDS', 10, 0, 3600) * 1000,
        verifyConcurrency: number('SMTP_VERIFY_CONCURRENCY', 3, 1, 10),
        connectionTimeout: number('SMTP_CONNECTION_TIMEOUT_MS', 30000, 100, 300000),
        greetingTimeout: number('SMTP_GREETING_TIMEOUT_MS', 30000, 100, 300000),
        socketTimeout: number('SMTP_SOCKET_TIMEOUT_MS', 60000, 100, 600000),
        logging: boolean('ENABLE_FILE_LOGGING', true), debug: boolean('DEBUG_MODE', false),
        removeSent: boolean('REMOVE_SENT_EMAIL_FROM_LIST', false),
        journalDir: file('JOURNAL_DIR', 'logs/campaigns'), logDir: file('LOG_DIR', 'logs'),
    };
}
module.exports = { loadConfig, smtpCsv, bool, integer, email, read, lines, recipientList };
