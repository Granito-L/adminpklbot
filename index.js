const { Telegraf, Markup } = require('telegraf');
const { google } = require('googleapis');

// 1. Inisialisasi Bot dengan Token dari Environment Variable
const bot = new Telegraf(process.env.BOT_TOKEN);

// 2. Autentikasi Google Sheets API (Jika bot butuh baca data absen)
const getFormattedPrivateKey = () => {
  let key = process.env.GOOGLE_PRIVATE_KEY || '';
  if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);
  return key.replace(/\\n/g, '\n');
};

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: getFormattedPrivateKey(),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

// ── PERINTAH BOT ──────────────────────────────────────────

// Perintah /start
bot.start((ctx) => {
  ctx.reply(
    `Halo ${ctx.from.first_name}! 👋\n\nSelamat datang di *Bot Sistem Absensi PKL*.\nSilakan pilih menu di bawah ini:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🌐 Buka Web Absensi', process.env.WEB_URL || 'https://vercel.com')],
        [Markup.button.callback('📊 Cek Status Absen', 'CEK_ABSEN')],
      ]),
    }
  );
});

// Perintah /help
bot.help((ctx) => {
  ctx.reply(
    '📌 *Panduan Penggunaan Bot:*\n\n' +
    '1. `/start` - Membuka menu utama\n' +
    '2. `/cek [Kelas] [No_Absen]` - Cek riwayat absen (Contoh: `/cek XII_TJKT_1 15`)\n' +
    '3. `/info` - Informasi sistem PKL',
    { parse_mode: 'Markdown' }
  );
});

// Fitur Cek Absen dari Google Sheets (Contoh Perintah /cek)
bot.command('cek', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const kelas = args[1];
  const noAbsen = args[2];

  if (!kelas || !noAbsen) {
    return ctx.reply('⚠️ Format salah! Gunakan format: `/cek [Nama_Tab_Kelas] [No_Absen]`\nContoh: `/cek XII_TJKT_1 15`', { parse_mode: 'Markdown' });
  }

  try {
    ctx.reply('⏳ Mengambil data dari Google Sheets...');
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `'${kelas.replace(/_/g, ' ')}'!A:H`,
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return ctx.reply(`❌ Data untuk kelas ${kelas} tidak ditemukan.`);
    }

    // Cari baris berdasarkan No. Absen
    const dataSiswa = rows.filter(row => row[1] == noAbsen);

    if (dataSiswa.length === 0) {
      return ctx.reply(`❌ Belum ada data absensi untuk No. Absen ${noAbsen} di kelas ${kelas}.`);
    }

    const absenTerakhir = dataSiswa[dataSiswa.length - 1]; // Ambil data paling baru
    const teksBalasan = 
      `📋 *Riwayat Absen Terakhir*\n\n` +
      `👤 *Nama:* ${absenTerakhir[2]}\n` +
      `🕒 *Waktu:* ${absenTerakhir[0]}\n` +
      `📌 *Status:* ${absenTerakhir[3]}\n` +
      `📍 *Alamat:* ${absenTerakhir[4] || 'Tidak ada'}\n` +
      `🖼️ [Lihat Foto Absen](${absenTerakhir[6] || ''})`;

    ctx.replyWithMarkdown(teksBalasan);

  } catch (err) {
    console.error(err);
    ctx.reply('❌ Gagal mengambil data. Pastikan nama kelas benar.');
  }
});

// Jalankan Bot
bot.launch();
console.log('🤖 Bot Telegram Absensi PKL Aktif...');

// Graceful Shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));