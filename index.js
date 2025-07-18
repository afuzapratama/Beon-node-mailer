// Import library yang dibutuhkan (sekarang semua menggunakan require)
const inquirer = require('inquirer');
const chalk = require('chalk');
const path = require('path');
const { sendMail } = require('./mailer');

// Fungsi untuk menampilkan banner/header
function displayBanner() {
    console.log(chalk.bold.cyan('*************************************************'));
    console.log(chalk.bold.green('** **'));
    console.log(chalk.bold.green('** BEON MAILER PRO (NODE.JS)           **'));
    console.log(chalk.bold.green('** **'));
    console.log(chalk.bold.cyan('*************************************************'));
    console.log(chalk.yellow('      Jangan Di Jual Yak      \n'));
}

// Fungsi utama untuk menjalankan aplikasi
async function main() {
    // Tampilkan banner
    displayBanner();

    // Kumpulan pertanyaan untuk pengguna (sudah disederhanakan)
    const questions = [
        {
            type: 'input',
            name: 'emailListPath',
            message: 'Masukkan path ke file daftar email:',
            default: path.join(__dirname, 'lists', 'emails.txt'),
        },
        {
            type: 'confirm',
            name: 'confirm',
            message: 'Apakah Anda siap untuk memulai proses pengiriman?',
            default: true,
        },
    ];

    // Tanyakan pertanyaan dan dapatkan jawabannya
    const answers = await inquirer.prompt(questions);

    // Jika pengguna mengkonfirmasi, mulai pengiriman
    if (answers.confirm) {
        console.log(chalk.blue('\nKonfigurasi dari .env dan input diterima. Mempersiapkan pengiriman...'));
        // Panggil fungsi sendMail dari mailer.js dengan jawaban sebagai opsi
        await sendMail(answers);
    } else {
        console.log(chalk.red('Proses pengiriman dibatalkan oleh pengguna.'));
    }
}

// Jalankan fungsi utama dan tangani kemungkinan error
main().catch(error => {
    console.error(chalk.red.bold('\nTerjadi kesalahan fatal:'), error);
});
