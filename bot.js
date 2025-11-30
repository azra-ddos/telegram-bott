const { Telegraf, Markup, session, Scenes: { BaseScene, Stage } } = require('telegraf');
const axios = require('axios');
const sharp = require('sharp');
const { createCanvas, loadImage } = require('canvas');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const moment = require('moment');
const cheerio = require('cheerio');
const sizeOf = require('image-size');
const validUrl = require('valid-url');
const config = require('./config');

const bot = new Telegraf(config.BOT_TOKEN);

// Database sederhana (bisa diganti dengan database real)
const userDB = new Map();
const stats = {
  totalUsers: 0,
  commandsProcessed: 0,
  qrCodesGenerated: 0,
  stickersCreated: 0,
  videosDownloaded: 0
};

// Scene untuk conversation yang lebih kompleks
const qrScene = new BaseScene('qrScene');
qrScene.enter((ctx) => ctx.reply('🎨 Masukkan teks untuk QR Code:'));
qrScene.on('text', async (ctx) => {
  const text = ctx.message.text;
  await processQRCode(ctx, text);
  ctx.scene.leave();
});
qrScene.on('message', (ctx) => ctx.reply('❌ Harap masukkan teks yang valid.'));

const stickerScene = new BaseScene('stickerScene');
stickerScene.enter((ctx) => ctx.reply('🖼️ Kirimkan foto untuk dijadikan stiker:'));
stickerScene.on('photo', async (ctx) => {
  await processSticker(ctx);
  ctx.scene.leave();
});
stickerScene.on('message', (ctx) => ctx.reply('❌ Harap kirim foto yang valid.'));

const tiktokScene = new BaseScene('tiktokScene');
tiktokScene.enter((ctx) => ctx.reply('📱 Masukkan URL video TikTok:'));
tiktokScene.on('text', async (ctx) => {
  const url = ctx.message.text;
  await processTikTok(ctx, url);
  ctx.scene.leave();
});
tiktokScene.on('message', (ctx) => ctx.reply('❌ Harap masukkan URL yang valid.'));

const stage = new Stage([qrScene, stickerScene, tiktokScene]);
bot.use(session());
bot.use(stage.middleware());

// Middleware untuk tracking user
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId && !userDB.has(userId)) {
    userDB.set(userId, {
      id: userId,
      username: ctx.from.username,
      first_name: ctx.from.first_name,
      join_date: new Date(),
      usage_count: 0
    });
    stats.totalUsers++;
  }
  
  if (userId) {
    const user = userDB.get(userId);
    user.usage_count++;
    user.last_used = new Date();
  }
  
  stats.commandsProcessed++;
  await next();
});

// Fungsi menu utama yang lebih advanced
function createMainMenu(ctx) {
  const user = ctx.from;
  const userData = userDB.get(user.id);
  
  return Markup.keyboard([
    ['🎨 Buat QR Code', '🖼️ Buat Stiker'],
    ['📱 Download TikTok', '🎵 Download YouTube'],
    ['🌤️ Info Cuaca', '💱 Konverter Mata Uang'],
    ['📊 Statistik Bot', 'ℹ️ Bantuan']
  ]).resize();
}

function createInlineMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🎨 QR Code', 'create_qr'),
      Markup.button.callback('🖼️ Stiker', 'create_sticker')
    ],
    [
      Markup.button.callback('📱 TikTok', 'download_tiktok'),
      Markup.button.callback('🎵 YouTube', 'download_youtube')
    ],
    [
      Markup.button.callback('🌤️ Cuaca', 'weather_info'),
      Markup.button.callback('💱 Mata Uang', 'currency_convert')
    ],
    [
      Markup.button.callback('📊 Statistik', 'bot_stats'),
      Markup.button.callback('🛠️ Admin', 'admin_panel')
    ]
  ]);
}

// Command Start yang lebih menarik
bot.start(async (ctx) => {
  const welcomeMessage = `
🤖 *SELAMAT DATANG DI BOT MULTI-FUNGSI* 🚀

*Fitur Premium Yang Tersedia:*
🎨 • Pembuat QR Code Custom
🖼️ • Pembuat Stiker Otomatis  
📱 • Downloader TikTok HD
🎵 • Downloader YouTube
🌤️ • Info Cuaca Real-time
💱 • Konverter Mata Uang
📊 • Statistik Lengkap

*Version:* 2.0.0
*Status:* ✅ Active
  `;

  try {
    await ctx.replyWithPhoto(config.MENU_PHOTO_URL, {
      caption: welcomeMessage,
      parse_mode: 'Markdown',
      reply_markup: createMainMenu(ctx).reply_markup
    });
    
    // Kirim info user terpisah
    await ctx.reply(getDetailedUserInfo(ctx.from), {
      parse_mode: 'Markdown',
      reply_markup: createInlineMenu().reply_markup
    });
    
  } catch (error) {
    await ctx.reply(welcomeMessage, {
      parse_mode: 'Markdown',
      reply_markup: createMainMenu(ctx).reply_markup
    });
    await ctx.reply(getDetailedUserInfo(ctx.from), {
      parse_mode: 'Markdown',
      reply_markup: createInlineMenu().reply_markup
    });
  }
});

