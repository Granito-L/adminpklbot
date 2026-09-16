const { Telegraf, Markup } = require('telegraf');
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 1. Inisialisasi Bot
const bot = new Telegraf(process.env.BOT_TOKEN);
// Function pembantu buat ngerapihin Private Key secara otomatis
function formatPrivateKey(key) {
  if (!key) return undefined;
  // Hapus tanda petik di awal/akhir kalau keikut
  let formatted = key.replace(/^"(.*)"$/, '$1');
  // Ubah literal \n jadi newline asli jika belum terkonversi
  formatted = formatted.replace(/\\n/g, '\n');
  return formatted;
}

// Inisialisasi Google Sheets API via Base64 (Anti-Error Decoder)
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

// 6. COMMAND RESET PROFIL
bot.command('reset', (ctx) => {
  const userId = ctx.from.id;
  delete db[userId];
  saveDB();
  ctx.reply('🔄 Profil berhasil di-reset. Ketik /start untuk mendaftar ulang.');
});

// 7. COMMAND /izin & /sakit
bot.command('izin', (ctx) => {
  const userId = ctx.from.id;
  if (!db[userId] || !db[userId].nama) return ctx.reply('⚠️ Kamu belum daftar profil! Ketik /start dulu.');
  
  db[userId].step = 'WAITING_ALASAN_IZIN';
  saveDB();
  ctx.reply('📝 Silakan ketik *ALASAN IZIN* kamu:', { parse_mode: 'Markdown' });
});

bot.command('sakit', (ctx) => {
  const userId = ctx.from.id;
  if (!db[userId] || !db[userId].nama) return ctx.reply('⚠️ Kamu belum daftar profil! Ketik /start dulu.');
  
  db[userId].step = 'WAITING_ALASAN_SAKIT';
  saveDB();
  ctx.reply('🤒 Silakan ketik *ALASAN SAKIT* kamu (dan melampirkan surat/keterangan):', { parse_mode: 'Markdown' });
});

// 8. PROCESS REGISTRASI KELAS
bot.action(/^reg_kelas_/, (ctx) => {
  const userId = ctx.from.id;
  const kelas = ctx.match.input.replace('reg_kelas_', '');

  db[userId] = db[userId] || {};
  db[userId].kelas = kelas;
  db[userId].step = 'WAITING_NO_ABSEN';
  saveDB();

  ctx.answerCbQuery();
  ctx.reply(`✅ *Kelas dipilih: ${kelas}*\n\nSekarang ketik *NOMOR ABSEN* kamu (Contoh: 05 atau 12):`, { parse_mode: 'Markdown' });
});

// 9. PROCESS TEXT INPUT (NO ABSEN, NAMA, ALASAN)
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const user = db[userId];
  if (!user || !user.step) return;

  const text = ctx.message.text.trim();

  if (user.step === 'WAITING_NO_ABSEN') {
    user.noAbsen = text;
    user.step = 'WAITING_NAMA';
    saveDB();
    ctx.reply('Sekarang ketik *NAMA LENGKAP* kamu:', { parse_mode: 'Markdown' });
  } 
  else if (user.step === 'WAITING_NAMA') {
    user.nama = text;
    user.step = 'IDLE';
    saveDB();
    ctx.replyWithMarkdown(
`🎉 *REGISTRASI BERHASIL!*

👤 *Nama:* ${user.nama}
🏫 *Kelas:* ${user.kelas}
🔢 *No. Absen:* ${user.noAbsen}

📸 Silakan langsung kirim *FOTO KEGIATAN* kamu di chat ini untuk melakukan Absensi Hadir!`
    );
  }
  else if (user.step === 'WAITING_ALASAN_IZIN' || user.step === 'WAITING_ALASAN_SAKIT') {
    const status = user.step === 'WAITING_ALASAN_IZIN' ? 'IZIN' : 'SAKIT';
    user.step = 'IDLE';
    saveDB();

    const waktuNow = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `'${user.kelas}'!A:G`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[waktuNow, user.noAbsen, user.nama, status, `Alasan: ${text}`, '-', '-']]
        }
      });
      ctx.reply(`✅ *BERHASIL DICATAT!*\n\nStatus: *${status}*\nAlasan: ${text}`, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply(`❌ Gagal menyimpan ke Sheets: ${err.message}`);
    }
  }
});

// 10. PROCESS FOTO KEGIATAN
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const user = db[userId];

  if (!user || !user.nama) {
    return ctx.reply('⚠️ Kamu belum terdaftar! Ketik /start terlebih dahulu.');
  }

  const msgLoading = await ctx.reply('⏳ *Memproses foto kegiatan...*', { parse_mode: 'Markdown' });

  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);

    user.tempFotoUrl = fileLink.href;
    user.tempCaption = ctx.message.caption || 'Kegiatan PKL';
    user.step = 'WAITING_LOCATION';
    saveDB();

    ctx.deleteMessage(msgLoading.message_id).catch(() => {});
    ctx.reply(
      `📸 *Foto Berhasil Diterima!*\n\nSekarang, silakan *Share Current Location (GPS)* kamu lewat menu attachment Telegram untuk menyelesaikan absensi.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    ctx.reply(`❌ Gagal memproses foto: ${err.message}`);
  }
});

// 11. PROCESS LOKASI & REKAP KESELURUHAN
bot.on('location', async (ctx) => {
  const userId = ctx.from.id;
  const user = db[userId];

  if (!user || user.step !== 'WAITING_LOCATION') {
    return ctx.reply('⚠️ Silakan kirim foto kegiatan terlebih dahulu sebelum mengirim lokasi.');
  }

  const msgLoading = await ctx.reply('⏳ *Memproses alamat lokasi & menyimpan ke sheet kelas...*', { parse_mode: 'Markdown' });

  const lat = ctx.message.location.latitude;
  const lon = ctx.message.location.longitude;
  const mapsUrl = `https://maps.google.com/?q=${lat},${lon}`;

  let alamatLengkap = 'Alamat tidak ditemukan';
  try {
    const geoRes = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`, {
      headers: { 'User-Agent': 'TelegramBotAbsensiPKL' }
    });
    alamatLengkap = geoRes.data.display_name || alamatLengkap;
  } catch (err) {
    console.error('Geo Error:', err.message);
  }

  const waktuNow = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `'${user.kelas}'!A:G`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[waktuNow, user.noAbsen, user.nama, `HADIR (${user.tempCaption})`, alamatLengkap, mapsUrl, user.tempFotoUrl]]
      }
    });

    user.step = 'IDLE';
    saveDB();

    ctx.deleteMessage(msgLoading.message_id).catch(() => {});

    const replyText = 
`✅ *ABSENSI BERHASIL!*

📁 *Tab Sheet:* ${user.kelas}
📅 *Waktu:* ${waktuNow}
📝 *Detail:* ${user.noAbsen} ${user.nama} - HADIR
📌 *Kegiatan:* ${user.tempCaption}
📍 *Alamat:* ${alamatLengkap}
🔗 *Maps:* [Lihat Titik GPS](${mapsUrl})
🖼️ *Foto:* [Lihat Bukti Foto](${user.tempFotoUrl})`;

    ctx.replyWithMarkdown(replyText, { disable_web_page_preview: false });

  } catch (err) {
    ctx.reply(`❌ Gagal menyimpan ke Google Sheets: ${err.message}`);
  }
});

// Launch Bot
bot.launch().then(() => console.log('🤖 Bot Absensi PKL Aktif di Railway!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));