# 📧 Beon Mailer Pro

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-green?style=flat-square&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/Nodemailer-7.0-blue?style=flat-square" alt="Nodemailer">
  <img src="https://img.shields.io/badge/License-ISC-yellow?style=flat-square" alt="License">
</p>

**Beon Mailer Pro** adalah aplikasi CLI (Command Line Interface) untuk mengirim email massal menggunakan Node.js dan Nodemailer. Dilengkapi dengan fitur-fitur canggih seperti template dinamis, retry otomatis, dan logging ke file.

---

## ✨ Fitur Unggulan

| Fitur | Deskripsi |
|-------|-----------|
| 🚀 **Dual Sending Mode** | Kirim satu-per-satu (sequential) atau paralel per batch |
| 🎨 **Dynamic Placeholders** | Template email dengan placeholder yang otomatis terisi |
| 🔄 **Auto Retry** | Otomatis coba ulang jika pengiriman gagal |
| 📝 **File Logging** | Simpan hasil pengiriman ke file (sukses/gagal) |
| ✅ **SMTP Validation** | Validasi konfigurasi dan test koneksi sebelum kirim |
| 🎲 **Randomization** | Random country, device, nama, email untuk setiap pengiriman |
| 🧹 **List Management** | Hapus duplikat & auto-remove email yang sudah terkirim |
| 🎯 **Custom Headers** | Atur prioritas email dan custom headers |

---

## 📦 Instalasi

```bash
# Clone repository
git clone https://github.com/afuzapratama/Beon_Sender_Mail.git
cd Beon_Sender_Mail

# Install dependencies
npm install

# Salin dan edit konfigurasi
cp .env.example .env
nano .env  # atau gunakan editor favorit kamu
```

---

## 🚀 Cara Penggunaan

### 1. Konfigurasi `.env`

Edit file `.env` dengan kredensial SMTP kamu:

```env
# WAJIB - Kredensial SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=emailkamu@gmail.com
SMTP_PASS=app-password-kamu
SMTP_SECURE=false

# Konten Email
SENDER_NAME=Beon Store
EMAIL_SUBJECT=🎉 Promo Spesial untuk {nama_penerima}!
LETTER_PATH=letters/letter.html

# Mode Pengiriman
ENABLE_BATCH_SENDING=false
BATCH_SIZE=10
SEND_DELAY_SECONDS=2

# Fitur Tambahan
RETRY_ATTEMPTS=2
ENABLE_FILE_LOGGING=true
```

### 2. Siapkan Daftar Email

Buat file di `lists/emails.txt` dengan format satu email per baris:

```
user1@example.com
user2@example.com
user3@example.com
```

### 3. Jalankan Aplikasi

```bash
npm start
```

Aplikasi akan:
1. ✅ Validasi konfigurasi `.env`
2. 🔌 Test koneksi SMTP
3. 📋 Meminta path file email list
4. 📨 Mulai pengiriman!

---

## 🎨 Sistem Placeholder Dinamis

### Random String Generators

Gunakan di subject, sender name, atau template:

| Placeholder | Output Contoh | Keterangan |
|-------------|---------------|------------|
| `{lowercase_8}` | `abcdefgh` | 8 huruf kecil random |
| `{uppercase_5}` | `ABCDE` | 5 huruf besar random |
| `{numeric_6}` | `123456` | 6 angka random |
| `{mixed_10}` | `aB3cD4eF5g` | 10 karakter campuran |
| `{mixedupper_8}` | `A1B2C3D4` | Huruf besar + angka |
| `{generateid}` | `550e8400-e29b-41d4...` | UUID v4 |

### Template Email Variables

Gunakan di file HTML (`letters/*.html`):

| Placeholder | Nilai |
|-------------|-------|
| `{email_penerima}` | Email tujuan (dari list) |
| `{nama_penerima}` | Nama dari email (sebelum @, dibersihkan) |
| `{nama_pengirim}` | Dari `SENDER_NAME` |
| `{tanggal}` | Tanggal hari ini (format Indonesia) |
| `{negara}` | Random dari `data/country.txt` |
| `{perangkat}` | Random dari `data/device.txt` |
| `{email_acak}` | Email random (Faker.js) |
| `{nama_acak}` | Nama random (Faker.js) |
| `{shortlink}` | Link dari `links/links.txt` |

### Contoh Template HTML

```html
<!DOCTYPE html>
<html>
<body>
    <h2>Halo, {nama_penerima}!</h2>
    <p>Email ini dikirim dari <strong>{nama_pengirim}</strong>.</p>
    
    <a href="{shortlink}" style="background: #007bff; color: white; padding: 15px 25px; text-decoration: none; border-radius: 5px;">
        Klik Di Sini
    </a>
    
    <hr>
    <small>
        Dikirim ke: {email_penerima}<br>
        Tanggal: {tanggal}<br>
        Lokasi: {negara} | Device: {perangkat}
    </small>
</body>
</html>
```

---

## 🔗 Format Link Template

File `links/links.txt` mendukung placeholder:

```
https://example.com/?user={email_penerima}&id={lowercase_8}&track={numeric_17}
https://redirect.com/{generateid}?email={email_penerima}
# Baris dengan # akan diabaikan
```

---

## ⚙️ Konfigurasi Lengkap