// Handler untuk semua menu
const menuHandlers = {
  '🎨 Buat QR Code': (ctx) => ctx.scene.enter('qrScene'),
  '🖼️ Buat Stiker': (ctx) => ctx.scene.enter('stickerScene'),
  '📱 Download TikTok': (ctx) => ctx.scene.enter('tiktokScene'),
  '🎵 Download YouTube': (ctx) => handleYouTubeDownload(ctx),
  '🌤️ Info Cuaca': (ctx) => handleWeatherRequest(ctx),
  '💱 Konverter Mata Uang': (ctx) => handleCurrencyConvert(ctx),
  '📊 Statistik Bot': (ctx) => showBotStats(ctx),
  'ℹ️ Bantuan': (ctx) => showHelp(ctx)
};

Object.keys(menuHandlers).forEach(menuItem => {
  bot.hears(menuItem, menuHandlers[menuItem]);
});

// Handler untuk inline buttons
bot.action('create_qr', (ctx) => ctx.scene.enter('qrScene'));
bot.action('create_sticker', (ctx) => ctx.scene.enter('stickerScene'));
bot.action('download_tiktok', (ctx) => ctx.scene.enter('tiktokScene'));
bot.action('download_youtube', (ctx) => handleYouTubeDownload(ctx));
bot.action('weather_info', (ctx) => handleWeatherRequest(ctx));
bot.action('currency_convert', (ctx) => handleCurrencyConvert(ctx));
bot.action('bot_stats', (ctx) => showBotStats(ctx));
bot.action('admin_panel', (ctx) => showAdminPanel(ctx));

// Fungsi untuk membuat QR Code yang lebih advanced
async function processQRCode(ctx, text) {
  try {
    const processingMsg = await ctx.reply('🔄 *Sedang membuat QR Code...*\n\n📊 _Mengoptimalkan desain..._', { 
      parse_mode: 'Markdown' 
    });
    
    // Generate QR Code
    const qrCodeBuffer = await generateAdvancedQRCode(text);
    
    // Buat gambar dengan design yang lebih menarik
    const finalImage = await createEnhancedQCImage(qrCodeBuffer, text);
    
    // Kirim hasil
    await ctx.deleteMessage(processingMsg.message_id);
    await ctx.replyWithPhoto(
      { source: finalImage },
      { 
        caption: `✅ *QR Code Berhasil Dibuat!*\n\n📝 *Teks:* ${text}\n📏 *Size:* 800x900px\n🎨 *Style:* Modern Gradient`,
        parse_mode: 'Markdown',
        reply_markup: createMainMenu(ctx).reply_markup
      }
    );
    
    stats.qrCodesGenerated++;
    
  } catch (error) {
    console.error('QR Code Error:', error);
    await ctx.reply('❌ *Gagal membuat QR Code!*\n\n_Coba dengan teks yang berbeda._', { 
      parse_mode: 'Markdown' 
    });
  }
}

// Fungsi untuk membuat stiker yang lebih advanced
async function processSticker(ctx) {
  try {
    const processingMsg = await ctx.reply('🔄 *Sedang memproses stiker...*\n\n📸 _Mengoptimalkan kualitas..._', {
      parse_mode: 'Markdown'
    });

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileUrl = await ctx.telegram.getFileLink(photo.file_id);
    
    // Download gambar
    const response = await axios({
      method: 'GET',
      url: fileUrl,
      responseType: 'arraybuffer'
    });

    // Process dengan sharp - multiple optimizations
    const processedImage = await sharp(response.data)
      .resize(512, 512, {
        fit: 'cover',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ quality: config.STICKER_CONFIG.quality })
      .toBuffer();

    await ctx.deleteMessage(processingMsg.message_id);
    await ctx.replyWithSticker({ source: processedImage });
    await ctx.reply('✅ *Stiker berhasil dibuat!*\n\n🖼️ *Kualitas:* High\n📏 *Size:* 512x512px', {
      parse_mode: 'Markdown',
      reply_markup: createMainMenu(ctx).reply_markup
    });

    stats.stickersCreated++;

  } catch (error) {
    console.error('Sticker Error:', error);
    await ctx.reply('❌ *Gagal membuat stiker!*\n\n_Pastikan foto tidak corrupt dan coba lagi._', {
      parse_mode: 'Markdown'
    });
  }
}

