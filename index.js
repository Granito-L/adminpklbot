const { Telegraf, Markup } = require('telegraf');
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 1. Inisialisasi Database Lokal (Fix: ReferenceError: db is not defined)
const dbFile = path.join(__dirname, 'users_db.json');
let db = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile)) : {};

function saveDB() {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

// 2. Inisialisasi Bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// 3. Inisialisasi Google Sheets API via Base64
let credentials = {};
if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
  const jsonString = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
  credentials = JSON.parse(jsonString);
} else {
  credentials = {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// 4. Daftar Kelas
const daftarKelas = [
  ['XII PPLG 1', 'XII PPLG 2'],
  ['XII PPLG 3', 'XII PPLG 4'],
  ['XII PPLG 5', 'XII PPLG 6'],
  ['XII PPLG 7', 'XII TJKT 1'],
  ['XII TJKT 2', 'XII TJKT 3'],
  ['XII TJKT 4', 'XII TJKT 5'],
];

// 5. COMMAND /start
bot.start((ctx) => {
  const userId = ctx.from.id;
  
  if (db[userId] && db[userId].nama) {
    return ctx.replyWithMarkdown(
`✅ *PROFIL KAMU SUDAH TERDAFTAR!*

👤 *Nama:* ${db[userId].nama}
🏫 *Kelas:* ${db[userId].kelas}
🔢 *No. Absen:* ${db[userId].noAbsen}

📸 *Cara Absen Hadir:* Langsung kirim **FOTO KEGIATAN** kamu di chat ini!
📝 *Cara Izin/Sakit:* Ketik /izin atau /sakit

_Ketik /reset jika ingin mengubah data diri._`
    );
  }

  const buttons = daftarKelas.map((row) =>
    row.map((k) => Markup.button.callback(k, `reg_kelas_${k}`))
  );

  ctx.replyWithMarkdown(
`🤖 *BOT ABSENSI PKL TELKOM SCHOOL*

Kamu belum terdaftar. Silakan pilih kelas kamu di bawah ini:`,
    Markup.inlineKeyboard(buttons)
  );
});

// ... (Sisa kode bot.command('reset'), bot.action, bot.on('text'), bot.on('photo'), bot.on('location') tetap sama seperti sebelumnya)

bot.launch().then(() => console.log('🤖 Bot Absensi PKL Full Flow Aktif!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));