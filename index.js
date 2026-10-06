const inquirer = require('inquirer');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { sendMail } = require('./mailer');
function argumentsFrom(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--dry-run') options.dryRun = true;
        else if (arg === '--help') options.help = true;
        else if (['--list', '--resume', '--preview'].includes(arg)) {
            if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${arg} membutuhkan path`);
            options[{ '--list': 'emailListPath', '--resume': 'resume', '--preview': 'previewPath' }[arg]] = argv[++i];
        } else throw new Error(`Argumen tidak dikenal: ${arg}`);
    }
    if (options.resume && options.emailListPath) throw new Error('--resume memakai daftar dari journal; jangan gabungkan --list');
    if (options.previewPath && !options.dryRun) throw new Error('--preview membutuhkan --dry-run');
    return options;
}
async function main() {
    const options = argumentsFrom(process.argv.slice(2));
    if (options.help) {
        console.log('npm start -- [--list path] [--dry-run --preview path] [--resume logs/campaigns/id.json]\n--dry-run tidak mengakses SMTP. --resume hanya melanjutkan pending; accepted/rejected/uncertain dilewati.');
        return;
    }
    console.log('BEON MAILER — Single / Multiple SMTP');
    if (!options.emailListPath && !options.resume) {
        const answer = await inquirer.prompt([{ type: 'input', name: 'emailListPath', message: 'Path daftar penerima:', default: path.join(__dirname, 'lists/emails.txt') }]);
        options.emailListPath = answer.emailListPath;
    }
    if (!options.dryRun) {
        const answer = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: options.resume ? 'Lanjutkan pekerjaan pending dari journal?' : 'Mulai campaign baru? Untuk pekerjaan sebelumnya gunakan --resume.', default: false }]);
        if (!answer.confirm) { console.log('Pengiriman dibatalkan.'); return; }
    }
    const result = await sendMail(options);
    if (!result.dryRun && (result.rejected || result.uncertain || result.pending || result.interrupted)) process.exitCode = result.interrupted ? 130 : 1;
}
if (require.main === module) main().catch(error => { console.error(`Gagal: ${error.message}`); process.exitCode = 1; });
module.exports = { argumentsFrom, main };
