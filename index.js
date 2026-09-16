const { Telegraf, Markup, session } = require('telegraf');
const { google } = require('googleapis');
const axios = require('axios');

// Inisialisasi Bot
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Inisialisasi Google Sheets API
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// Database sementara untuk simpan data user (Session)
const userSessions = {};

// Daftar Kelas
const daftarKelas = [
  ['XII PPLG 1', 'XII PPLG 2'],
  ['XII PPLG 3', 'XII PPLG 4'],
  ['XII PPLG 5', 'XII PPLG 6'],
  ['XII PPLG 7', 'XII TJKT 1'],
  ['XII TJKT 2', 'XII TJKT 3'],
  ['XII TJKT 4', 'XII TJKT 5'],
];

// 1. PERINTAH /start (Menampilkan Pilihan Kelas)
bot.start((ctx) => {
  const userId = ctx.from.id;
  userSessions[userId] = userSessions[userId] || {};

  const infoProfil = userSessions[userId].kelas && userSessions[userId].noAbsen
    ? `✅ *Profil Kamu Terdaftar:*\n• Kelas: ${userSessions[userId].kelas}\n• No. Absen: ${userSessions[userId].noAbsen}\n\n_Pilih kelas di bawah jika ingin mengubah profil._`
    : `🤖 *BOT ABSENSI PKL TELKOM SCHOOL*\n\nSilakan pilih kelas kamu di bawah ini untuk memulai registrasi:`;

  const buttons = daftarKelas.map((row) =>
    row.map((k) => Markup.button.callback(k, `set_kelas_${k}`))
  );

  ctx.replyWithMarkdown(infoProfil, Markup.inlineKeyboard(buttons));
});

// 2. TANGKAP PILIHAN KELAS
bot.action(/^set_kelas_/, (ctx) => {
  const userId = ctx.from.id;
  const kelas = ctx.match.input.replace('set_kelas_', '');
  
  userSessions[userId] = userSessions[userId] || {};
  userSessions[userId].kelas = kelas;
  userSessions[userId].step = 'WAITING_NO_ABSEN';

  ctx.answerCbQuery();
  ctx.reply(
    `✅ *Kelas dipilih: ${kelas}*\n\nSekarang ketik *NOMOR ABSEN* kamu (Contoh: 05 atau 12):`,
    { parse_mode: 'Markdown' }
  );
});

// 3. TANGKAP INPUT NOMOR ABSEN & NAMA
bot.on('text', (ctx) => {
  const userId = ctx.from.id;
  const sessionUser = userSessions[userId];

  if (!sessionUser || !sessionUser.step) return;

  if (sessionUser.step === 'WAITING_NO_ABSEN') {
    sessionUser.noAbsen = ctx.message.text.trim();
    sessionUser.step = 'WAITING_NAMA';
    ctx.reply('🎉 *REGISTRASI KELAS BERHASIL!*\n\nSekarang ketik *NAMA LENGKAP* kamu:', { parse_mode: 'Markdown' });
  } else if (sessionUser.step === 'WAITING_NAMA') {
    sessionUser.nama = ctx.message.text.trim();
    sessionUser.step = 'READY_TO_ABSEN';
    
    ctx.reply(
      `🎉 *REGISTRASI BERHASIL!*\n\n👤 *Nama:* ${sessionUser.nama}\n🏫 *Kelas:* ${sessionUser.kelas}\n🔢 *No. Absen:* ${sessionUser.noAbsen}\n\nSekarang, silakan *kirimkan LOKASI (GPS)* kamu lewat tombol attachment Telegram untuk melakukan absensi!`,
      { parse_mode: 'Markdown' }
    );
  }
});

// 4. TANGKAP LOKASI & PROSES SIMPAN KE SHEET + REVERSE GEOCODING
bot.on('location', async (ctx) => {
  const userId = ctx.from.id;
  const sessionUser = userSessions[userId];

  if (!sessionUser || !sessionUser.kelas) {
    return ctx.reply('⚠️ Kamu belum memilih kelas! Ketik /start untuk memilih kelas terlebih dahulu.');
  }

  const msgLoading = await ctx.reply('⏳ *Memproses alamat lokasi & menyimpan ke sheet kelas...*', { parse_mode: 'Markdown' });

  const lat = ctx.message.location.latitude;
  const lon = ctx.message.location.longitude;
  const mapsUrl = `https://maps.google.com/?q=${lat},${lon}`;

  // Ambil Alamat Asli dari Koordinat (OpenStreetMap API Gratis)
  let alamatLengkap = 'Alamat tidak ditemukan';
  try {
    const geoRes = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`, {
      headers: { 'User-Agent': 'TelegramBotAbsensiPKL' }
    });
    alamatLengkap = geoRes.data.display_name || alamatLengkap;
  } catch (err) {
    console.error('Error Reverse Geocode:', err.message);
  }

  // Waktu WIB
  const waktuNow = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  // Simpan ke Google Sheets di Tab Nama Kelas (Misal: XII TJKT 1)
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `'${sessionUser.kelas}'!A:G`, // Masuk otomatis ke Tab Sheet sesuai Kelas
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[waktuNow, sessionUser.noAbsen, sessionUser.nama, 'HADIR', alamatLengkap, mapsUrl]]
      }
    });

    // Hapus pesan loading
    ctx.deleteMessage(msgLoading.message_id).catch(() => {});

    // Balasan Ringkasan Berhasil (Persis Gambar 1)
    const replyText = 
`✅ *ABSENSI BERHASIL!*

📁 *Tab Sheet:* ${sessionUser.kelas}
📅 *Waktu:* ${waktuNow}
📝 *Detail:* ${sessionUser.noAbsen} ${sessionUser.nama} - HADIR
📍 *Alamat:* ${alamatLengkap}
🔗 *Maps:* [Lihat Titik GPS](${mapsUrl})`;

    ctx.replyWithMarkdown(replyText, { disable_web_page_preview: false });

  } catch (err) {
    console.error('Error Sheets:', err);
    ctx.reply(`❌ Gagal menyimpan ke Google Sheets: ${err.message}. Pastikan Tab Sheet bernama "${sessionUser.kelas}" sudah dibuat di Google Sheets kamu!`);
  }
});

// Launch Bot
bot.launch().then(() => console.log('🤖 Bot Absensi PKL Aktif di Railway!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));