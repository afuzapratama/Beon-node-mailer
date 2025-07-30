// Import library yang dibutuhkan
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { faker } = require('@faker-js/faker');
const chalk = require('chalk');
const crypto = require('crypto');
const { URL } = require('url');

// Muat variabel dari .env
require('dotenv').config();

// --- Fungsi untuk Tampilan Log ---
function logSuccess(details) {
    const { targetEmail, fromMail, fromName, subject, shortlink, smtpHost, currentIndex, totalEmails, delay } = details;
    let domainOnly = shortlink;
    try { const urlObject = new URL(shortlink); domainOnly = urlObject.hostname; } catch (e) { domainOnly = shortlink; }
    const border = '||' + '='.repeat(75);
    const line = '||' + '-'.repeat(75);
    console.log(chalk.bold.white(border));
    console.log(`${chalk.bold.white('||')} ${chalk.bold.magenta('📨 SEND TO')}         : ${chalk.yellow(targetEmail)}`);
    console.log(`${chalk.bold.white('||')} ${chalk.bold.magenta('📮 FROM MAIL')}        : ${chalk.cyan(fromMail)}`);
    console.log(`${chalk.bold.white('||')} ${chalk.bold.magenta('🧒 FROM NAME')}        : ${chalk.blue(fromName)}`);
    console.log(`${chalk.bold.white('||')} ${chalk.bold.magenta('📝 SUBJECT')}          : ${chalk.cyan(subject)}`);
    console.log(`${chalk.bold.white('||')} ${chalk.bold.magenta('🔗 SHORTLINK')}        : ${chalk.white(domainOnly)}`);
    console.log(chalk.bold.white(line));
    console.log(`${chalk.bold.white('||')} ${chalk.bold.red('💻 SMTP')}             : ${chalk.red(smtpHost)}`);
    console.log(`${chalk.bold.white('||')} ${chalk.bold.red('🛒 TOTAL SEND')}       : ${chalk.red(`${currentIndex} / ${totalEmails}`)}`);
    console.log(`${chalk.bold.white('||')} ${chalk.bold.red('🕥 DELAY')}            : ${chalk.red(`${delay} SEC (Antar Batch)`)}`);
    console.log(chalk.bold.white(border) + '\n');
}

// *** BARU: logError sekarang menerima parameter isDebug ***
function logError(error, targetEmail, isDebug) {
    const border = '||' + '='.repeat(75);
    console.log(chalk.bold.red(border));
    console.log(`${chalk.bold.red('||')} ${chalk.bold.yellow('🔥 ERROR PLEASE CHECK')} `);
    console.log(chalk.bold.red(border));
    console.log(`${chalk.bold.red('||')} ${chalk.white('😭 Target Email:')}     ${chalk.yellow(targetEmail)}`);
    if (error.responseCode) {
        console.log(`${chalk.bold.red('||')} ${chalk.white('😭 SMTP Code:')}        ${chalk.yellow(error.responseCode)}`);
    }
    console.log(`${chalk.bold.red('||')} ${chalk.white('😭 Error Message:')}    ${chalk.yellow(error.message)}`);
    console.log(chalk.bold.red(border));

    // *** BARU: Tampilkan detail error jika debug mode aktif ***
    if (isDebug) {
        console.log(chalk.bold.yellow('\n--- DEBUG STACK TRACE ---'));
        console.error(error);
        console.log(chalk.bold.yellow('-------------------------\n'));
    } else {
        console.log('\n'); // Beri spasi seperti biasa jika tidak debug
    }
}