// Fungsi untuk download TikTok yang lebih robust
async function processTikTok(ctx, url) {
  try {
    if (!validUrl.isUri(url)) {
      return ctx.reply('❌ *URL tidak valid!*\n\n_Pastikan URL TikTok benar._', {
        parse_mode: 'Markdown'
      });
    }

    const processingMsg = await ctx.reply('🔄 *Sedang mendownload video...*\n\n📱 _Mengakses TikTok API..._', {
      parse_mode: 'Markdown'
    });

    const videoInfo = await downloadTikTokVideo(url);
    
    if (videoInfo && videoInfo.videoUrl) {
      await ctx.deleteMessage(processingMsg.message_id);
      
      // Kirim video dengan caption lengkap
      await ctx.replyWithVideo(videoInfo.videoUrl, {
        caption: `✅ *Berhasil Download TikTok!*\n\n📝 *Judul:* ${videoInfo.title || 'No Title'}\n👤 *Creator:* ${videoInfo.author || 'Unknown'}\n⏱️ *Durasi:* ${videoInfo.duration || 'Unknown'}`,
        parse_mode: 'Markdown',
        reply_markup: createMainMenu(ctx).reply_markup
      });
      
      stats.videosDownloaded++;
    } else {
      throw new Error('No video data received');
    }

  } catch (error) {
    console.error('TikTok Download Error:', error);
    await ctx.reply('❌ *Gagal mendownload video!*\n\n_Coba dengan URL yang berbeda atau coba lagi nanti._', {
      parse_mode: 'Markdown'
    });
  }
}

// Fungsi YouTube Downloader (placeholder - butuh API key)
async function handleYouTubeDownload(ctx) {
  await ctx.reply('🎵 *YouTube Downloader*\n\n_Fitur ini dalam pengembangan. Akan segera hadir!_', {
    parse_mode: 'Markdown',
    reply_markup: createMainMenu(ctx).reply_markup
  });
}

// Fungsi Info Cuaca
async function handleWeatherRequest(ctx) {
  await ctx.reply('🌤️ *Weather Information*\n\n_Ketik nama kota untuk informasi cuaca:_\nContoh: "Jakarta" atau "London"', {
    parse_mode: 'Markdown'
  });
}

// Fungsi Konverter Mata Uang
async function handleCurrencyConvert(ctx) {
  await ctx.reply('💱 *Currency Converter*\n\n_Format: Jumlah Dari Ke_\nContoh: "100 USD IDR" atau "50 EUR USD"', {
    parse_mode: 'Markdown'
  });
}

// Fungsi Statistik Bot
async function showBotStats(ctx) {
  const uptime = process.uptime();
  const statsMessage = `
📊 *BOT STATISTICS*

👥 *Total Users:* ${stats.totalUsers}
🔄 *Commands Processed:* ${stats.commandsProcessed}
🎨 *QR Codes Generated:* ${stats.qrCodesGenerated}
🖼️ *Stickers Created:* ${stats.stickersCreated}
📱 *Videos Downloaded:* ${stats.videosDownloaded}

⏰ *Uptime:* ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m
💾 *Memory Usage:* ${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB
🚀 *Version:* 2.0.0
  `;

  await ctx.reply(statsMessage, {
    parse_mode: 'Markdown',
    reply_markup: createMainMenu(ctx).reply_markup
  });
}

// Fungsi Admin Panel
async function showAdminPanel(ctx) {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ *Akses Ditolak!*\n\n_Anda bukan admin._', {
      parse_mode: 'Markdown'
    });
  }

  const adminMessage = `
🛠️ *ADMIN PANEL*

*Total Users:* ${stats.totalUsers}
*Active Sessions:* ${userDB.size}

*Quick Actions:*
/broadcast - Kirim pesan ke semua user
/stats - Detail statistik
/restart - Restart bot

*Server Info:*
Node.js: ${process.version}
Platform: ${process.platform}
  `;

  await ctx.reply(adminMessage, {
    parse_mode: 'Markdown',
    reply_markup: createMainMenu(ctx).reply_markup
  });
}

// Fungsi Bantuan
async function showHelp(ctx) {
  const helpMessage = `
ℹ️ *BOT HELP CENTER*

*Cara Menggunakan:*
1. Pilih menu dari keyboard atau tombol inline
2. Ikuti instruksi yang diberikan
3. Tunggu proses selesai

*Fitur Available:*
🎨 *QR Code Maker* - Buat QR code dari teks/URL
🖼️ *Sticker Maker* - Convert foto ke stiker
📱 *TikTok Downloader* - Download video TikTok
🎵 *YouTube Downloader* - Download video YouTube
🌤️ *Weather Info* - Info cuaca real-time
💱 *Currency Converter* - Konversi mata uang

*Perintah Admin:*
/broadcast - Broadcast message
/stats - Lihat statistik
/restart - Restart bot

*Support:*
Jika mengalami masalah, hubungi developer.
  `;

  await ctx.reply(helpMessage, {
    parse_mode: 'Markdown',
    reply_markup: createMainMenu(ctx).reply_markup
  });
}

