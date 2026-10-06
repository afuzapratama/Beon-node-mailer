const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { email } = require('./config');
function atomicWrite(file, content) {
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    let fd;
    try {
        fd = fs.openSync(tmp, 'wx', 0o600);
        fs.writeFileSync(fd, content);
        fs.fsyncSync(fd);
        fs.closeSync(fd); fd = undefined;
        fs.renameSync(tmp, file);
        const dir = fs.openSync(path.dirname(file), 'r');
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
}
function validate(data) {
    const statuses = ['pending', 'in_flight', 'accepted', 'rejected', 'uncertain', 'suppressed'];
    if (data.version !== 1 || !Array.isArray(data.jobs) || typeof data.listPath !== 'string') throw new Error('Format journal invalid');
    const ids = new Set();
    for (const job of data.jobs) {
        if (!email(job.email) || !statuses.includes(job.status) || ids.has(job.id) || !Number.isInteger(job.attempts) || job.attempts < 0 ||
            !job.message || job.message.to !== job.email || !email(job.message.from?.address) ||
            typeof job.message.html !== 'string' || typeof job.message.subject !== 'string' || typeof job.message.text !== 'string' ||
            typeof job.message.messageId !== 'string' || /[\r\n]/.test(job.message.subject + job.message.messageId + job.message.from.name) ||
            !Array.isArray(job.history) || typeof job.id !== 'string') throw new Error('Pekerjaan journal invalid');
        if (job.message.list?.unsubscribe?.url) require('./template').httpUrl(job.message.list.unsubscribe.url);
        if (job.message.replyTo !== undefined && !email(job.message.replyTo)) throw new Error('Reply-To journal invalid');
        ids.add(job.id);
    }
}
class Journal {
    constructor(file, data) {
        this.file = file;
        this.lock = `${file}.lock`;
        try { this.lockFd = fs.openSync(this.lock, 'wx', 0o600); }
        catch { throw new Error(`Journal terkunci: ${this.lock}. Pastikan proses lama berhenti sebelum menghapus lock stale.`); }
        try {
            fs.writeFileSync(this.lockFd, JSON.stringify({ pid: process.pid, hostname: require('node:os').hostname() }));
            this.data = data || JSON.parse(fs.readFileSync(file, 'utf8'));
            validate(this.data);
            for (const job of this.data.jobs) if (job.status === 'in_flight') job.status = 'uncertain';
            this.save();
        } catch (error) { this.close(); throw error; }
    }
    save() { atomicWrite(this.file, JSON.stringify(this.data, null, 2) + '\n'); }
    close() {
        if (this.lockFd !== undefined) { fs.closeSync(this.lockFd); this.lockFd = undefined; fs.unlinkSync(this.lock); }
    }
}
module.exports = { Journal, atomicWrite, validate };