function processDynamicPlaceholders(text) {
    if (!text) return '';
    const lowercaseChars = 'abcdefghijklmnopqrstuvwxyz';
    const uppercaseChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numericChars = '0123456789';

    return text.replace(/{([a-z]+_?\d*|generateid)}/g, (match, placeholder) => {
        const parts = placeholder.split('_');
        const type = parts[0];
        const length = parseInt(parts[1], 10);

        switch (type) {
            case 'generateid': { return crypto.randomUUID(); }
            case 'lowercase': { if (isNaN(length)) return match; let r = ''; for (let i = 0; i < length; i++) r += lowercaseChars.charAt(Math.floor(Math.random() * lowercaseChars.length)); return r; }
            case 'uppercase': { if (isNaN(length)) return match; let r = ''; for (let i = 0; i < length; i++) r += uppercaseChars.charAt(Math.floor(Math.random() * uppercaseChars.length)); return r; }
            case 'numeric': { if (isNaN(length)) return match; let r = ''; for (let i = 0; i < length; i++) r += numericChars.charAt(Math.floor(Math.random() * numericChars.length)); return r; }
            case 'mixedupper': { if (isNaN(length)) return match; const c = uppercaseChars + numericChars; let r = ''; for (let i = 0; i < length; i++) r += c.charAt(Math.floor(Math.random() * c.length)); return r; }
            case 'mixed': { if (isNaN(length)) return match; const c = lowercaseChars + uppercaseChars + numericChars; let r = ''; for (let i = 0; i < length; i++) r += c.charAt(Math.floor(Math.random() * c.length)); return r; }
            default: { return match; }
        }
    });
}