### SMTP Configuration

| Variable | Required | Default | Keterangan |
|----------|----------|---------|------------|
| `SMTP_HOST` | ✅ | - | Hostname SMTP server |
| `SMTP_PORT` | ✅ | - | Port (587 untuk TLS, 465 untuk SSL) |
| `SMTP_USER` | ✅ | - | Username/email |
| `SMTP_PASS` | ✅ | - | Password/App Password |
| `SMTP_SECURE` | ❌ | `false` | `true` untuk SSL (port 465) |
| `SMTP_HOSTNAME` | ❌ | `localhost` | Custom EHLO hostname |

### Email Content

| Variable | Required | Default | Keterangan |
|----------|----------|---------|------------|
| `SENDER_NAME` | ❌ | `Pengirim Default` | Nama pengirim |
| `EMAIL_SUBJECT` | ❌ | `Subjek Default` | Subject email |
| `LETTER_PATH` | ❌ | `letters/letter.html` | Path template HTML |
| `CUSTOM_FROM_EMAIL` | ❌ | `SMTP_USER` | Custom from address |
| `EMAIL_PRIORITY` | ❌ | `normal` | `high`, `normal`, `low` |
| `USE_MINIMAL_HEADERS` | ❌ | `false` | Skip X-Priority & X-NSS |

### Sending Mode

| Variable | Required | Default | Keterangan |
|----------|----------|---------|------------|
| `ENABLE_BATCH_SENDING` | ❌ | `false` | Mode batch paralel |
| `BATCH_SIZE` | ❌ | `10` | Email per batch |
| `SEND_DELAY_SECONDS` | ❌ | `1` | Delay antar email/batch |

### Retry & Logging

| Variable | Required | Default | Keterangan |
|----------|----------|---------|------------|
| `RETRY_ATTEMPTS` | ❌ | `0` | Jumlah retry (0 = off) |
| `RETRY_DELAY_SECONDS` | ❌ | `3` | Delay sebelum retry |
| `ENABLE_FILE_LOGGING` | ❌ | `false` | Log ke file |
| `DEBUG_MODE` | ❌ | `false` | Verbose logging |

### List Management

| Variable | Required | Default | Keterangan |
|----------|----------|---------|------------|
| `REMOVE_DUPLICATE_EMAILS` | ❌ | `false` | Hapus duplikat |
| `REMOVE_SENT_EMAIL_FROM_LIST` | ❌ | `false` | Hapus email terkirim dari file |

---

## 📁 Struktur Folder

```
Beon_Sender_Mail/
├── index.js              # Entry point CLI
├── mailer.js             # Core logic pengiriman
├── package.json
├── .env.example          # Template konfigurasi
├── .gitignore
│
├── letters/              # Template email HTML
│   ├── letter.html       # Template default
│   └── kambing.html      # Template tambahan
│
├── links/                # Template link
│   └── links.txt
│
├── lists/                # Daftar email target
│   └── emails.txt
│
├── data/                 # Data untuk randomisasi
│   ├── country.txt       # 196 negara
│   └── device.txt        # 148 devices
│
├── logs/                 # Auto-generated logs
│   ├── success-2025-12-15T10-30-00.txt
│   └── failed-2025-12-15T10-30-00.txt
│
└── .github/
    └── copilot-instructions.md
```

---

## 📊 Output Log

### Console Output (Sukses)

```
||===========================================================================
|| 📨 SEND TO         : user@example.com
|| 📮 FROM MAIL        : sender@domain.com
|| 🧒 FROM NAME        : Beon Store
|| 📝 SUBJECT          : Promo Spesial untuk User!
|| 🔗 SHORTLINK        : redirect.com
||─────────────────────────────────────────────────────────────────────────
|| 💻 SMTP             : smtp.gmail.com
|| 🛒 TOTAL SEND       : 1 / 100
|| 🕥 DELAY            : 2 SEC (Per Email)
||===========================================================================
```

### File Log (Success)

```
[2025-12-15T10:30:00.000Z] user1@example.com
[2025-12-15T10:30:02.000Z] user2@example.com
```

### File Log (Failed)

```
[2025-12-15T10:30:05.000Z] invalid@example.com | Error: Mailbox not found
```

---

## 🔧 Tips & Troubleshooting

### Gmail SMTP

1. Aktifkan 2FA di akun Google
2. Buat App Password: Google Account → Security → App Passwords
3. Gunakan App Password di `SMTP_PASS`

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
```

### Error: Connection Timeout

- Cek firewall/antivirus
- Pastikan port tidak diblokir
- Coba ganti port (587 ↔ 465)

### Error: Invalid Credentials

- Pastikan username/password benar
- Untuk Gmail, gunakan App Password bukan password akun

### Rate Limiting

Jika SMTP provider membatasi jumlah email:
- Tambah `SEND_DELAY_SECONDS`
- Kurangi `BATCH_SIZE`
- Aktifkan sequential mode (`ENABLE_BATCH_SENDING=false`)

---

## 📄 License

ISC License - Bebas digunakan dan dimodifikasi.

---

## 🤝 Contributing

Pull requests welcome! Untuk perubahan besar, buka issue dulu untuk diskusi.

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/afuzapratama">afuzapratama</a>
</p>
