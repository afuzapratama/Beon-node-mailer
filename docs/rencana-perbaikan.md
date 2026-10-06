# Analisis dan rencana perbaikan Beon Mailer

Tanggal: 6 Oktober 2026 (Asia/Jakarta).

Status: implementasi lokal tersedia untuk single/multiple SMTP, TLS, scheduler,
journal/resume, renderer, suppression, preview, dan test. Validasi VPS produksi
dan integrasi endpoint unsubscribe eksternal masih belum dilakukan.
Cara pakai aktual tersedia di [README](../README.md).

## 1. Hasil pemeriksaan

Pemeriksaan mencakup `index.js`, `mailer.js`, konfigurasi, README, dan template.
Syntax kedua file JavaScript lolos. Simulasi menggunakan transporter mock, tanpa
koneksi SMTP, pengiriman email, atau perubahan daftar penerima.

| Prioritas | Temuan | Langkah perbaikan |
| --- | --- | --- |
| P1 | `tls.rejectUnauthorized=false` selalu aktif | Verifikasi sertifikat sebagai default; konfigurasi pengecualian per server |
| P1 | `BATCH_SIZE` negatif membuat loop pembagian batch tidak selesai | Validasi integer dan rentang sebelum membuat transporter |
| P1 | `SMTP_PORT=587junk` diterima; delay `0` tertimpa default | Parsing ketat; bedakan nilai kosong dari angka nol |
| P1 | Hasil `sendMail()` diabaikan | Simpan accepted/rejected, messageId, response, dan identitas SMTP |
| P1 | Daftar penerima baru diperbarui setelah seluruh proses | Journal per penerima dan resume; pembaruan list atomik |
| P1 | Link unsubscribe Ashland sama dengan link promo | URL unsubscribe tersendiri dan suppression list |
| P2 | `{nama_penerima}` di subject masih literal | Renderer bersama untuk semua field dengan escaping sesuai konteks |
| P2 | Semua error di-retry; pesan dibuat ulang tiap percobaan | Klasifikasi error dan siapkan konten/Message-ID sekali per pekerjaan |
| P2 | File pendukung dibaca saat import; transporter tidak ditutup | Preflight file dan `try/finally` untuk menutup semua koneksi |
| P2 | Error log file dapat menghentikan batch setelah SMTP menerima pesan | Pisahkan hasil transport dari hasil persistensi; hentikan dispatch baru jika journal gagal |
| P2 | Belum ada validasi penerima, preview, test, dan CI | Tambahkan bertahap dengan test perilaku yang penting |
| P3 | Template Jepang memakai tanggal Indonesia dan alamat contoh | Konfigurasi locale, timezone, tanggal akhir promo, serta identitas toko |

Belum diverifikasi: SMTP asli, akses port dari VPS, sertifikat server pengguna,
penerimaan inbox, tampilan lintas klien email, dan audit dependency.
`verify()` menguji koneksi/autentikasi, bukan jaminan izin From atau delivery inbox.

## 2. Format multiple SMTP

Struktur yang dituju:

```text
smtp/
  servers.example.csv   # contoh tanpa kredensial asli, masuk Git
  servers.csv           # konfigurasi pengguna, diabaikan Git
docs/
  rencana-perbaikan.md
```

Format dasar CSV dengan header wajib:

```csv
host,port,user,pass,secure
smtp.first.example,587,sender@first.example,replace-me,false
smtp.second.example,465,sender@second.example,replace-me,true
```

Gunakan parser CSV yang mendukung quoted field; jangan `split(',')`.
Password berkoma ditulis `"secret,with,commas"`. Tanda kutip di dalam field
di-escape dengan dua tanda kutip. Password tidak boleh di-trim otomatis.
Boolean hanya `true` atau `false`; port integer 1–65535; file kosong, header salah,
baris rusak, atau konfigurasi duplikat ditolak dengan nomor baris tanpa password.

Lima field ini cukup untuk SMTP dengan login username/password dan hostname
bersertifikat publik. Username SMTP belum tentu alamat email: bila bukan alamat,
wajib menyediakan From yang diizinkan server.

Header opsional yang sudah tersedia:

