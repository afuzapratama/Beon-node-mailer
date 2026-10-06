const nodemailer = require('nodemailer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function transportOptions(server, config) {
    return {
        host: server.host, port: server.port, secure: server.secure, requireTLS: server.requireTLS,
        auth: { user: server.user, pass: server.pass }, name: config.ehlo,
        tls: { rejectUnauthorized: server.rejectUnauthorized, servername: server.servername, ...(server.ca ? { ca: server.ca } : {}) },
        pool: true, maxConnections: server.maxConnections, maxMessages: 100, maxRequeues: 0,
        connectionTimeout: config.connectionTimeout, greetingTimeout: config.greetingTimeout, socketTimeout: config.socketTimeout,
        logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
    };
}
function errorDetails(error, servers) {
    // Retain diagnostics without serializing errors/raw SMTP traffic (which may contain credentials).
    let response = typeof error.response === 'string' ? error.response : '';
    for (const server of servers) {
        for (const secret of [server.pass, Buffer.from(server.pass).toString('base64'), Buffer.from(`\0${server.user}\0${server.pass}`).toString('base64')]) {
            if (secret) response = response.split(secret).join('[REDACTED]');
        }
    }
    return {
        code: /^[A-Z0-9_]{1,40}$/.test(error.code || '') ? error.code : 'UNKNOWN',
        responseCode: Number.isInteger(error.responseCode) ? error.responseCode : null,
        command: String(error.command || '').replace(/[^A-Za-z0-9 .-]/g, '').slice(0, 40),
        response: response.replace(/[\r\n]/g, ' ').slice(0, 1000),
    };
}
function classify(error) {
    const command = String(error.command || '').toUpperCase();
    const code = error.responseCode;
    if (error.code === 'EAUTH' || command.startsWith('AUTH')) return { status: 'rejected', disable: true, retry: true };
    if (code >= 500 && code <= 599) return { status: 'rejected', retry: false };
    if (code >= 400 && code <= 499) return { status: 'rejected', retry: true };
    // A network error with no final DATA response may have been accepted already.
    if (error.code === 'ETLS' || error.syscall === 'connect') return { status: 'rejected', retry: true, disable: error.code === 'ETLS' };
    // Nodemailer also labels socket drops AFTER DATA as CONN. CONN alone is not proof of a safe retry.
    if (['EHLO', 'HELO', 'STARTTLS', 'MAIL FROM', 'RCPT TO'].some(stage => command === stage || command.startsWith(`${stage}:`))) {
        return { status: 'rejected', retry: true, disable: error.code === 'ETLS' };
    }
    if (error.code === 'EDNS') return { status: 'rejected', retry: true };
    return { status: 'uncertain', retry: false };
}
class Registry {
    constructor(config, control, factory = nodemailer.createTransport, log = console.log) {
        this.config = config; this.control = control; this.log = log; this.cursor = 0; this.entries = [];
        // Construct sequentially so partial construction can still be closed by the caller.
        this.factory = factory;
    }
    async verify() {
        for (const server of this.config.servers) this.entries.push({ server, transport: this.factory(transportOptions(server, this.config)), healthy: false, active: 0, starts: [], cooldownUntil: 0 });
        let next = 0;
        const workers = Array.from({ length: Math.min(this.config.verifyConcurrency, this.entries.length) }, async () => {
            while (!this.control.stopped && next < this.entries.length) {
                const entry = this.entries[next++];
                try {
                    await entry.transport.verify(); entry.healthy = true;
                    this.log(`SMTP ${entry.server.id}: siap${entry.server.rejectUnauthorized ? '' : ' (verifikasi sertifikat NONAKTIF)'}${!entry.server.secure && !entry.server.requireTLS ? ' (STARTTLS tidak diwajibkan)' : ''}`);
                } catch (error) {
                    const details = errorDetails(error, this.config.servers);
                    this.log(`SMTP ${entry.server.id}: gagal verify (${details.code}/${details.responseCode || '-'})`);
                }
            }
        });
        await Promise.all(workers);
        if (!this.control.stopped && !this.entries.some(entry => entry.healthy)) throw new Error('Tidak ada SMTP sehat setelah verify');
    }
    async acquire() {
        while (!this.control.stopped) {
            const now = Date.now();
            if (!this.entries.some(entry => entry.healthy)) return null;
            for (let offset = 0; offset < this.entries.length; offset++) {
                const index = (this.cursor + offset) % this.entries.length;
                const entry = this.entries[index];
                entry.starts = entry.starts.filter(time => now - time < entry.server.rateDelta);
                if (entry.healthy && entry.cooldownUntil <= now && entry.active < entry.server.maxConnections && entry.starts.length < entry.server.rateLimit) {
                    entry.active++; entry.starts.push(now); this.cursor = (index + 1) % this.entries.length;
                    return entry;
                }
            }
            await sleep(25);
        }
        return null;
    }
    release(entry) { entry.active--; }
    close() { for (const entry of this.entries) { try { entry.transport.close(); } catch { /* close remaining pools */ } } }
}
async function wait(ms, control) {
    const until = Date.now() + ms;
    while (!control.stopped && Date.now() < until) await sleep(Math.min(100, until - Date.now()));
}
module.exports = { Registry, transportOptions, classify, errorDetails, wait };
