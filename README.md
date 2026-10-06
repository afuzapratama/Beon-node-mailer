# Beon Mailer

CLI Node.js untuk pengiriman email menggunakan satu atau beberapa server SMTP,
rotasi round-robin, template dinamis, retry terbatas, dan journal untuk resume.

## Instalasi

Gunakan Node.js 22.13+ pada seri 22, atau Node.js 24+; npm 10+.

```bash
npm ci
cp .env.example .env
cp lists/suppressed.example.txt lists/suppressed.txt
```

Isi kredensial sendiri di `.env`. Untuk single SMTP:

```dotenv
SMTP_MODE=single
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=sender@example.com
SMTP_PASS=replace-with-your-password
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_TLS_REJECT_UNAUTHORIZED=true
```

## Multiple SMTP

```bash
cp smtp/servers.example.csv smtp/servers.csv
chmod 600 smtp/servers.csv
```

Edit `smtp/servers.csv`, lalu set di `.env`:

```dotenv
SMTP_MODE=multiple
SMTP_LIST_PATH=smtp/servers.csv
SMTP_SELECTION=round_robin
```

Format CSV wajib:

```csv
host,port,user,pass,secure
smtp.first.example,587,sender@first.example,replace-me,false
smtp.second.example,465,sender@second.example,replace-me,true
```

Header opsional: `id`, `from_email`, `reply_to`, `enabled`, `require_tls`, `tls_servername`,
`tls_ca_path`, `tls_reject_unauthorized`, `max_connections`, `rate_limit`,
`rate_delta_ms`. Header harus sesuai nama ini. Password dengan koma ditulis
`"password,with,commas"`; tanda kutip di dalam field ditulis dua kali.
Password dipertahankan termasuk spasinya. Contoh CSV harus diganti dengan server asli.

Semua baris divalidasi sebelum koneksi. Server yang gagal verify dilewati; jika
semuanya gagal, proses berhenti. From menggunakan `from_email`, lalu
`CUSTOM_FROM_EMAIL`, lalu username SMTP. Jika username bukan alamat email,
sediakan From yang valid dan diizinkan provider. Global From berlaku pada setiap
server yang tidak memiliki override, jadi pastikan masing-masing mengizinkannya.
Gunakan `id` eksplisit agar identitas log stabil saat CSV diubah.

Untuk balasan pelanggan, isi satu mailbox nyata di `.env` (single maupun multiple):

```dotenv
REPLY_TO=support@your-domain.example
```

Urutan pemilihan: kolom CSV `reply_to` yang terisi → `REPLY_TO` global → tanpa
header Reply-To (balasan mengikuti From). Contoh override per server:

```csv
host,port,user,pass,secure,id,reply_to
smtp.first.example,587,sender@first.example,replace-me,false,first,support@first.example
smtp.second.example,465,sender@second.example,replace-me,true,second,
```

Server second menggunakan REPLY_TO global karena kolomnya kosong. Alamat harus
berupa satu mailbox tanpa display name, daftar alamat, atau placeholder.
Reply-To dipilih dari server sehat yang benar-benar dipakai pada percobaan pertama,
lalu dipertahankan pada retry/resume; From tetap mengikuti server pengiriman.
Pekerjaan pending yang belum pernah dicoba mengikuti konfigurasi saat dispatch.
Preview baru memakai server pertama dalam konfigurasi tanpa mengetes kesehatannya.