| Field | Tujuan / default rencana |
| --- | --- |
| `id` | Identitas unik untuk log; jika kosong gunakan ID dari nomor baris |
| `from_email` | From yang disetujui server; fallback ke user jika user adalah alamat email |
| `reply_to` | Alamat balasan per server; fallback REPLY_TO global; kosong semua mengikuti From |
| `enabled` | `true` |
| `require_tls` | `true`; mewajibkan STARTTLS ketika secure=false |
| `tls_servername` | Nama sertifikat, terutama jika host berupa IP |
| `tls_ca_path` | CA privat yang dipercaya, relatif terhadap root project |
| `tls_reject_unauthorized` | `true`; pengecualian eksplisit per server bila diperlukan |
| `max_connections` | Batas koneksi per server |
| `rate_limit`, `rate_delta_ms` | Batas jumlah pesan per interval per server |

Variabel `.env` yang sudah tersedia:

```dotenv
SMTP_MODE=single
SMTP_LIST_PATH=smtp/servers.csv
SMTP_SELECTION=round_robin
```

`single` mempertahankan konfigurasi SMTP lama. `multiple` membaca CSV;
konfigurasi invalid tidak diam-diam fallback ke single. Setelan konten, batch,
retry, dan logging tetap ada di `.env`. Batas total concurrency juga diperlukan
agar banyak server tidak membuka koneksi tanpa batas.

## 3. TLS pada VPS

VPS bertindak sebagai klien SMTP: untuk koneksi biasa tidak perlu memasang
sertifikat website pada VPS pengirim. Klien memeriksa sertifikat server SMTP.

| Koneksi | Konfigurasi rencana |
| --- | --- |
| Port 465 | `secure=true`: TLS sejak koneksi dimulai |
| Port 587 | `secure=false`, `requireTLS=true`: upgrade STARTTLS wajib |
| Port custom | Ikuti mode TLS server, jangan menebak dari port saja |

`secure=false` tidak sama dengan mematikan TLS. `rejectUnauthorized=false`
tidak mematikan enkripsi, tetapi menghilangkan pemeriksaan keaslian sertifikat.
Mematikan pemeriksaan ini juga tidak memperbaiki DNS, port diblokir, atau password salah.

Untuk sertifikat publik yang valid, pemeriksaan berjalan otomatis. Jika gagal:

1. Periksa hostname, tanggal/jam VPS, masa berlaku sertifikat dan certificate chain.
2. Jika host berupa IP, isi `tls_servername` sesuai nama sertifikat.
3. Untuk CA privat/self-signed, konfigurasi CA yang dipercaya melalui `tls_ca_path`.
4. Bila perlu kompatibilitas sementara, izinkan `tls_reject_unauthorized=false`
   hanya pada server terkait dan tampilkan status tersebut pada preflight.
   Jangan jadikan pengecualian ini default global.

`SMTP_HOSTNAME` adalah identitas EHLO klien, berbeda dari hostname sertifikat server.
Pertahankan identitas EHLO yang stabil dan sesuai server; randomisasi bukan solusi TLS.

Checklist pengujian VPS: DNS host ter-resolve, outbound port diizinkan provider/firewall,
sertifikat lolos, autentikasi lolos, From diizinkan, lalu kirim ke alamat uji sendiri.
Untuk sertifikat publik, diagnosis tanpa kredensial dapat memakai:

```bash
# Ganti smtp.example.com dengan hostname asli.
openssl s_client -starttls smtp -connect smtp.example.com:587 -servername smtp.example.com -verify_hostname smtp.example.com -verify_return_error </dev/null
openssl s_client -connect smtp.example.com:465 -servername smtp.example.com -verify_hostname smtp.example.com -verify_return_error </dev/null
```

