const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const tls = require('node:tls');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { sendMail } = require('../mailer');
async function localServer(t, certificate, { starttls = false, dropAfterData = false } = {}) {
    const sockets = new Set(), received = [];
    const context = tls.createSecureContext(certificate);
    function session(socket, encrypted) {
        sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
        let buffer = '', body = false, content = '';
        const handle = chunk => {
            buffer += chunk.toString();
            while (buffer.includes('\r\n')) {
                const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
                if (body) {
                    if (line === '.') {
                        body = false; received.push(content); content = '';
                        if (dropAfterData) socket.destroy(); else socket.write('250 queued locally\r\n');
                    } else content += `${line}\n`;
                } else if (/^EHLO|^HELO/.test(line)) {
                    socket.write(`250-localhost\r\n${!encrypted ? '250-STARTTLS\r\n' : ''}250 AUTH PLAIN\r\n`);
                } else if (line === 'STARTTLS') {
                    socket.write('220 upgrade\r\n'); socket.removeListener('data', handle);
                    const upgraded = new tls.TLSSocket(socket, { isServer: true, secureContext: context });
                    session(upgraded, true); return;
                } else if (line.startsWith('AUTH PLAIN ')) socket.write('235 authenticated\r\n');
                else if (/^MAIL FROM:|^RCPT TO:|^RSET/.test(line)) socket.write('250 ok\r\n');
                else if (line === 'DATA') { body = true; socket.write('354 send content\r\n'); }
                else if (line === 'QUIT') { socket.end('221 bye\r\n'); }
                else socket.write('500 unsupported\r\n');
            }
        };
        socket.on('data', handle);
    }
    const onConnection = socket => { session(socket, !starttls); socket.write('220 localhost test\r\n'); };
    const server = starttls ? net.createServer(onConnection) : tls.createServer(certificate, onConnection);
    server.on('tlsClientError', () => {});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
    return { port: server.address().port, received };
}
test('actual Nodemailer: verified private CA, implicit TLS and STARTTLS, MIME and resume', { timeout: 15000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beon-smtp-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const keyPath = path.join(root, 'key.pem'), certPath = path.join(root, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
        '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
    const certificate = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    const implicit = await localServer(t, certificate);
    const upgraded = await localServer(t, certificate, { starttls: true });
    const dropped = await localServer(t, certificate, { dropAfterData: true });
    for (const [name, content] of Object.entries({
        'letters/letter.html': '<p>Halo {nama_penerima}</p>', 'data/country.txt': 'Indonesia', 'data/device.txt': 'Desktop',
        'links/links.txt': '', 'lists/emails.txt': 'alice@example.com\nbob@example.com\n', 'lists/suppressed.txt': '',
        'smtp/servers.csv': `host,port,user,pass,secure,id,tls_servername,tls_ca_path\n127.0.0.1,${implicit.port},sender@example.com,dummy,true,tls,localhost,cert.pem\n127.0.0.1,${upgraded.port},sender@example.com,dummy,false,starttls,localhost,cert.pem\n`,
    })) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), content); }
    const env = { SMTP_MODE: 'multiple', SEND_DELAY_SECONDS: '0', ENABLE_FILE_LOGGING: 'false', RETRY_DELAY_SECONDS: '0', SMTP_COOLDOWN_SECONDS: '0', SMTP_SOCKET_TIMEOUT_MS: '1000', SMTP_CONNECTION_TIMEOUT_MS: '1000' };
    const result = await sendMail({}, { root, env, log() {} });
    assert.equal(result.accepted, 2); assert.equal(implicit.received.length, 1); assert.equal(upgraded.received.length, 1);
    assert.match(implicit.received[0], /Content-Type: multipart\/alternative/);
    assert.match(upgraded.received[0], /Message-ID:/i);
    fs.writeFileSync(path.join(root, 'lists/emails.txt'), 'timeout@example.com\n');
    fs.writeFileSync(path.join(root, 'smtp/servers.csv'), `host,port,user,pass,secure,tls_servername,tls_ca_path\n127.0.0.1,${dropped.port},sender@example.com,dummy,true,localhost,cert.pem\n`);
    const uncertain = await sendMail({}, { root, env, log() {} });
    assert.equal(uncertain.uncertain, 1); assert.equal(dropped.received.length, 1);
    await sendMail({ resume: uncertain.journalPath }, { root, env, log() {} });
    assert.equal(dropped.received.length, 1);
    // Without the private CA, verify must fail rather than silently bypassing validation.
    fs.writeFileSync(path.join(root, 'smtp/servers.csv'), `host,port,user,pass,secure,tls_servername\n127.0.0.1,${implicit.port},sender@example.com,dummy,true,localhost\n`);
    await assert.rejects(sendMail({}, { root, env, log() {} }), /Tidak ada SMTP sehat/);
    assert.equal(implicit.received.length, 1);
});