Untuk satu brand dengan beberapa SMTP, gunakan satu alamat support yang stabil
dan dipantau. Jika server mewakili brand berbeda, gunakan override per server yang
sesuai. Reply-To menentukan tujuan balasan pengguna, bukan alamat bounce atau
pengganti autentikasi domain. Penjelasan field: [Nodemailer](https://nodemailer.com/message).

## TLS di VPS

Port 465: `secure=true`. Port 587: `secure=false` dan STARTTLS wajib secara default.
Pemeriksaan sertifikat aktif secara default. VPS klien tidak perlu memasang
sertifikat untuk koneksi SMTP biasa. Untuk host IP, isi `tls_servername` dengan
nama pada sertifikat. Untuk CA privat, gunakan `tls_ca_path`.

Pengecualian sertifikat tersedia per server melalui
`tls_reject_unauthorized=false` atau `SMTP_TLS_REJECT_UNAUTHORIZED=false` pada
mode single. Preflight menampilkan jika pemeriksaan dinonaktifkan. Opsi ini
menghilangkan verifikasi keaslian server dan bukan solusi untuk DNS, port
terblokir, atau kredensial salah. Panduan diagnosis ada di
[docs/rencana-perbaikan.md](docs/rencana-perbaikan.md).

## Preview dan pengiriman

Daftar penerima: satu alamat email ASCII per baris, tanpa display name. Baris
kosong dan komentar `#` diabaikan. Domain dinormalisasi ke huruf kecil; local-part
dipertahankan. Alamat invalid membatalkan preflight.

```bash
# Preview HTML + JSON pesan; tidak mengakses SMTP atau mengubah daftar penerima
npm start -- --dry-run --list lists/emails.txt

# Campaign baru; CLI meminta konfirmasi
npm start -- --list lists/emails.txt

# Melanjutkan campaign yang sama
npm start -- --resume logs/campaigns/ID.json

npm start -- --help
```

Preview disimpan di `logs/preview.html` dan `logs/preview.html.json`, atau path
`--preview`. Template dan semua penerima diperiksa sebelum preview dinyatakan valid.
File preview/journal berisi data penerima dan konten; gunakan akses terbatas dan
hapus sesuai kebutuhan retensi.

**Gunakan `--resume` untuk melanjutkan proses lama.** Menjalankan tanpa `--resume`
membuat campaign baru dan dapat mengirim ulang alamat yang sama. Setiap proses
mengunci daftar penerima dan journal. Setelah crash keras, pastikan proses lama
sudah berhenti sebelum menghapus file `.beon.lock`/`.json.lock` yang stale.

Status journal:

| Status | Arti | Resume |
| --- | --- | --- |
| `pending` | Belum selesai, aman dilanjutkan | Dikirim sesuai sisa budget retry |
| `in_flight` | Dispatch sudah dicatat sebelum SMTP I/O | Diubah menjadi uncertain |
| `accepted` | Server SMTP menerima alamat tujuan | Dilewati |
| `rejected` | Ditolak / budget retry habis | Dilewati |
| `uncertain` | Hasil akhir belum dapat dipastikan | Dilewati; periksa log server dahulu |
| `suppressed` | Ada dalam daftar pengecualian | Dilewati |

Accepted tidak menjamin delivered atau masuk inbox. Timeout tanpa jawaban akhir
DATA tidak otomatis diulang. Retry hanya untuk error sementara yang diketahui
belum accepted; error auth menonaktifkan server pada sesi, dan error permanen
tidak diulang. Konten dan Message-ID tetap sama saat retry. From dapat berubah
saat pindah server dan dicatat di console/journal. Pool internal tidak melakukan
requeue otomatis. SMTP tidak menjamin exactly-once delivery.

Ctrl+C/SIGTERM menghentikan dispatch baru dan menunggu pekerjaan aktif hingga
selesai/timeout. Hasil disimpan sebelum log tambahan. Kegagalan menulis checkpoint
atau log menghentikan dispatch baru; accepted tidak diubah menjadi error kirim.

`REMOVE_SENT_EMAIL_FROM_LIST=true` memakai penulisan atomik dan rencana cleanup
di journal agar resume aman jika berhenti saat pembaruan file. Alamat dihapus
hanya jika seluruh kemunculannya dalam campaign accepted. Komentar dan alamat
lain dipertahankan. Jika daftar diedit saat proses berjalan, auto-remove berhenti
dengan error; gunakan journal untuk meninjau hasil.

## Template

Set `LETTER_PATH` untuk HTML; `TEXT_LETTER_PATH` opsional untuk versi teks.
Jika tidak diisi, versi teks dibuat dari HTML. Nama pengirim, subject, HTML,
teks, dan URL memakai renderer yang sama; nilai di-escape sesuai konteks.
Placeholder tidak dikenal menghentikan preflight.

| Placeholder | Nilai |
| --- | --- |
| `{email_penerima}`, `{nama_penerima}` | Alamat dan nama turunan dari local-part |
| `{nama_pengirim}` | Nama pengirim |
| `{tanggal}` | Tanggal sesuai EMAIL_LOCALE dan EMAIL_TIMEZONE |
| `{tanggal_akhir_promo}` | PROMO_END_DATE, wajib jika dipakai |
| `{shortlink}` | URL acak dari links/links.txt (bukan layanan pemendek URL) |
| `{unsubscribe_link}` | UNSUBSCRIBE_URL_TEMPLATE |
| `{negara}`, `{perangkat}` | Negara demo acak dan model Apple acak dari data/*.txt |
| `{email_acak}`, `{nama_acak}` | Data acak Faker |
| `{generateid}` | UUID |
| `{lowercase_N}`, `{uppercase_N}`, `{numeric_N}`, `{mixed_N}`, `{mixedupper_N}` | String acak 1–1024 karakter |

Placeholder acak yang sama konsisten dalam satu pesan. Link wajib HTTP/HTTPS,
tanpa kredensial. Email dalam query di-encode sehingga `+` tetap benar.
Negara/perangkat acak adalah data demo, bukan data nyata penerima.
`data/country.txt` berisi 250 entri negara dan wilayah: 248 entri dari
[M49 PBB](https://unstats.un.org/unsd/methodology/m49/overview/), ditambah Taiwan
dan Kosovo untuk cakupan aplikasi. Daftar diperbarui pada 7 Oktober 2026 dan
diurutkan alfabetis. Jumlah ini bukan jumlah negara berdaulat atau anggota PBB,
dan bukan inventaris setiap entitas yang mengklaim kemerdekaan.
`{negara}` tetap memilih satu entri secara acak.
`data/device.txt` berisi 91 model Apple (46 iPhone dan 45 iPad), diperbarui pada
7 Oktober 2026. Satu entri per model, tanpa pemisahan varian jaringan, regional,
warna, atau kapasitas. Nama dicocokkan dengan daftar resmi
[iPhone](https://support.apple.com/en-us/108044) dan
[iPad](https://support.apple.com/en-us/108043). Daftar mencakup model lama dan baru;
pemilihan acak merata per entri, bukan berdasarkan pangsa penggunaan.

Untuk `letters/ashland-promo.html`:

```dotenv
LETTER_PATH=letters/ashland-promo.html
EMAIL_LOCALE=ja-JP
EMAIL_TIMEZONE=Asia/Tokyo
PROMO_END_DATE=2026年12月31日
ENABLE_UNSUBSCRIBE=true
UNSUBSCRIBE_URL_TEMPLATE=https://your-domain.example/unsubscribe?email={email_penerima}
```

Gunakan endpoint unsubscribe milik Anda yang benar-benar berfungsi, berbeda dari
link promo. Aplikasi menambahkan header List-Unsubscribe, tetapi tidak menyediakan
web endpoint atau one-click POST handler. Template Ashland masih berisi alamat
contoh; ganti identitas toko sebelum digunakan.

Unsubscribe dapat diaktifkan/dimatikan melalui `.env`:

```dotenv
ENABLE_UNSUBSCRIBE=true
# false untuk menghapus bagian unsubscribe dari pesan baru
```

Default `true` mempertahankan perilaku sebelumnya: URL wajib jika template
memakai `{unsubscribe_link}`; header List-Unsubscribe ditambahkan bila URL tersedia.
Saat `false`, URL tidak diperlukan, header tidak ditambahkan, dan blok berikut
dihapus dari HTML maupun template teks:

```html
<!-- unsubscribe:start -->
<p>Berhenti berlangganan: <a href="{unsubscribe_link}">klik di sini</a></p>
<!-- unsubscribe:end -->
```

Template Ashland sudah memakai marker tersebut. Untuk template kustom, bungkus
seluruh bagian unsubscribe agar tidak meninggalkan link kosong ketika OFF.
Marker harus berpasangan dan tidak nested. Suppression list tetap berlaku saat
OFF. Pengaturan ini berlaku untuk pesan campaign baru; `--resume` mempertahankan
konten dan header yang sudah disimpan dalam journal.

Tambahkan alamat unsubscribe/bounce permanen ke `lists/suppressed.txt` (format
sama dengan daftar penerima). Suppression dibaca pada campaign baru dan resume;
pekerjaan pending dikecualikan. File ini diabaikan Git. Tidak ada sinkronisasi
otomatis dengan endpoint eksternal; impor hasil unsubscribe ke file ini sebelum
pengiriman berikutnya. Path kustom wajib ada; jika path default tidak ada dan
variabel tidak diset, daftar dianggap kosong.

## Batas pengiriman dan log

`.env.example` memuat seluruh opsi. Angka harus integer, boolean `true`/`false`.
Delay `0` benar-benar tanpa jeda. Mode sequential menggunakan satu worker;
mode batch membatasi ukuran batch dengan `BATCH_SIZE`, worker total dengan
`MAX_CONCURRENCY`, koneksi per server dengan `SMTP_MAX_CONNECTIONS`, dan pesan
per interval dengan `SMTP_RATE_LIMIT` / `SMTP_RATE_DELTA_MS`. CSV dapat override
batas per server. Rate limit ini per sesi; kuota harian lintas proses tetap harus
diatur mengikuti provider.

Journal selalu aktif, termasuk ketika `ENABLE_FILE_LOGGING=false`. File log
opsional memakai nama `accepted-ID.txt`, `rejected-ID.txt`, dan `uncertain-ID.txt`.
`DEBUG_MODE` menampilkan status tanpa raw SMTP traffic. Respons server disimpan
setelah redaksi kredensial yang diketahui. Exit code: `0` sukses, `1` gagal/
uncertain/pending, `130` dihentikan sinyal.

Journal berupa snapshot JSON atomik yang ditulis sinkron per transisi; gunakan
untuk daftar berukuran moderat. Volume besar perlu storage/queue database agar
penulisan seluruh snapshot tidak menjadi bottleneck.

## Pengujian

```bash
npm test
npm audit --omit=dev
```

Test memakai direktori sementara, mock transporter dan SMTP lokal; tidak mengirim
email ke penerima asli. CI menjalankan test pada Node.js 22.13 dan 24.
Hasil dan fase perbaikan dicatat di [docs/rencana-perbaikan.md](docs/rencana-perbaikan.md).

## Struktur

```text
index.js                 CLI dan opsi preview/resume
mailer.js                Orkestrasi pengiriman
src/config.js            Validasi dan parser CSV
src/template.js          Renderer dan pembuatan pesan
src/smtp.js              Registry, scheduler, TLS, klasifikasi error
src/journal.js           Persistensi atomik dan lock
smtp/servers.example.csv Contoh daftar SMTP
lists/                   Penerima dan suppression
letters/                 Template email
data/                    Data demo
links/                   Template URL
logs/                    Journal, preview, dan hasil (diabaikan Git)
test/                    Pengujian perilaku
```

License: ISC.
