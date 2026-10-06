const crypto = require('node:crypto');
const { faker } = require('@faker-js/faker');
const { email } = require('./config');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const pick = items => items.length ? items[crypto.randomInt(items.length)] : '';
const tokens = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
function render(template, context, kind = 'text', cache = new Map()) {
    return template.replace(tokens, (match, token) => {
        let value;
        if (Object.hasOwn(context, token)) value = context[token];
        else {
            if (!cache.has(token)) {
                const pattern = /^(lowercase|uppercase|numeric|mixed|mixedupper)_(\d+)$/.exec(token);
                if (token === 'generateid') cache.set(token, crypto.randomUUID());
                else if (pattern) {
                    const count = Number(pattern[2]);
                    if (count < 1 || count > 1024) throw new Error(`Panjang placeholder invalid: ${token}`);
                    const lower = 'abcdefghijklmnopqrstuvwxyz', upper = lower.toUpperCase(), digits = '0123456789';
                    const chars = { lowercase: lower, uppercase: upper, numeric: digits, mixed: lower + upper + digits, mixedupper: upper + digits }[pattern[1]];
                    cache.set(token, Array.from({ length: count }, () => chars[crypto.randomInt(chars.length)]).join(''));
                } else throw new Error(`Placeholder tidak dikenal: ${token}`);
            }
            value = cache.get(token);
        }
        return kind === 'html' ? escapeHtml(value) : kind === 'url' ? encodeURIComponent(value) : String(value);
    });
}
function httpUrl(value) {
    try {
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /[\r\n]/.test(value)) throw new Error();
        return url.href;
    } catch { throw new Error('Link harus URL HTTP/HTTPS valid tanpa kredensial'); }
}
function plainText(html) {
    return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
        .replace(/<\/(?:p|h[1-6]|tr|div)>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
}
function buildMessage(config, target, fromEmail, replyTo = '') {
    if (!email(target) || !email(fromEmail)) throw new Error('Alamat penerima/From invalid');
    if (replyTo && !email(replyTo)) throw new Error('Reply-To invalid');
    const enableUnsubscribe = config.enableUnsubscribe !== false;
    // Wrap the complete footer sentence/block so OFF never leaves an empty link.
    const conditional = template => {
        const start = '<!-- unsubscribe:start -->', end = '<!-- unsubscribe:end -->';
        let inside = false, output = '';
        for (const part of template.split(/(<!-- unsubscribe:start -->|<!-- unsubscribe:end -->)/)) {
            if (part === start) {
                if (inside) throw new Error('Blok unsubscribe tidak boleh nested');
                inside = true;
            } else if (part === end) {
                if (!inside) throw new Error('Marker unsubscribe tidak berpasangan');
                inside = false;
            } else if (!inside || enableUnsubscribe) output += part;
        }
        if (inside) throw new Error('Marker unsubscribe tidak berpasangan');
        if (!enableUnsubscribe && output.includes('{unsubscribe_link}')) {
            throw new Error('Saat unsubscribe OFF, bungkus bagian unsubscribe dengan <!-- unsubscribe:start --> dan <!-- unsubscribe:end -->');
        }
        return output;
    };
    const letter = conditional(config.letter), text = conditional(config.text);
    const cache = new Map();
    const context = {
        email_penerima: target, nama_penerima: target.split('@')[0].replace(/[._0-9]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        tanggal: new Date().toLocaleDateString(config.locale, { dateStyle: 'full', timeZone: config.timezone }),
        tanggal_akhir_promo: config.promoEnd, negara: pick(config.countries), perangkat: pick(config.devices),
        email_acak: faker.internet.email(), nama_acak: faker.person.fullName(),
    };
    context.nama_pengirim = render(config.sender, context, 'text', cache);
    const linkTemplate = pick(config.links);
    if (!linkTemplate && (letter + text).includes('{shortlink}')) throw new Error('links/links.txt kosong tetapi template membutuhkan shortlink');
    context.shortlink = linkTemplate ? httpUrl(render(linkTemplate, context, 'url', cache)) : '';
    if (enableUnsubscribe && (letter + text).includes('{unsubscribe_link}') && !config.unsubscribe) {
        throw new Error('UNSUBSCRIBE_URL_TEMPLATE wajib diisi untuk template ini (endpoint unsubscribe tersendiri)');
    }
    context.unsubscribe_link = enableUnsubscribe && config.unsubscribe ? httpUrl(render(config.unsubscribe, context, 'url', cache)) : '';
    if (context.unsubscribe_link && context.unsubscribe_link === context.shortlink) throw new Error('URL unsubscribe harus berbeda dari link promo');
    if ((letter + text).includes('{tanggal_akhir_promo}') && !config.promoEnd) throw new Error('PROMO_END_DATE wajib diisi untuk template promo');
    const subject = render(config.subject, context, 'text', cache);
    if (/[\r\n]/.test(subject + context.nama_pengirim)) throw new Error('Nama pengirim/subject tidak boleh multiline');
    const html = render(letter, context, 'html', cache);
    const message = {
        from: { name: context.nama_pengirim, address: fromEmail }, to: target, subject, html,
        text: config.text ? render(text, context, 'text', cache) : plainText(html),
        messageId: `<${crypto.randomUUID()}@${fromEmail.split('@')[1]}>`,
        headers: config.minimalHeaders ? {} : { 'X-Priority': { high: '1 (Highest)', normal: '3 (Normal)', low: '5 (Lowest)' }[config.priority] },
        disableFileAccess: true, disableUrlAccess: true,
    };
    if (replyTo) message.replyTo = replyTo;
    if (context.unsubscribe_link) message.list = { unsubscribe: { url: context.unsubscribe_link } };
    return message;
}
module.exports = { buildMessage, render, escapeHtml, httpUrl, plainText };