Referensi: [SMTP transport Nodemailer](https://nodemailer.com/smtp) dan
[connection pooling](https://nodemailer.com/smtp/pooled).

## 4. Pemilihan server dan kegagalan

- Buat transporter terpisah untuk setiap konfigurasi; jangan mengganti auth pool per pesan.
- Validasi semua baris terlebih dahulu, lalu verify server dengan concurrency terbatas.
  Server tidak sehat tidak masuk scheduler; jika tidak ada server sehat, berhenti.
- Default rencana: round-robin antar server sehat untuk pekerjaan baru, dengan
  rate limit masing-masing dan batas concurrency total.
- From mengikuti konfigurasi server terpilih. Custom From global hanya boleh dipakai
  pada server yang mengizinkannya. Simpan From yang benar-benar digunakan.
- Auth gagal: nonaktifkan server pada sesi. Gangguan sementara: cooldown dan
  backoff terbatas. Error penerima permanen: gagal tanpa rotasi/retry.
- Jika koneksi putus setelah DATA dikirim dan respons akhir belum diterima,
  tandai `uncertain`; jangan otomatis kirim ulang ke server lain.
- Failover hanya untuk kegagalan yang diketahui belum menerima pesan.
  Jika From harus berganti, catat pergantian server dan From; jangan mengubah diam-diam.
- Render body, subject, link, dan Message-ID sekali per pekerjaan. Message-ID stabil
  membantu penelusuran, tetapi tidak menjamin server melakukan deduplikasi.
- Simpan status `pending`, `in_flight`, `accepted`, `rejected`, `uncertain`.
  Setelah crash, `in_flight` yang belum punya hasil masuk review/uncertain.
- SMTP accepted belum berarti delivered. Pengukuran delivery/bounce membutuhkan
  integrasi terpisah sesuai kemampuan provider.

## 5. Fase perbaikan dan kriteria selesai

Implementasi dan hasil pengujian tiap fase dicatat pada bagian 7.
Kriteria di bawah menjadi acuan verifikasi; deployment VPS tidak dianggap selesai
hanya karena test lokal lolos.

### Fase 1 — Fondasi konfigurasi dan preflight

Pisahkan config loader, validasi numerik/boolean/path/email, baca file setelah
validasi, dukung TLS default terverifikasi dan opsi per server, timeout eksplisit,
exit code gagal, dan penutupan transporter melalui finally.

Selesai jika input invalid gagal sebelum koneksi; angka nol yang diizinkan tetap
nol; batch negatif ditolak; single SMTP lama tetap berjalan; semua jalur menutup koneksi.

### Fase 2 — Multiple SMTP

Implementasikan parser CSV, registry transporter, verify terbatas, round-robin,
From per server, limit per server dan global, cooldown, serta ringkasan kesehatan.

Selesai jika dua SMTP mock membagi pekerjaan secara deterministik, server gagal
dilewati, nol server sehat menghentikan proses, limit dipatuhi, dan kredensial
tidak muncul di console/log. Uji real SMTP dilakukan terpisah di VPS.

### Fase 3 — Keandalan pengiriman dan resume

Tambahkan journal persisten sebelum dispatch, catat accepted/rejected/response,
klasifikasi retry, backoff, status uncertain, resume, SIGINT/SIGTERM, dan pembaruan
list atomik. Jika journal tidak bisa ditulis, hentikan pekerjaan baru dan laporkan
status pekerjaan yang sedang berjalan.

Selesai jika crash/resume tidak mengulang accepted, timeout ambigu tidak otomatis
diulang, error permanen tidak di-retry, dan error logging tidak menyamarkan hasil SMTP.
Tidak menjanjikan exactly-once delivery melalui SMTP.

### Fase 4 — Template dan pengelolaan penerima

Renderer konsisten, HTML escaping, URL encoding, validasi URL HTTP/HTTPS,
deteksi placeholder tidak dikenal, plain-text alternative, preview/dry-run,
locale/timezone, tanggal promo, unsubscribe dan suppression list.

Selesai jika subject terpersonalisasi, email dengan `+` tetap benar di URL,
nilai tidak merusak HTML, preview tidak mengakses SMTP, dan penerima unsubscribe
tidak dijadwalkan. Data negara/perangkat acak diberi konteks demo, bukan dianggap
data nyata penerima.

### Fase 5 — Validasi VPS dan dokumentasi operasional

Tambahkan test unit/integrasi dengan mock atau SMTP lokal, CI tanpa kredensial
produksi, audit dependency saat implementasi, panduan migrasi, dan README yang
sesuai perilaku akhir. Batasi akses file kredensial (`chmod 600 smtp/servers.csv`),
redaksi log/debug, serta kebijakan retensi journal dan data penerima.

Selesai jika test lolos; verify dan pengiriman terkontrol ke alamat uji sendiri
berhasil dari VPS pada mode single/multiple; shutdown/resume teruji; tidak ada
password dalam diff/log; hasil dan keterbatasan pengujian tercatat.

## 6. Urutan kerja

Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5.
Jangan gunakan pengiriman massal rutin sebelum checkpoint dan penanganan uncertain
pada Fase 3 selesai. Catat hasil setiap fase dalam dokumen ini setelah implementasi.


## 7. Hasil implementasi — 6 Oktober 2026

| Fase | Status | Bukti / pekerjaan tersisa |
| --- | --- | --- |
| 1 | Implementasi lokal selesai | Parsing ketat, preflight, TLS/CA/servername, timeout dan finally; regression test lolos |
| 2 | Implementasi lokal selesai | CSV quoted field, registry per server, verify terbatas, rotasi, From, rate/concurrency limit; test mock dan SMTP lokal lolos |
| 3 | Implementasi lokal selesai | Snapshot fsync + rename, lock list/journal, retry terklasifikasi, uncertain, sinyal, resume, cleanup idempotent; test checkpoint failure dan resume lolos |
| 4 | Renderer dan suppression selesai; endpoint eksternal belum | HTML/URL escaping, subject, plain text, preview, tanggal promo, List-Unsubscribe, import suppression tersedia; backend unsubscribe tidak disediakan oleh CLI |
| 5 | Test/CI/dokumentasi lokal selesai; VPS belum | 20 test lolos pada Node.js 22.13 dan 24.11.1, audit dependency nol temuan saat pengecekan; SMTP provider asli, akses port VPS dan penerimaan inbox belum diuji |

Dependency diperbarui: Nodemailer 10.0.15, Faker 10.6.0, csv-parse 7.0.3,
dan dependency transitif lodash. Runtime sekarang membutuhkan Node.js seri 22
mulai 22.13, atau 24+, dan npm 10+. Tidak ada kredensial nyata yang ditambahkan.
Audit tidak menjamin ketiadaan seluruh kerentanan; hasil ini adalah hasil registry
pada saat pengujian, bukan jaminan permanen.

Detail perubahan terhadap rancangan awal:

- Journal menggunakan snapshot JSON atomik, bukan database. Setiap transisi
  ditulis sinkron dan fsync; sesuai daftar moderat, bukan volume sangat besar.
- Rate limit berlaku per sesi, bukan kuota harian lintas campaign.
- Username/password CSV diproses dengan parser CSV resmi. From dinamis tidak
  digunakan: sediakan alamat yang valid dan diizinkan per server.
- Nodemailer pool memakai `maxRequeues=0` agar tidak retry diam-diam. Error socket
  berlabel CONN tidak selalu terjadi sebelum DATA: tanpa bukti gagal sebelum kirim,
  status menjadi uncertain. Pengujian server lokal memutus koneksi sesudah DATA
  dan memastikan hanya satu pesan diterima meski resume dijalankan.
- Auto-remove menyimpan intent cleanup sebelum mengganti list, lalu memeriksa hash
  untuk rekonsiliasi saat resume. Jika ada kemunculan alamat yang belum accepted,
  alamat itu tetap ada dalam daftar. List/journal tidak boleh diedit ketika aktif.
- Resume hanya pending, dengan budget attempt tersimpan. Rejected/uncertain perlu
  peninjauan; aplikasi tidak menyediakan tombol bulk reset yang bisa mengulang accepted.
- Template Ashland memerlukan tanggal akhir promo dan URL unsubscribe tersendiri.
  Identitas/alamat toko contoh tetap harus diganti oleh pengguna. Endpoint harus
  berfungsi di sistem eksternal, dan hasil unsubscribe perlu diimpor ke suppression.
- Header List-Unsubscribe tersedia; handler one-click POST dan sinkronisasi endpoint
  bukan bagian dari implementasi CLI saat ini.

Validasi dilakukan tanpa pengiriman eksternal. Server SMTP pengujian hanya bind
ke 127.0.0.1 dengan sertifikat sementara, menguji TLS langsung, STARTTLS, CA privat,
penolakan sertifikat tidak dipercaya, MIME text/HTML, dan putus koneksi setelah DATA.
CI ditambahkan untuk Node.js 22.13 dan 24; eksekusi CI remote belum dilakukan.

Langkah berikut di lingkungan pengguna:

1. Isi `.env` dan `smtp/servers.csv` dengan server asli, From yang diizinkan,
   dan batas yang sesuai provider. Lindungi file tersebut dengan permission 600.
2. Jalankan dry-run dan tinjau HTML/subject/link; untuk Ashland isi data toko dan
   endpoint unsubscribe asli jika ENABLE_UNSUBSCRIBE=true, lalu siapkan alur impor suppression.
3. Dari VPS, lakukan diagnosis TLS/port dan campaign kecil ke alamat uji milik sendiri.
4. Periksa accepted, inbox/bounce, log provider, dan kemampuan resume sebelum operasi rutin.

## 8. Pembaruan 7 Oktober 2026 — on/off unsubscribe

`ENABLE_UNSUBSCRIBE=true` (default) mempertahankan validasi URL dan header.
`false` menghapus blok `<!-- unsubscribe:start -->` sampai
`<!-- unsubscribe:end -->` dari HTML/teks serta menghilangkan List-Unsubscribe
pada pesan baru. URL tidak diperlukan ketika OFF. Placeholder unsubscribe di luar
blok ketika OFF ditolak agar tidak menghasilkan tautan kosong. Marker yang tidak
berpasangan atau nested juga ditolak. Template Ashland sudah memakai marker.

Suppression tetap aktif pada kedua mode. Resume mempertahankan pesan tersimpan;
perubahan flag tidak mengubah konten/header pekerjaan dari campaign sebelumnya.
Pengujian mencakup kedua mode, header, escaping URL, marker invalid, validasi boolean,
template Ashland tanpa endpoint saat OFF, dan suppression ketika OFF.
Hasil setelah pembaruan: 22 test lolos pada Node.js 24.11.1; diff check lolos.

Status keseluruhan: perbaikan CLI tersedia dan diuji lokal. Belum seluruh fase
operasional selesai: SMTP/VPS/provider nyata dan delivery/bounce belum diverifikasi;
endpoint unsubscribe dan sinkronisasi hasilnya masih menjadi integrasi eksternal
jika fitur ON digunakan. CI remote juga belum dijalankan.

## 9. Pembaruan 7 Oktober 2026 — custom Reply-To

REPLY_TO global tersedia pada single/multiple, dengan override CSV reply_to.
Alamat divalidasi sebelum jaringan; journal juga memvalidasi Reply-To saat resume.
Preview menampilkan konfigurasi server pertama. Pengiriman memilih Reply-To dari
server sehat pertama yang benar-benar dipakai, kemudian menyimpannya agar retry
dan resume tidak mengubah tujuan balasan yang sudah dipilih. From tetap dapat
berganti saat failover, dan history mencatat kedua alamat. Journal lama tanpa
Reply-To tetap didukung.

Untuk satu brand, pilihan yang disarankan adalah mailbox support terpusat yang
aktif menerima email. Untuk brand berbeda, isi override sesuai identitas brand.
Field ini bukan pengganti SPF/DKIM/DMARC dan tidak mengatur tujuan bounce.

## 10. Pembaruan 7 Oktober 2026 — data perangkat Apple

`data/device.txt` diperbarui menjadi 91 model Apple: 46 iPhone (mulai seri 6,
termasuk SE) dan 45 iPad. Merek lain dihapus; label regional/jaringan/kapasitas
digabung menjadi nama model agar tidak memberi bobot tambahan pada model yang sama.
Daftar ini untuk sampling demo, bukan inventaris perangkat yang masih dijual
atau daftar perangkat yang diketahui dimiliki penerima.

Referensi nama model: [Apple iPhone](https://support.apple.com/en-us/108044) dan
[Apple iPad](https://support.apple.com/en-us/108043). Integrasi placeholder tetap
menggunakan `{perangkat}`; file country dan mekanisme renderer tidak diubah.

## 11. Pembaruan 7 Oktober 2026 — cakupan negara dan wilayah

country.txt diperbarui dari 196 menjadi 250 entri unik: seluruh 248 negara/area
dalam tabel berbahasa Inggris [M49 PBB](https://unstats.un.org/unsd/methodology/m49/overview/)
yang diambil saat pembaruan, ditambah Taiwan dan Kosovo. Nama mengikuti referensi
M49, tanpa singkatan lama atau kurung kurawal, dan diurutkan alfabetis.
Palestina hadir sebagai State of Palestine; Vatikan sebagai Holy See.

Cakupan termasuk wilayah/dependensi, tidak dibatasi anggota PBB. Jumlah 250
bukan jumlah negara berdaulat dan tidak mencakup setiap klaim kemerdekaan.
Placeholder negara tetap sampling demo acak; pemeriksaan lokal memastikan
seluruh 248 nama sumber tersedia, tanpa duplikat, dan hasil HTML/teks konsisten.
