const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { sendMail } = require('../mailer');
const { loadConfig, smtpCsv } = require('../src/config');
const { render, buildMessage } = require('../src/template');
const { classify, transportOptions } = require('../src/smtp');
const { Journal, atomicWrite } = require('../src/journal');
const { argumentsFrom } = require('../index');
function setup(t, overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beon-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const files = {
        'letters/letter.html': '<p>Halo {nama_penerima} dari {nama_pengirim}</p><a href="{shortlink}">Promo</a>',
        'lists/emails.txt': 'alice+tag@example.com\nbob@example.com\ncarol@example.com\ndave@example.com\n',
        'lists/suppressed.txt': '# empty\n', 'links/links.txt': 'https://example.com/?email={email_penerima}&id={numeric_6}',
        'data/country.txt': 'Indonesia\n', 'data/device.txt': 'Desktop\n',
        'smtp/servers.csv': 'host,port,user,pass,secure,id\nsmtp.a.example,587,from@a.example,secret-a,false,a\nsmtp.b.example,465,from@b.example,secret-b,true,b\n',
    };
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), content);
    }
    const env = { SMTP_MODE: 'multiple', EMAIL_SUBJECT: 'Halo {nama_penerima}', SENDER_NAME: 'A&B <Store>',
        SEND_DELAY_SECONDS: '0', RETRY_DELAY_SECONDS: '0', SMTP_COOLDOWN_SECONDS: '0', RETRY_ATTEMPTS: '1',
        ENABLE_FILE_LOGGING: 'false', ...overrides };
    const sent = [], transports = [], signals = new EventEmitter();
    const deps = { env, root, signals, log() {}, createTransport(config) {
        const transport = { config, closed: false, async verify() {}, async sendMail(message) {
            sent.push({ config, message: structuredClone(message) });
            return { accepted: [message.to], rejected: [], messageId: message.messageId, response: '250 accepted' };
        }, close() { this.closed = true; } };
        transports.push(transport); return transport;
    } };
    return { root, env, deps, sent, transports, signals, file: name => path.join(root, name) };
}
test('strict numeric and boolean preflight rejects before transport creation', async t => {
    const s = setup(t);
    for (const [key, value] of [['BATCH_SIZE', '-1'], ['SMTP_PORT', '587junk'], ['SMTP_SECURE', 'yes'], ['RETRY_ATTEMPTS', '-2'], ['SEND_DELAY_SECONDS', '1.5']]) {
        const env = { ...s.env, [key]: value };
        if (key.startsWith('SMTP_')) Object.assign(env, { SMTP_MODE: 'single', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'user@example.com', SMTP_PASS: 'dummy' });
        await assert.rejects(sendMail({}, { ...s.deps, env }));
    }
    assert.equal(s.transports.length, 0);
    assert.equal(loadConfig(s.env, {}, s.root).delay, 0);
});
test('CSV quoted secrets, optional fields, duplicate/header errors and IP TLS name', () => {
    const defaults = { connections: 2, rateLimit: 10, rateDelta: 1000 };
    const header = 'host,port,user,pass,secure';
    const rows = smtpCsv(`${header}\nsmtp.example.com,587,user@example.com," secret,""quoted"" ",false\n`, '.', defaults);
    assert.equal(rows[0].pass, ' secret,"quoted" ');
    assert.equal(rows[0].rejectUnauthorized, true);
    assert.throws(() => smtpCsv(`${header}\nsmtp.example.com,587,u@example.com,p,false\nsmtp.example.com,587,u@example.com,q,false`, '.', defaults), /duplikat/);
    assert.throws(() => smtpCsv(`${header},bad\na,587,u@example.com,p,false,x`, '.', defaults), /CSV/);
    assert.throws(() => smtpCsv(`${header}\n127.0.0.1,587,u@example.com,p,false`, '.', defaults), /tls_servername/);
    assert.throws(() => smtpCsv(`${header}\nsmtp.example.com,587,u@example.com,"broken,false`, '.', defaults), /CSV/);
});
test('renderer personalizes subject, escapes HTML and URL and rejects missing placeholders', t => {
    const s = setup(t);
    const config = loadConfig(s.env, {}, s.root);
    const message = buildMessage(config, 'alice+tag@example.com', 'from@a.example');
    assert.equal(message.subject, 'Halo Alice+Tag');
    assert.match(message.html, /A&amp;B &lt;Store&gt;/);
    assert.match(message.html, /alice%2Btag%40example.com&amp;id=/);
    assert.match(message.text, /https:\/\/example.com/);
    assert.throws(() => render('{unknown_token}', {}), /tidak dikenal/);
    assert.throws(() => render('{numeric_9999999999}', {}), /invalid/);
    assert.throws(() => buildMessage({ ...config, letter: '{unsubscribe_link}' }, 'a@example.com', 'f@example.com'), /UNSUBSCRIBE/);
    assert.throws(() => buildMessage({ ...config, links: ['javascript:alert(1)'] }, 'a@example.com', 'f@example.com'), /HTTP/);
});
test('dry run produces private artifacts without SMTP or recipient mutation', async t => {
    const s = setup(t);
    const before = fs.readFileSync(s.file('lists/emails.txt'), 'utf8');
    const result = await sendMail({ dryRun: true }, s.deps);
    assert.equal(result.dryRun, true);
    assert.equal(s.transports.length, 0);
    assert.equal(fs.readFileSync(s.file('lists/emails.txt'), 'utf8'), before);
    assert.equal(fs.statSync(result.previewPath).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(s.file('logs/campaigns')), false);
});
test('round-robin distributes and accepted resume never resends', async t => {
    const s = setup(t);
    const result = await sendMail({}, s.deps);
    assert.equal(result.accepted, 4);
    assert.deepEqual(s.sent.map(item => item.config.host), ['smtp.a.example', 'smtp.b.example', 'smtp.a.example', 'smtp.b.example']);
    assert.equal(s.sent[1].message.from.address, 'from@b.example');
    assert.equal(s.transports.every(item => item.closed), true);
    const text = fs.readFileSync(result.journalPath, 'utf8');
    assert.equal(text.includes('secret-a'), false);
    const resumed = await sendMail({ resume: result.journalPath }, s.deps);
    assert.equal(resumed.accepted, 4); assert.equal(s.sent.length, 4);
    assert.equal(s.signals.listenerCount('SIGINT'), 0);
});
test('verify failure excludes server and all failures close pools', async t => {
    const s = setup(t); const factory = s.deps.createTransport;
    s.deps.createTransport = config => { const transport = factory(config); if (config.host === 'smtp.a.example') transport.verify = async () => { throw { code: 'EAUTH' }; }; return transport; };
    const result = await sendMail({}, s.deps);
    assert.equal(result.accepted, 4);
    assert.equal(s.sent.every(item => item.config.host === 'smtp.b.example'), true);
    const f = setup(t); const ff = f.deps.createTransport;
    f.deps.createTransport = config => { const transport = ff(config); transport.verify = async () => { throw { code: 'EAUTH' }; }; return transport; };
    await assert.rejects(sendMail({}, f.deps), /Tidak ada SMTP sehat/);
    assert.equal(f.transports.every(item => item.closed), true);
});
test('temporary failure retries unchanged message on another server; permanent rejection does not retry', async t => {
    const s = setup(t); fs.writeFileSync(s.file('lists/emails.txt'), 'alice@example.com\n');
    const factory = s.deps.createTransport;
    s.deps.createTransport = config => {
        const transport = factory(config); const send = transport.sendMail.bind(transport);
        transport.sendMail = async message => { const info = await send(message); if (config.host === 'smtp.a.example') throw { code: 'EENVELOPE', responseCode: 451, command: 'RCPT TO', response: '451 retry secret-a' }; return info; };
        return transport;
    };
    const result = await sendMail({}, s.deps);
    assert.equal(result.accepted, 1); assert.equal(s.sent.length, 2);
    assert.equal(s.sent[0].message.messageId, s.sent[1].message.messageId);
    assert.equal(s.sent[0].message.html, s.sent[1].message.html);
    assert.equal(fs.readFileSync(result.journalPath, 'utf8').includes('secret-a'), false);
    const f = setup(t); const ff = f.deps.createTransport;
    f.deps.createTransport = config => { const transport = ff(config); transport.sendMail = async () => { throw { code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' }; }; return transport; };
    const rejected = await sendMail({}, f.deps);
    assert.equal(rejected.rejected, 4);
    assert.equal(JSON.parse(fs.readFileSync(rejected.journalPath)).jobs.every(job => job.attempts === 1), true);
});
test('DATA timeout and missing acceptance are uncertain without automatic retry', async t => {
    const s = setup(t); const factory = s.deps.createTransport;
    s.deps.createTransport = config => { const transport = factory(config); transport.sendMail = async () => { throw { code: 'ETIMEDOUT', command: 'DATA' }; }; return transport; };
    const result = await sendMail({}, s.deps);
    assert.equal(result.uncertain, 4);
    await sendMail({ resume: result.journalPath }, s.deps);
    assert.equal(s.transports.length, 2);
    assert.equal(classify({ code: 'ESOCKET' }).status, 'uncertain');
    assert.equal(classify({ code: 'ETIMEDOUT', command: 'CONN' }).status, 'uncertain');
    assert.equal(classify({ responseCode: 450, command: 'DATA' }).retry, true);
    const f = setup(t); const ff = f.deps.createTransport;
    f.deps.createTransport = config => { const transport = ff(config); transport.sendMail = async () => ({ accepted: [], rejected: [] }); return transport; };
    assert.equal((await sendMail({}, f.deps)).uncertain, 4);
});
test('accepted empty / rejected list is rejected, not counted accepted', async t => {
    const s = setup(t); const factory = s.deps.createTransport;
    s.deps.createTransport = config => { const transport = factory(config); transport.sendMail = async message => ({ accepted: [], rejected: [message.to] }); return transport; };
    assert.equal((await sendMail({}, s.deps)).rejected, 4);
});
test('signal stops new dispatch; resume honors suppression and skips interrupted in-flight', async t => {
    const s = setup(t); const factory = s.deps.createTransport;
    s.deps.createTransport = config => { const transport = factory(config); const send = transport.sendMail.bind(transport); transport.sendMail = async message => { s.signals.emit('SIGINT'); return send(message); }; return transport; };
    const result = await sendMail({}, s.deps);
    assert.equal(result.accepted, 1); assert.equal(result.pending, 3);
    const data = JSON.parse(fs.readFileSync(result.journalPath));
    data.jobs[1].status = 'in_flight'; atomicWrite(result.journalPath, JSON.stringify(data));
    fs.writeFileSync(s.file('lists/suppressed.txt'), 'carol@example.com\n');
    s.deps.createTransport = factory;
    const resumed = await sendMail({ resume: result.journalPath }, s.deps);
    assert.equal(resumed.accepted, 2); assert.equal(resumed.uncertain, 1); assert.equal(resumed.suppressed, 1);
    assert.equal(s.sent.length, 2);
});
test('auto-remove is atomic and idempotent on resume; comments preserved', async t => {
    const s = setup(t, { REMOVE_SENT_EMAIL_FROM_LIST: 'true' });
    fs.appendFileSync(s.file('lists/emails.txt'), '# keep comment\nalice+tag@example.com\n');
    const result = await sendMail({}, s.deps);
    assert.equal(fs.readFileSync(s.file('lists/emails.txt'), 'utf8').trim(), '# keep comment');
    await sendMail({ resume: result.journalPath }, s.deps);
    assert.equal(fs.readFileSync(s.file('lists/emails.txt'), 'utf8').trim(), '# keep comment');
    assert.equal(s.sent.length, 4);
});
test('journal persistence failure after SMTP acceptance stops dispatch without retry', async t => {
    const s = setup(t); const factory = s.deps.createTransport;
    let originalSave = Journal.prototype.save;
    t.after(() => { Journal.prototype.save = originalSave; });
    s.deps.createTransport = config => {
        const transport = factory(config), send = transport.sendMail.bind(transport);
        transport.sendMail = async message => { const info = await send(message); Journal.prototype.save = () => { throw new Error('disk full'); }; return info; };
        return transport;
    };
    await assert.rejects(sendMail({}, s.deps), /checkpoint/);
    assert.equal(s.sent.length, 1);
    assert.equal(s.transports.every(item => item.closed), true);
    Journal.prototype.save = originalSave;
    const journalPath = path.join(s.file('logs/campaigns'), fs.readdirSync(s.file('logs/campaigns')).find(name => name.endsWith('.json')));
    const data = JSON.parse(fs.readFileSync(journalPath));
    assert.equal(data.jobs[0].status, 'in_flight');
    const j = new Journal(journalPath); assert.equal(j.data.jobs[0].status, 'uncertain'); j.close();
});
test('journal lock prevents concurrent resume; list lock prevents concurrent campaigns', async t => {
    const s = setup(t);
    fs.writeFileSync(s.file('lists/emails.txt.beon.lock'), 'locked');
    await assert.rejects(sendMail({}, s.deps), /terkunci/);
    assert.equal(s.transports.length, 0);
});
test('global and per-server concurrency limits and rate windows hold', async t => {
    const s = setup(t, { ENABLE_BATCH_SENDING: 'true', BATCH_SIZE: '10', MAX_CONCURRENCY: '2', SMTP_MAX_CONNECTIONS: '1', SMTP_RATE_LIMIT: '1', SMTP_RATE_DELTA_MS: '80' });
    let active = 0, peak = 0; const perHost = new Map(), starts = new Map(); const factory = s.deps.createTransport;
    s.deps.createTransport = config => {
        const transport = factory(config), send = transport.sendMail.bind(transport);
        transport.sendMail = async message => {
            active++; peak = Math.max(peak, active);
            perHost.set(config.host, (perHost.get(config.host) || 0) + 1);
            assert.equal(perHost.get(config.host), 1);
            const previous = starts.get(config.host);
            if (previous) assert.ok(Date.now() - previous >= 75);
            starts.set(config.host, Date.now());
            await new Promise(resolve => setTimeout(resolve, 15));
            try { return await send(message); } finally { active--; perHost.set(config.host, perHost.get(config.host) - 1); }
        }; return transport;
    };
    assert.equal((await sendMail({}, s.deps)).accepted, 4); assert.equal(peak, 2);
});
test('TLS options require STARTTLS, verify certificates and disable hidden pool requeue', t => {
    const s = setup(t); const config = loadConfig(s.env, {}, s.root);
    const transport = transportOptions(config.servers[0], config);
    assert.equal(transport.requireTLS, true); assert.equal(transport.tls.rejectUnauthorized, true);
    assert.equal(transport.maxRequeues, 0); assert.equal(transport.debug, false);
    assert.equal(transport.tls.servername, 'smtp.a.example');
});
test('CLI flags reject invalid combinations', () => {
    assert.deepEqual(argumentsFrom(['--dry-run', '--list', 'list.txt']), { dryRun: true, emailListPath: 'list.txt' });
    assert.throws(() => argumentsFrom(['--resume']), /path/);
    assert.throws(() => argumentsFrom(['--preview', 'foo']), /dry-run/);
    assert.throws(() => argumentsFrom(['--list', 'a', '--resume', 'b']), /jangan/);
});
test('auxiliary log failure preserves accepted checkpoint and stops new jobs', async t => {
    const s = setup(t, { ENABLE_FILE_LOGGING: 'true', LOG_DIR: 'blocked-log' });
    fs.writeFileSync(s.file('blocked-log'), 'not a directory');
    await assert.rejects(sendMail({}, s.deps), /Log tambahan/);
    assert.equal(s.sent.length, 1);
    const directory = s.file('logs/campaigns');
    const journalPath = path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.json')));
    const data = JSON.parse(fs.readFileSync(journalPath));
    assert.equal(data.jobs[0].status, 'accepted');
    const result = await sendMail({ resume: journalPath }, { ...s.deps, env: { ...s.env, ENABLE_FILE_LOGGING: 'false' } });
    assert.equal(result.accepted, 4); assert.equal(s.sent.length, 4);
});
test('cleanup intent recovers a crash before list rename without resending', async t => {
    const s = setup(t, { REMOVE_SENT_EMAIL_FROM_LIST: 'true' });
    const before = fs.readFileSync(s.file('lists/emails.txt'), 'utf8');
    const result = await sendMail({}, s.deps);
    const after = fs.readFileSync(s.file('lists/emails.txt'), 'utf8');
    // Simulate power loss after journal cleanup intent, before list rename.
    fs.writeFileSync(s.file('lists/emails.txt'), before);
    const resumed = await sendMail({ resume: result.journalPath }, s.deps);
    assert.equal(resumed.accepted, 4); assert.equal(s.sent.length, 4);
    assert.equal(fs.readFileSync(s.file('lists/emails.txt'), 'utf8'), after);
});
test('failed duplicate occurrence prevents removing that address from the list', async t => {
    const s = setup(t, { REMOVE_SENT_EMAIL_FROM_LIST: 'true', REMOVE_DUPLICATE_EMAILS: 'false' });
    fs.writeFileSync(s.file('lists/emails.txt'), 'alice@example.com\nalice@example.com\n');
    let count = 0; const factory = s.deps.createTransport;
    s.deps.createTransport = config => { const transport = factory(config), send = transport.sendMail.bind(transport); transport.sendMail = async message => {
        count++; if (count === 2) throw { responseCode: 550, command: 'RCPT TO' }; return send(message);
    }; return transport; };
    const result = await sendMail({}, s.deps);
    assert.equal(result.accepted, 1); assert.equal(result.rejected, 1);
    assert.equal(fs.readFileSync(s.file('lists/emails.txt'), 'utf8'), 'alice@example.com\nalice@example.com\n');
});
test('unsubscribe ON adds footer/header; OFF removes HTML/text block and ignores URL', t => {
    const s = setup(t);
    const config = loadConfig(s.env, {}, s.root);
    const letter = '<p>Promo</p><!-- unsubscribe:start --><p>Berhenti: <a href="{unsubscribe_link}">Unsubscribe</a></p><!-- unsubscribe:end -->';
    const text = 'Promo\n<!-- unsubscribe:start -->Berhenti: {unsubscribe_link}<!-- unsubscribe:end -->';
    const on = buildMessage({ ...config, letter, text, unsubscribe: 'https://example.com/unsubscribe?email={email_penerima}' }, 'alice+tag@example.com', 'from@example.com');
    assert.match(on.html, /Unsubscribe/);
    assert.match(on.text, /Berhenti:/);
    assert.equal(on.list.unsubscribe.url, 'https://example.com/unsubscribe?email=alice%2Btag%40example.com');
    const off = buildMessage({ ...config, letter, text, enableUnsubscribe: false, unsubscribe: 'invalid ignored while off' }, 'alice@example.com', 'from@example.com');
    assert.equal(off.html, '<p>Promo</p>');
    assert.equal(off.text, 'Promo\n');
    assert.equal(off.list, undefined);
    assert.throws(() => buildMessage({ ...config, letter }, 'a@example.com', 'f@example.com'), /UNSUBSCRIBE_URL_TEMPLATE/);
    assert.throws(() => buildMessage({ ...config, letter: '{unsubscribe_link}', enableUnsubscribe: false }, 'a@example.com', 'f@example.com'), /bungkus/);
    assert.throws(() => buildMessage({ ...config, letter: '<!-- unsubscribe:start -->' }, 'a@example.com', 'f@example.com'), /berpasangan/);
    assert.throws(() => loadConfig({ ...s.env, ENABLE_UNSUBSCRIBE: 'yes' }, {}, s.root), /true atau false/);
});
test('unsubscribe OFF keeps suppression active and Ashland renders without unsubscribe URL', async t => {
    const s = setup(t, { ENABLE_UNSUBSCRIBE: 'false', LETTER_PATH: 'letters/ashland-promo.html', PROMO_END_DATE: '2026-12-31' });
    fs.copyFileSync(path.resolve(__dirname, '../letters/ashland-promo.html'), s.file('letters/ashland-promo.html'));
    fs.writeFileSync(s.file('lists/suppressed.txt'), 'bob@example.com\n');
    const result = await sendMail({}, s.deps);
    assert.equal(result.accepted, 3);
    assert.ok(s.sent.every(({ message }) => !message.list && !message.html.includes('配信停止') && !message.text.includes('配信停止')));
    assert.ok(s.sent.every(({ message }) => message.to !== 'bob@example.com'));
});
test('Reply-To supports single/global and per-server CSV override, empty uses From', async t => {
    const s = setup(t, { REPLY_TO: 'support@example.com' });
    fs.writeFileSync(s.file('smtp/servers.csv'), 'host,port,user,pass,secure,id,reply_to\nsmtp.a.example,587,from@a.example,p,false,a,team@a.example\nsmtp.b.example,465,from@b.example,p,true,b,\n');
    const preview = await sendMail({ dryRun: true }, s.deps);
    assert.equal(preview.message.replyTo, 'team@a.example');
    await sendMail({}, s.deps);
    assert.deepEqual(s.sent.map(({ message }) => message.replyTo), ['team@a.example', 'support@example.com', 'team@a.example', 'support@example.com']);
    const single = loadConfig({ SMTP_MODE: 'single', SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'from@example.com', SMTP_PASS: 'p', REPLY_TO: 'support@example.com' }, {}, s.root);
    assert.equal(single.servers[0].replyTo, 'support@example.com');
    assert.equal(buildMessage(single, 'alice@example.com', 'from@example.com').replyTo, undefined);
    await assert.rejects(sendMail({}, { ...s.deps, env: { ...s.env, REPLY_TO: 'a@example.com\r\nBcc: victim@example.com' } }), /REPLY_TO/);
    fs.writeFileSync(s.file('smtp/servers.csv'), 'host,port,user,pass,secure,reply_to\nsmtp.a.example,587,from@a.example,p,false,invalid\n');
    await assert.rejects(sendMail({}, s.deps), /reply_to/);
});
test('Reply-To is selected from healthy first server and preserved across failover/resume', async t => {
    const s = setup(t);
    fs.writeFileSync(s.file('lists/emails.txt'), 'alice@example.com\n');
    fs.writeFileSync(s.file('smtp/servers.csv'), 'host,port,user,pass,secure,id,reply_to\nsmtp.a.example,587,from@a.example,p,false,a,team@a.example\nsmtp.b.example,465,from@b.example,p,true,b,team@b.example\n');
    const factory = s.deps.createTransport;
    s.deps.createTransport = config => {
        const transport = factory(config), send = transport.sendMail.bind(transport);
        transport.sendMail = async message => { const info = await send(message); if (config.host === 'smtp.a.example') { s.signals.emit('SIGINT'); throw { responseCode: 451, command: 'RCPT TO' }; } return info; };
        return transport;
    };
    const result = await sendMail({}, s.deps);
    assert.equal(result.pending, 1);
    s.env.REPLY_TO = 'new@example.com';
    s.deps.createTransport = config => { const transport = factory(config); if (config.host === 'smtp.a.example') transport.verify = async () => { throw { code: 'EAUTH' }; }; return transport; };
    assert.equal((await sendMail({ resume: result.journalPath }, s.deps)).accepted, 1);
    assert.equal(s.sent[1].message.from.address, 'from@b.example');
    assert.equal(s.sent[1].message.replyTo, 'team@a.example');
    const fresh = await sendMail({}, s.deps);
    assert.equal(fresh.accepted, 1);
    assert.equal(s.sent[2].message.replyTo, 'team@b.example');
});
