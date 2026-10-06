const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig, read } = require('./src/config');
const { buildMessage } = require('./src/template');
const { Journal, atomicWrite, validate } = require('./src/journal');
const { Registry, classify, errorDetails, wait } = require('./src/smtp');

function summary(jobs) {
    const result = { accepted: 0, rejected: 0, uncertain: 0, pending: 0, suppressed: 0 };
    for (const job of jobs) result[job.status === 'in_flight' ? 'uncertain' : job.status]++;
    return result;
}
function removeAccepted(file, expected, jobs) {
    if (read(file) !== expected) throw new Error('Daftar penerima berubah selama pengiriman; auto-remove dibatalkan. Journal tetap tersimpan.');
    // Remove an address only when all its occurrences in this campaign are accepted.
    const accepted = new Set(jobs.filter(job => job.status === 'accepted').map(job => job.email));
    for (const job of jobs) if (job.status !== 'accepted') accepted.delete(job.email);
    const remaining = expected.split(/\r?\n/).filter(line => {
        const value = line.trim();
        if (!value || value.startsWith('#')) return true;
        const [local, domain] = value.split('@');
        const canonical = `${local}@${domain?.toLowerCase()}`;
        return !accepted.has(canonical);
    });
    return remaining.join('\n');
}
async function sendMail(options = {}, dependencies = {}) {
    const config = loadConfig(dependencies.env || process.env, options, dependencies.root);
    const log = dependencies.log || console.log;
    if (options.dryRun) {
        const resumed = options.resume ? JSON.parse(read(path.resolve(config.root, options.resume))) : null;
        if (resumed) validate(resumed);
        const recipients = resumed ? resumed.jobs.filter(job => job.status === 'pending').map(job => job.email) : config.recipients;
        const target = recipients.find(item => !config.suppressed.has(item));
        if (!target) throw new Error('Tidak ada penerima untuk preview');
        const message = resumed ? resumed.jobs.find(job => job.email === target && job.status === 'pending').message : buildMessage(config, target, config.servers[0].fromEmail, config.servers[0].replyTo);
        // Validate every recipient/template before reporting a valid preview.
        if (!options.resume) for (const recipient of recipients.slice(1)) buildMessage(config, recipient, config.servers[0].fromEmail, config.servers[0].replyTo);
        const previewPath = path.resolve(config.root, options.previewPath || 'logs/preview.html');
        fs.mkdirSync(path.dirname(previewPath), { recursive: true, mode: 0o700 });
        atomicWrite(previewPath, message.html);
        atomicWrite(`${previewPath}.json`, JSON.stringify(message, null, 2) + '\n');
        log(`Preview: ${previewPath}\nSubject: ${message.subject}\nPenerima: ${recipients.length}; suppression: ${config.suppressedCount}`);
        return { dryRun: true, previewPath, message };
    }
    const control = { stopped: false };
    const onSignal = () => { control.stopped = true; log('Menghentikan dispatch baru; menunggu pengiriman aktif. Gunakan --resume untuk melanjutkan.'); };
    const signals = dependencies.signals || process;
    signals.on('SIGINT', onSignal); signals.on('SIGTERM', onSignal);
    let journal, registry, listLockFd, listLock, originalList;
    let fatal;
    try {
        const resumePath = options.resume ? path.resolve(config.root, options.resume) : null;
        const id = crypto.randomUUID();
        const journalPath = resumePath || path.join(config.journalDir, `${id}.json`);
        fs.mkdirSync(path.dirname(journalPath), { recursive: true, mode: 0o700 });
        const existing = resumePath ? JSON.parse(read(resumePath)) : null;
        const listPath = existing?.listPath || config.listPath;
        originalList = read(listPath);
        listLock = `${listPath}.beon.lock`;
        try { listLockFd = fs.openSync(listLock, 'wx', 0o600); }
        catch { throw new Error(`Daftar sedang terkunci: ${listLock}. Pastikan proses lama berhenti sebelum menghapus lock stale.`); }
        fs.writeFileSync(listLockFd, JSON.stringify({ pid: process.pid, hostname: require('node:os').hostname() }));
        const data = existing || {
            version: 1, id, createdAt: new Date().toISOString(), listPath,
            jobs: config.recipients.map((target, i) => ({
                id: `${id}-${i}`, email: target, status: 'pending', attempts: 0,
                message: buildMessage(config, target, config.servers[0].fromEmail, config.servers[0].replyTo), history: [],
            })),
        };
        journal = new Journal(journalPath, data);
        // Reconcile a crash between the durable cleanup intent and list rename.
        const hash = value => crypto.createHash('sha256').update(value).digest('hex');
        if (journal.data.listCleanup) {
            const cleanup = journal.data.listCleanup;
            if (hash(originalList) === cleanup.beforeHash) {
                atomicWrite(listPath, cleanup.after);
                originalList = cleanup.after;
            } else if (hash(originalList) !== hash(cleanup.after)) {
                throw new Error('Daftar berubah setelah rencana auto-remove; periksa journal sebelum resume.');
            }
        }
        for (const job of journal.data.jobs) if (job.status === 'pending' && config.suppressed.has(job.email)) job.status = 'suppressed';
        journal.save();
        log(`Journal: ${journalPath}\nPenerima: ${journal.data.jobs.length}; suppression baru: ${config.suppressedCount}`);
        if (config.debug) log('DEBUG_MODE: diagnostik status aktif; raw SMTP traffic dinonaktifkan agar kredensial/konten tidak tercetak.');
        const pending = journal.data.jobs.filter(job => job.status === 'pending');
        if (pending.length) {
            registry = new Registry(config, control, dependencies.createTransport, log);
            await registry.verify();
        }
        const persist = () => {
            try { journal.save(); }
            catch { control.stopped = true; throw new Error(`Gagal menyimpan checkpoint ${journalPath}. Dispatch dihentikan; periksa accepted/uncertain sebelum melanjutkan.`); }
        };
        function logResult(job) {
            log(`${job.status.toUpperCase()} ${job.email} | SMTP ${job.smtpId || '-'} | attempt ${job.attempts}`);
            if (!config.logging) return;
            try {
                fs.mkdirSync(config.logDir, { recursive: true, mode: 0o700 });
                const file = path.join(config.logDir, `${job.status}-${journal.data.id}.txt`);
                fs.appendFileSync(file, `${JSON.stringify({ time: new Date().toISOString(), email: job.email, smtpId: job.smtpId, messageId: job.message.messageId, result: job.result })}\n`, { mode: 0o600 });
            } catch { control.stopped = true; throw new Error('Log tambahan gagal ditulis; hasil SMTP tersimpan dalam journal. Dispatch dihentikan.'); }
        }
        async function dispatch(job) {
            while (!control.stopped) {
                if (job.attempts >= config.retries + 1) { job.status = 'rejected'; persist(); logResult(job); return; }
                const entry = await registry.acquire();
                if (!entry) return;
                try {
                    if (control.stopped) return;
                    const previousFrom = job.message.from.address;
                    job.message.from.address = entry.server.fromEmail;
                    // Bind reply routing to the first actual server; failover/resume keeps it stable.
                    if (job.attempts === 0) {
                        if (entry.server.replyTo) job.message.replyTo = entry.server.replyTo;
                        else delete job.message.replyTo;
                    }
                    job.smtpId = entry.server.id; job.attempts++; job.status = 'in_flight';
                    job.history.push({ time: new Date().toISOString(), attempt: job.attempts, smtpId: job.smtpId, from: job.message.from.address, replyTo: job.message.replyTo || null });
                    if (previousFrom !== job.message.from.address) log(`From ${job.email}: ${previousFrom} → ${job.message.from.address} (${job.smtpId})`);
                    persist(); // Must be durable before starting SMTP I/O.
                    let outcome;
                    try {
                        // Whitelist persisted message fields: never allow raw/attachments from a journal.
                        const message = job.message;
                        const info = await entry.transport.sendMail({
                            from: message.from, to: job.email, subject: message.subject, html: message.html, text: message.text,
                            messageId: message.messageId,
                            replyTo: message.replyTo,
                            headers: message.headers?.['X-Priority'] ? { 'X-Priority': String(message.headers['X-Priority']).replace(/[\r\n]/g, '') } : {},
                            list: message.list?.unsubscribe?.url ? { unsubscribe: { url: message.list.unsubscribe.url } } : undefined,
                            disableFileAccess: true, disableUrlAccess: true,
                        });
                        const accepted = (info.accepted || []).map(value => typeof value === 'string' ? value : value.address);
                        const rejected = (info.rejected || []).map(value => typeof value === 'string' ? value : value.address);
                        job.result = { ...errorDetails({ response: info.response }, config.servers), accepted, rejected, messageId: info.messageId || message.messageId };
                        job.status = accepted.includes(job.email) ? 'accepted' : rejected.includes(job.email) ? 'rejected' : 'uncertain';
                        outcome = { retry: false };
                    } catch (error) {
                        outcome = classify(error);
                        job.status = outcome.status;
                        job.result = errorDetails(error, config.servers);
                        if (outcome.disable) entry.healthy = false;
                        if (outcome.retry) entry.cooldownUntil = Date.now() + config.cooldown;
                    }
                    const retry = outcome.retry && job.attempts < config.retries + 1;
                    if (retry) job.status = 'pending';
                    job.history.at(-1).status = job.status;
                    job.history.at(-1).result = job.result;
                    persist(); // Logging errors must never be treated as SMTP failures/retried.
                    if (!retry) { logResult(job); return; }
                } finally { registry.release(entry); }
                await wait(Math.min(config.retryDelay * 2 ** (job.attempts - 1), 3600000), control);
            }
        }
        const chunkSize = config.batch ? config.batchSize : 1;
        for (let start = 0; start < pending.length && !control.stopped; start += chunkSize) {
            const chunk = pending.slice(start, start + chunkSize);
            let cursor = 0;
            const outcomes = await Promise.allSettled(Array.from({ length: Math.min(config.concurrency, chunk.length) }, async () => {
                while (!control.stopped && cursor < chunk.length) {
                    const job = chunk[cursor++];
                    try { await dispatch(job); }
                    catch (error) { control.stopped = true; throw error; }
                }
            }));
            const rejected = outcomes.find(result => result.status === 'rejected');
            if (rejected) { fatal = rejected.reason; break; }
            if (start + chunkSize < pending.length) await wait(config.delay, control);
        }
        if (config.removeSent && !fatal && journal.data.jobs.some(job => job.status === 'accepted')) {
            const after = removeAccepted(listPath, originalList, journal.data.jobs);
            journal.data.listCleanup = { beforeHash: hash(originalList), after };
            persist();
            atomicWrite(listPath, after);
        }
        const result = { ...summary(journal.data.jobs), journalPath, interrupted: control.stopped };
        log(`Ringkasan: SMTP accepted=${result.accepted}, rejected=${result.rejected}, uncertain=${result.uncertain}, pending=${result.pending}, suppressed=${result.suppressed}`);
        if (fatal) throw fatal;
        return result;
    } finally {
        if (registry) registry.close();
        if (journal) journal.close();
        if (listLockFd !== undefined) { fs.closeSync(listLockFd); fs.unlinkSync(listLock); }
        signals.removeListener('SIGINT', onSignal); signals.removeListener('SIGTERM', onSignal);
    }
}
module.exports = { sendMail, removeAccepted, summary };