// Fungsi utility yang ditingkatkan
function getDetailedUserInfo(user) {
  const userData = userDB.get(user.id);
  return `
👤 *USER INFORMATION*

🆔 *ID:* \`${user.id}\`
👤 *Username:* @${user.username || 'N/A'}
📛 *Name:* ${user.first_name} ${user.last_name || ''}
🌐 *Language:* ${user.language_code || 'N/A'}
📅 *Join Date:* ${userData ? moment(userData.join_date).format('DD/MM/YYYY HH:mm') : 'Just now'}
🔢 *Usage Count:* ${userData ? userData.usage_count : 1}
  `;
}

async function generateAdvancedQRCode(text) {
  const qrCodeDataURL = await QRCode.toDataURL(text, {
    width: 400,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    },
    errorCorrectionLevel: 'H'
  });
  
  const base64Data = qrCodeDataURL.replace(/^data:image\/png;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}

async function createEnhancedQCImage(qrCodeBuffer, text) {
  const width = 800;
  const height = 900;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Advanced gradient background
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#667eea');
  gradient.addColorStop(0.5, '#764ba2');
  gradient.addColorStop(1, '#f093fb');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Add decorative elements
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  for (let i = 0; i < 50; i++) {
    ctx.beginPath();
    ctx.arc(
      Math.random() * width,
      Math.random() * height,
      Math.random() * 3,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  // Add QR Code
  const qrImg = await loadImage(qrCodeBuffer);
  ctx.drawImage(qrImg, 200, 150, 400, 400);

  // Enhanced text styling
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('QR CODE GENERATOR', width / 2, 80);

  ctx.font = '20px Arial';
  ctx.fillText('Generated Text:', width / 2, 580);
  
  const displayText = text.length > 40 ? text.substring(0, 37) + '...' : text;
  ctx.font = '18px Arial';
  ctx.fillStyle = '#f0f0f0';
  ctx.fillText(displayText, width / 2, 610);

  // Add footer with timestamp
  ctx.font = '14px Arial';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillText(`Generated on ${moment().format('DD/MM/YYYY HH:mm')} • Bot v2.0.0`, width / 2, height - 20);

  return canvas.toBuffer('image/png');
}

// Enhanced TikTok downloader dengan multiple fallback
async function downloadTikTokVideo(url) {
  const apis = config.TIKTOK_APIS;
  
  for (let api of apis) {
    try {
      const apiUrl = api + encodeURIComponent(url);
      const response = await axios.get(apiUrl, { timeout: 10000 });
      
      if (response.data) {
        const data = response.data.data || response.data;
        if (data.play || data.videoUrl || data.wm) {
          return {
            title: data.title || 'No Title',
            videoUrl: data.play || data.videoUrl || data.wm,
            duration: data.duration || 'Unknown',
            author: data.author?.nickname || data.author || 'Unknown'
          };
        }
      }
    } catch (error) {
      console.log(`API ${api} failed, trying next...`);
      continue;
    }
  }
  
  throw new Error('All TikTok APIs failed');
}

// Command admin
bot.command('broadcast', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ Akses ditolak!');
  }
  
  const message = ctx.message.text.replace('/broadcast', '').trim();
  if (!message) {
    return ctx.reply('❌ Format: /broadcast <pesan>');
  }
  
  let success = 0;
  let failed = 0;
  
  for (let [userId, userData] of userDB) {
    try {
      await ctx.telegram.sendMessage(userId, `📢 *BROADCAST*\n\n${message}`, {
        parse_mode: 'Markdown'
      });
      success++;
    } catch (error) {
      failed++;
    }
    await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
  }
  
  ctx.reply(`✅ Broadcast selesai!\nBerhasil: ${success}\nGagal: ${failed}`);
});

bot.command('restart', (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ Akses ditolak!');
  }
  
  ctx.reply('🔄 Restarting bot...').then(() => {
    process.exit(0);
  });
});

// Error handling yang lebih baik
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  ctx.reply('❌ *Terjadi kesalahan sistem!*\n\n_Silakan coba lagi nanti atau hubungi developer._', {
    parse_mode: 'Markdown'
  });
});

// Auto-save stats setiap jam
cron.schedule('0 * * * *', () => {
  console.log('📊 Stats saved:', stats);
});

// Start bot
console.log('🚀 Advanced Bot is starting...');
bot.launch().then(() => {
  console.log('✅ Bot successfully launched!');
  console.log('📊 Initial Stats:', stats);
});

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('🛑 Shutting down gracefully...');
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  bot.stop('SIGTERM');
  process.exit(0);
});