// --- Helper untuk data acak (Generator) ---
const countries = fs.readFileSync(path.join(__dirname, 'data', 'country.txt'), 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);
const devices = fs.readFileSync(path.join(__dirname, 'data', 'device.txt'), 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);
const linkTemplates = fs.readFileSync(path.join(__dirname, 'links', 'links.txt'), 'utf-8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
const getRandomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

// --- Fungsi Utama Pengiriman Email ---
async function sendMail(options) {
    // --- 1. MEMBACA SEMUA KONFIGURASI DARI .ENV ---
    const debugMode = process.env.DEBUG_MODE === 'true';
    const rawHostnameTemplate = process.env.SMTP_HOSTNAME || 'localhost';

        // *** LOGIKA BARU: Proses hostname di awal sesi ***
    const selectedHostname = processDynamicPlaceholders(rawHostnameTemplate);
    console.log(chalk.blue(`\nHostname untuk sesi ini: ${selectedHostname}`));

    const transporterConfig = {
        pool: true,
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        tls: { rejectUnauthorized: false },
        // Menggunakan hostname yang sudah diacak untuk seluruh sesi
        name: selectedHostname,
    };


    if (debugMode) {
        console.log(chalk.bold.yellow.inverse('\n DEBUG MODE IS ON \n'));
        transporterConfig.logger = true;
        transporterConfig.debug = true;
    }

    const transporter = nodemailer.createTransport(transporterConfig);

    const rawSenderNameTemplate = process.env.SENDER_NAME || 'Pengirim Default';
    const rawSubjectTemplate = process.env.EMAIL_SUBJECT || 'Subjek Default';
    const rawCustomFromTemplate = process.env.CUSTOM_FROM_EMAIL;

    const letterPath = path.join(__dirname, process.env.LETTER_PATH || 'letters/letter.html');
    const rawLetterTemplate = fs.readFileSync(letterPath, 'utf-8');
    const emailPriority = process.env.EMAIL_PRIORITY || 'normal';
    const batchSize = parseInt(process.env.SEND_BATCH_SIZE, 10) || 1;
    const batchDelay = parseInt(process.env.BATCH_DELAY_SECONDS, 10) || 1;
    const removeDuplicates = process.env.REMOVE_DUPLICATE_EMAILS === 'true';
    const removeSentEmails = process.env.REMOVE_SENT_EMAIL_FROM_LIST === 'true';

    // --- 2. PERSIAPAN DAFTAR EMAIL ---
    let allLines = fs.readFileSync(options.emailListPath, 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);
    let emailListToSend;
    if (removeDuplicates) {
        const originalCount = allLines.length;
        emailListToSend = [...new Set(allLines)];
        if (originalCount !== emailListToSend.length) {
            console.log(chalk.blue(`\nMenghapus email duplikat... Asli: ${originalCount}, Unik: ${emailListToSend.length}`));
        }
    } else {
        emailListToSend = allLines;
    }
    
    // --- 3. MEMBUAT BATCH (CHUNK) DARI DAFTAR EMAIL ---
    const emailChunks = [];
    for (let i = 0; i < emailListToSend.length; i += batchSize) {
        emailChunks.push(emailListToSend.slice(i, i + batchSize));
    }

    console.log(chalk.yellow(`\nTotal email akan dikirim: ${emailListToSend.length} dalam ${emailChunks.length} batch.`));
    
    let successCount = 0, failCount = 0, totalSent = 0;
    const successfullySentEmails = new Set();

    // --- 4. PROSES PENGIRIMAN PER BATCH ---
  for (let i = 0; i < emailChunks.length; i++) {
        const chunk = emailChunks[i];
        console.log(chalk.bold.blue(`\n--- Mengirim Batch ${i + 1} dari ${emailChunks.length} (${chunk.length} email) ---`));

        const promises = chunk.map(async (targetEmail) => {
            try {
                const processedSenderName = processDynamicPlaceholders(rawSenderNameTemplate);
                const processedSubject = processDynamicPlaceholders(rawSubjectTemplate);
                const fromEmail = rawCustomFromTemplate ? processDynamicPlaceholders(rawCustomFromTemplate) : process.env.SMTP_USER;
                
                let processedLetter = processDynamicPlaceholders(rawLetterTemplate);
                let finalLink = '#';
                if (linkTemplates.length > 0){
                    const randomLinkTemplate = getRandomItem(linkTemplates);
                    if (randomLinkTemplate) {
                        let processedLink = randomLinkTemplate.replace(/{email_penerima}/g, targetEmail);
                        finalLink = processDynamicPlaceholders(processedLink);
                    }
                }
                
                const recipientName = targetEmail.split('@')[0].replace(/[\._0-9]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                processedLetter = processedLetter
                    .replace(/{email_penerima}/g, targetEmail).replace(/{nama_penerima}/g, recipientName)
                    .replace(/{nama_pengirim}/g, processedSenderName).replace(/{tanggal}/g, new Date().toLocaleDateString('id-ID', { dateStyle: 'full' }))
                    .replace(/{negara}/g, getRandomItem(countries)).replace(/{perangkat}/g, getRandomItem(devices))
                    .replace(/{email_acak}/g, faker.internet.email()).replace(/{nama_acak}/g, faker.person.fullName())
                    .replace(/{shortlink}/g, finalLink);

                // Menggunakan hostname terpilih untuk Message-ID
                const messageId = `<${crypto.randomBytes(16).toString('hex')}@${selectedHostname}>`;
                const priorityMap = { high: '1 (Highest)', normal: '3 (Normal)', low: '5 (Lowest)' };

                const mailOptions = { 
                    from: `"${processedSenderName}" <${fromEmail}>`,
                    to: targetEmail, 
                    subject: processedSubject,
                    html: processedLetter,
                    headers: {
                        'X-Priority': priorityMap[emailPriority] || '3 (Normal)',
                        'X-Mailer': '(Node.js)',
                        'Message-ID': messageId
                    }
                };

                await transporter.sendMail(mailOptions);
                totalSent++;
                logSuccess({
                    targetEmail, fromMail: fromEmail, fromName: processedSenderName, subject: processedSubject, 
                    shortlink: finalLink, smtpHost: process.env.SMTP_HOST,
                    currentIndex: totalSent, totalEmails: emailListToSend.length, delay: batchDelay
                });
                successCount++;
                successfullySentEmails.add(targetEmail);
            } catch (error) {
                totalSent++;
                logError(error, targetEmail, debugMode);
                failCount++;
            }
        });

        await Promise.all(promises);

        if (i < emailChunks.length - 1) {
            console.log(chalk.yellow(`--- Batch ${i + 1} selesai. Jeda selama ${batchDelay} detik... ---`));
            await new Promise(resolve => setTimeout(resolve, batchDelay * 1000));
        }
    }
    
     // --- 5. PERBARUI FILE LIST SETELAH SEMUA SELESAI ---
    if (removeSentEmails && successfullySentEmails.size > 0) {
        const remainingEmails = allLines.filter(email => !successfullySentEmails.has(email));
        try {
            fs.writeFileSync(options.emailListPath, remainingEmails.join('\n'));
            console.log(chalk.bold.blue(`\nBerhasil memperbarui file list. ${successfullySentEmails.size} email yang terkirim telah dihapus.`));
        } catch (writeError) {
            console.error(chalk.bold.red('\nGagal memperbarui file list email:'), writeError);
        }
    }

    console.log(chalk.bold.blue('\n================ SEMUA BATCH SELESAI ================'));
    console.log(chalk.bold.green(`  Berhasil terkirim : ${successCount}`));
    console.log(chalk.bold.red(`  Gagal terkirim    : ${failCount}`));
    console.log(chalk.bold.blue('====================================================='));
}

module.exports = { sendMail };
