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
    const { targetEmail, fromMail, fromName, subject, shortlink, smtpHost, currentIndex, totalEmails, delay, isBatch } = details;
    let domainOnly = shortlink;
    try { const urlObject = new URL(shortlink); domainOnly = urlObject.hostname; } catch (e) { domainOnly = shortlink; }
    const border = '||' + '='.repeat(75);
    const line = '||' + '-'.repeat(75);
    const delayText = isBatch ? 'Antar Batch' : 'Per Email';

    console.log(chalk.bold.white(border));
    console.log(`${chalk.bold.white('||')} ${chalk.bold.magenta('📨 SEND TO')}         : ${chalk.yellow(targetEmail)}`);
    console.log(`${chalk.bold.white('||')} ${chalk.bold.magenta('📮 FROM MAIL')}        : ${chalk.cyan(fromMail)}`);
    console.log(`${chalk.bold.white('||')} ${chalk.bold.magenta('🧒 FROM NAME')}        : ${chalk.blue(fromName)}`);
    console.log(`${chalk.bold.white('||')} ${chalk.bold.magenta('📝 SUBJECT')}          : ${chalk.cyan(subject)}`);
    console.log(`${chalk.bold.white('||')} ${chalk.bold.magenta('🔗 SHORTLINK')}        : ${chalk.white(domainOnly)}`);
    console.log(chalk.bold.white(line));
    console.log(`${chalk.bold.white('||')} ${chalk.bold.red('💻 SMTP')}             : ${chalk.red(smtpHost)}`);
    console.log(`${chalk.bold.white('||')} ${chalk.bold.red('🛒 TOTAL SEND')}       : ${chalk.red(`${currentIndex} / ${totalEmails}`)}`);
    console.log(`${chalk.bold.white('||')} ${chalk.bold.red('🕥 DELAY')}            : ${chalk.red(`${delay} SEC (${delayText})`)}`);
    console.log(chalk.bold.white(border) + '\n');
}

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
    if (isDebug) {
        console.log(chalk.bold.yellow('\n--- DEBUG STACK TRACE ---'));
        console.error(error);
        console.log(chalk.bold.yellow('-------------------------\n'));
    } else {
        console.log('\n');
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

// --- Helper untuk data acak ---
const countries = fs.readFileSync(path.join(__dirname, 'data', 'country.txt'), 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);
const devices = fs.readFileSync(path.join(__dirname, 'data', 'device.txt'), 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);
const linkTemplates = fs.readFileSync(path.join(__dirname, 'links', 'links.txt'), 'utf-8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
const getRandomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

// --- Fungsi untuk memproses satu email ---
async function processAndSendSingleEmail(details) {
    const { 
        transporter, targetEmail, selectedHostname, 
        rawSenderNameTemplate, rawSubjectTemplate, rawCustomFromTemplate, 
        rawLetterTemplate, emailPriority, useMinimalHeaders 
    } = details;

    const processedSenderName = processDynamicPlaceholders(rawSenderNameTemplate);
    const processedSubject = processDynamicPlaceholders(rawSubjectTemplate);
    const fromEmail = rawCustomFromTemplate ? processDynamicPlaceholders(rawCustomFromTemplate) : process.env.SMTP_USER;
    
    let processedLetter = processDynamicPlaceholders(rawLetterTemplate);
    let finalLink = '#';
    if (linkTemplates.length > 0) {
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

    const messageId = `<${crypto.randomBytes(16).toString('hex')}@${selectedHostname}>`;
    const headers = { 'Message-ID': messageId };

    if (!useMinimalHeaders) {
        const priorityMap = { high: '1 (Highest)', normal: '3 (Normal)', low: '5 (Lowest)' };
        headers['X-Priority'] = priorityMap[emailPriority] || '3 (Normal)';
        // headers['X-Mailer'] = 'nodemailer';
        headers['X-NSS'] = crypto.randomBytes(16).toString('hex');
    }

    const mailOptions = { 
        from: `"${processedSenderName}" <${fromEmail}>`, to: targetEmail, 
        subject: processedSubject, html: processedLetter, headers: headers
    };

    await transporter.sendMail(mailOptions);
    return { fromEmail, processedSenderName, processedSubject, finalLink };
}


// --- Fungsi Utama Pengiriman Email ---
async function sendMail(options) {
    // --- 1. MEMBACA SEMUA KONFIGURASI DARI .ENV ---
    const enableBatchSending = process.env.ENABLE_BATCH_SENDING === 'true';
    const debugMode = process.env.DEBUG_MODE === 'true';
    const rawHostnameTemplate = process.env.SMTP_HOSTNAME || 'localhost';
    
    const selectedHostname = processDynamicPlaceholders(rawHostnameTemplate);
    if (!debugMode) { console.log(chalk.blue(`\nHostname untuk sesi ini: ${selectedHostname}`)); }

    const transporterConfig = {
        pool: enableBatchSending, // Menggunakan pool hanya jika batch aktif
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        tls: { rejectUnauthorized: false },
        name: selectedHostname,
    };

    if (debugMode) {
        console.log(chalk.bold.yellow.inverse('\n DEBUG MODE IS ON \n'));
        transporterConfig.logger = true;
        transporterConfig.debug = true;
    }

    const transporter = nodemailer.createTransport(transporterConfig);

    const emailConfig = {
        rawSenderNameTemplate: process.env.SENDER_NAME || 'Pengirim Default',
        rawSubjectTemplate: process.env.EMAIL_SUBJECT || 'Subjek Default',
        rawCustomFromTemplate: process.env.CUSTOM_FROM_EMAIL,
        letterPath: path.join(__dirname, process.env.LETTER_PATH || 'letters/letter.html'),
        emailPriority: process.env.EMAIL_PRIORITY || 'normal',
        useMinimalHeaders: process.env.USE_MINIMAL_HEADERS === 'true',
    };
    emailConfig.rawLetterTemplate = fs.readFileSync(emailConfig.letterPath, 'utf-8');

    const sendConfig = {
        batchSize: parseInt(process.env.BATCH_SIZE, 10) || 10,
        delay: parseInt(process.env.SEND_DELAY_SECONDS, 10) || 1,
        removeDuplicates: process.env.REMOVE_DUPLICATE_EMAILS === 'true',
        removeSentEmails: process.env.REMOVE_SENT_EMAIL_FROM_LIST === 'true',
    };

    // --- 2. PERSIAPAN DAFTAR EMAIL ---
    let allLines = fs.readFileSync(options.emailListPath, 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);
    let emailListToSend;
    if (sendConfig.removeDuplicates) {
        const originalCount = allLines.length;
        emailListToSend = [...new Set(allLines)];
        if (originalCount !== emailListToSend.length) {
            console.log(chalk.blue(`\nMenghapus email duplikat... Asli: ${originalCount}, Unik: ${emailListToSend.length}`));
        }
    } else {
        emailListToSend = allLines;
    }
    
    console.log(chalk.yellow(`\nTotal email akan dikirim: ${emailListToSend.length}. Mode Batch: ${enableBatchSending ? 'ON' : 'OFF'}`));
    
    let successCount = 0, failCount = 0, totalSent = 0;
    const successfullySentEmails = new Set();

    // --- 3. PROSES PENGIRIMAN SESUAI MODE ---
    if (enableBatchSending) {
        // --- MODE BATCH ---
        const emailChunks = [];
        for (let i = 0; i < emailListToSend.length; i += sendConfig.batchSize) {
            emailChunks.push(emailListToSend.slice(i, i + sendConfig.batchSize));
        }

        for (let i = 0; i < emailChunks.length; i++) {
            const chunk = emailChunks[i];
            console.log(chalk.bold.blue(`\n--- Mengirim Batch ${i + 1} dari ${emailChunks.length} (${chunk.length} email) ---`));

            const promises = chunk.map(async (targetEmail) => {
                try {
                    const sentDetails = await processAndSendSingleEmail({ ...emailConfig, transporter, targetEmail, selectedHostname });
                    totalSent++;
                    // *** PERBAIKAN DI SINI ***
                    logSuccess({
                        targetEmail,
                        fromMail: sentDetails.fromEmail,
                        fromName: sentDetails.processedSenderName,
                        subject: sentDetails.processedSubject,
                        shortlink: sentDetails.finalLink,
                        smtpHost: process.env.SMTP_HOST,
                        currentIndex: totalSent,
                        totalEmails: emailListToSend.length,
                        delay: sendConfig.delay,
                        isBatch: true
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
                console.log(chalk.yellow(`--- Batch ${i + 1} selesai. Jeda selama ${sendConfig.delay} detik... ---`));
                await new Promise(resolve => setTimeout(resolve, sendConfig.delay * 1000));
            }
        }
    } else {
        // --- MODE SATU PER SATU ---
        for (let i = 0; i < emailListToSend.length; i++) {
            const targetEmail = emailListToSend[i];
            try {
                const sentDetails = await processAndSendSingleEmail({ 
                    ...emailConfig, 
                    transporter, 
                    targetEmail, 
                    selectedHostname 
                });
                totalSent++;
                // *** PERBAIKAN DI SINI ***
                logSuccess({ 
                    targetEmail,
                    fromMail: sentDetails.fromEmail,
                    fromName: sentDetails.processedSenderName,
                    subject: sentDetails.processedSubject,
                    shortlink: sentDetails.finalLink,
                    smtpHost: process.env.SMTP_HOST, 
                    currentIndex: totalSent, 
                    totalEmails: emailListToSend.length, 
                    delay: sendConfig.delay, 
                    isBatch: false 
                });
                successCount++;
                successfullySentEmails.add(targetEmail);
            } catch (error) {
                totalSent++;
                logError(error, targetEmail, debugMode);
                failCount++;
            }

            if (i < emailListToSend.length - 1) {
                await new Promise(resolve => setTimeout(resolve, sendConfig.delay * 1000));
            }
        }
    }
    
    // --- 4. PERBARUI FILE LIST SETELAH SEMUA SELESAI ---
    if (sendConfig.removeSentEmails && successfullySentEmails.size > 0) {
        const remainingEmails = allLines.filter(email => !successfullySentEmails.has(email));
        try {
            fs.writeFileSync(options.emailListPath, remainingEmails.join('\n'));
            console.log(chalk.bold.blue(`\nBerhasil memperbarui file list. ${successfullySentEmails.size} email yang terkirim telah dihapus.`));
        } catch (writeError) {
            console.error(chalk.bold.red('\nGagal memperbarui file list email:'), writeError);
        }
    }

    console.log(chalk.bold.blue('\n================ SEMUA PROSES SELESAI ================'));
    console.log(chalk.bold.green(`  Berhasil terkirim : ${successCount}`));
    console.log(chalk.bold.red(`  Gagal terkirim    : ${failCount}`));
    console.log(chalk.bold.blue('======================================================'));
}

module.exports = { sendMail };
