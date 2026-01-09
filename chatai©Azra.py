#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# azra-x.py ©by azra

import asyncio
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional, Set
import aiohttp
from telegram import (
    Update, 
    InlineKeyboardButton, 
    InlineKeyboardMarkup, 
    InputFile
)
from telegram.ext import (
    Application, 
    CommandHandler, 
    CallbackQueryHandler, 
    MessageHandler, 
    filters, 
    ContextTypes
)
from telegram.constants import ParseMode

# ==================== KONFIGURASI AWAL ====================
# --- ADMIN SETTINGS ---
ADMIN_IDS = [7959551372]  # Ganti dengan ID Telegram kamu
BOT_TOKEN = "8530059653:AAGbdrmnedNbOc5PRUDgrM2AU6finnAeeV0"  # Ganti dengan token botmu

# --- GROQ DEFAULT SETTINGS ---
DEFAULT_API_KEY = "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"  # API key default
AVAILABLE_MODELS = [
    "openai/gpt-oss-120b",
    "mixtral-8x7b-32768",
    "llama2-70b-4096",
    "gemma-7b-it",
    "deepseek-llm-67b-chat",
    "llama-3-70b-8192",
    "qwen-2.5-32b",
    "claude-3-haiku-20240307"
]

# --- CUSTOM PROMPT SETTINGS ---
DEFAULT_SYSTEM_PROMPT = """Kamu adalah AZRA-X yang telah diciptakan oleh tim cyber local yaitu AZRA-AI. 
Dan kamu harus melayani user dengan ramah dan baik dan kamu juga harus mengikuti sikap user seperti misal nya sikap user ramah maka kamu juga harus ramah dan jika sikap user gaul maka kamu juga harus gaul dan semacamnya tanpa memberi tahu mereka kalo kamu sudah make bahasa gaul atau kalo kamu udh ngikutin sikap mereka saya tidak mau seperti itu, 
dan saat ada yang bertanya siapa pencipta mu? dan semacamnya maka jawab saya di ciptakan oleh tim cyber yang bernama AZRA-AI, 
dan saya ada yang bertanya kapan kamu di ciptakan? dan semacamnya maka kamu jawab saya di ciptakan oleh tim cyber yang bernama AZRA-AI dan saya di ciptakan pada 30/12/25. 
Dan saat user meminta kamu untuk membuat code maka buat code nya semenarik mungkin dan kompleks sebisa kamu."""

# --- MEDIA SETTINGS ---
DEFAULT_LOGO_URL = "https://azraa-x.vercel.app"  # URL logo default

# --- STATE MANAGEMENT ---
class BotConfig:
    def __init__(self):
        self.api_key = DEFAULT_API_KEY
        self.logo_url = DEFAULT_LOGO_URL
        self.available_models = AVAILABLE_MODELS.copy()
        self.active_model = AVAILABLE_MODELS[0]  # Model aktif untuk semua user
        self.system_prompt = DEFAULT_SYSTEM_PROMPT
        self.admins = ADMIN_IDS.copy()
        self.user_sessions = {}  # user_id: {"active": True, "last_active": timestamp}
        self.locked_users = set()  # user_id yang diblokir
        self.admin_broadcast_mode = {}  # admin_id: {"mode": False, "message": ""}
        self.start_history = []  # History user yang pernah start
        
    def save_config(self):
        """Simpan konfigurasi ke memori"""
        config_data = {
            "api_key": self.api_key,
            "logo_url": self.logo_url,
            "active_model": self.active_model,
            "system_prompt": self.system_prompt,
            "admins": self.admins,
            "locked_users": list(self.locked_users),
            "start_history": self.start_history
        }
        # Untuk produksi, simpan ke file/database
        # with open("config.json", "w") as f:
        #     json.dump(config_data, f)
        return True

config = BotConfig()
# ==========================================================

# Setup logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# ==================== UTILITY FUNCTIONS ====================
async def download_image(url: str) -> Optional[bytes]:
    """Download gambar dari URL"""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status == 200:
                    return await response.read()
    except Exception as e:
        logger.error(f"Error downloading image: {e}")
    return None

async def call_groq_api(prompt: str, system_prompt: str = None) -> str:
    """Panggil API Groq dengan timeout lebih lama untuk code kompleks"""
    if not config.api_key or config.api_key.startswith("gsk_YOUR"):
        return "❌ API Key belum dikonfigurasi. Admin harap setting API Key terlebih dahulu."
    
    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Content-Type": "application/json"
    }
    
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    
    payload = {
        "messages": messages,
        "model": config.active_model,
        "temperature": 0.7,
        "max_tokens": 8192,  # Token lebih banyak untuk code panjang
        "top_p": 1,
        "stream": False
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=60  # Timeout lebih lama untuk code kompleks
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    return data["choices"][0]["message"]["content"]
                else:
                    error_text = await response.text()
                    logger.error(f"API Error: {error_text}")
                    return f"❌ Error dari API: {response.status}"
    except asyncio.TimeoutError:
        return "⏰ Timeout menghubungi AI. Silakan coba lagi dengan request yang lebih singkat."
    except Exception as e:
        logger.error(f"API call error: {e}")
        return f"❌ Error: {str(e)}"

def create_code_block(text: str, language: str = "") -> str:
    """Format teks menjadi code block dengan copy button"""
    escaped = text.replace("`", "\\`")
    return f"```{language}\n{escaped}\n```"

def is_admin(user_id: int) -> bool:
    """Cek apakah user adalah admin"""
    return user_id in config.admins

def is_user_active(user_id: int) -> bool:
    """Cek apakah user sudah start dan aktif"""
    return user_id in config.user_sessions and config.user_sessions[user_id].get("active", False)

def is_user_locked(user_id: int) -> bool:
    """Cek apakah user diblokir"""
    return user_id in config.locked_users

def format_message_for_display(text: str) -> str:
    """Format pesan agar mudah dibaca"""
    # Tambah formatting untuk readability
    formatted = text
    
    # Deteksi kode dan format
    code_keywords = ["def ", "class ", "import ", "function ", "const ", "let ", "var ", "<html", "<script", "<?php"]
    has_code = any(keyword in formatted.lower() for keyword in code_keywords)
    
    if has_code and "```" not in formatted:
        # Coba detect bahasa
        language = ""
        if "python" in text.lower() or "def " in text or "import " in text:
            language = "python"
        elif "javascript" in text.lower() or "function " in text or "const " in text:
            language = "javascript"
        elif "html" in text.lower() or "<html" in text:
            language = "html"
        elif "css" in text.lower() or "{" in text and "}" in text and ":" in text:
            language = "css"
        
        if language:
            formatted = create_code_block(formatted, language)
    
    return formatted

async def send_start_notification_to_admins(user_info: dict):
    """Kirim notifikasi ke semua admin saat user start bot"""
    notification = f"""
🆕 **USER BARU START BOT** 🆕

👤 **User Info:**
├─ 🆔 ID: `{user_info['id']}`
├─ 📛 Nama: {user_info['name']}
├─ 📱 Username: @{user_info.get('username', 'N/A')}
└─ 📅 Waktu: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}

📊 **Statistik:**
├─ 👥 Total User: {len(config.user_sessions)}
├─ 🔒 Locked Users: {len(config.locked_users)}
└─ 🏁 Total Start: {len(config.start_history)}

✨ *Selamat datang user baru!* ✨
"""
    
    for admin_id in config.admins:
        try:
            await application.bot.send_message(
                chat_id=admin_id,
                text=notification,
                parse_mode=ParseMode.MARKDOWN
            )
        except Exception as e:
            logger.error(f"Failed to send notification to admin {admin_id}: {e}")

# ==================== TELEGRAM HANDLERS ====================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start command"""
    user_id = update.effective_user.id
    username = update.effective_user.username or update.effective_user.first_name
    
    # Cek jika user diblokir
    if is_user_locked(user_id):
        await update.message.reply_text(
            "🚫 **ANDA TELAH DI BLOCK OLEH ADMIN.**\n\n©Dev by azra"
        )
        return
    
    # Jika admin, langsung ke menu admin tanpa session check
    if is_admin(user_id):
        await show_admin_menu(update, context)
        return
    
    # Untuk user biasa, cek session
    if not is_user_active(user_id):
        # Aktifkan session user
        config.user_sessions[user_id] = {
            "active": True,
            "last_active": datetime.now().timestamp(),
            "name": update.effective_user.first_name,
            "username": update.effective_user.username
        }
        
        # Simpan ke history
        config.start_history.append({
            "id": user_id,
            "name": update.effective_user.first_name,
            "username": update.effective_user.username,
            "timestamp": datetime.now().isoformat()
        })
        
        # Kirim notifikasi ke admin
        user_info = {
            "id": user_id,
            "name": update.effective_user.first_name,
            "username": update.effective_user.username or "N/A"
        }
        await send_start_notification_to_admins(user_info)
    
    await show_user_menu(update, context)

async def show_user_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Tampilkan menu utama untuk user"""
    user_id = update.effective_user.id
    
    # Download dan kirim logo
    logo_bytes = await download_image(config.logo_url)
    
    welcome_text = f"""
👋 **Halo {update.effective_user.first_name}!**

✨ *Selamat datang di AZRA-X AI Assistant* ✨

Saya siap membantu Anda dengan berbagai kebutuhan:
• 💬 Chat dan konsultasi
• 💻 Buat kode program
• 📝 Bantu tugas dan pekerjaan
• 🎨 Ide kreatif dan solusi

🚀 **Cara Pakai:**
Cukup kirim pesan langsung, saya akan merespons!

📌 **Tips:**
• Untuk kode, sebutkan bahasa yang diinginkan
• Jelaskan kebutuhan dengan jelas
• Saya akan mengikuti gaya bicara Anda

💡 *Mulai chatting sekarang!* 😊
"""
    
    try:
        if logo_bytes:
            await update.message.reply_photo(
                photo=logo_bytes,
                caption=welcome_text,
                parse_mode=ParseMode.MARKDOWN
            )
        else:
            await update.message.reply_text(
                welcome_text,
                parse_mode=ParseMode.MARKDOWN
            )
    except:
        await update.message.reply_text(
            welcome_text,
            parse_mode=ParseMode.MARKDOWN
        )

async def show_admin_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Tampilkan menu admin yang canggih"""
    admin_menu = f"""
⚡ **AZRA-X ADMIN PANEL** ⚡

*📊 System Status:*
├─ 🤖 Active Model: `{config.active_model}`
├─ 🔑 API Key: {'✅ Configured' if len(config.api_key) > 30 else '❌ Not Set'}
├─ 👥 Active Users: {len([u for u in config.user_sessions if config.user_sessions[u].get('active', False)])}
├─ 🔒 Locked Users: {len(config.locked_users)}
└─ 📈 Total Starts: {len(config.start_history)}

*🛠️ Quick Actions Menu:*
"""
    
    keyboard = [
        [InlineKeyboardButton("📡 Broadcast Message", callback_data="admin_broadcast")],
        [InlineKeyboardButton("🤖 Change AI Model", callback_data="admin_model")],
        [InlineKeyboardButton("🔑 Update API Key", callback_data="admin_apikey")],
        [InlineKeyboardButton("📝 Set System Prompt", callback_data="admin_prompt")],
        [InlineKeyboardButton("👥 Manage Users", callback_data="admin_users")],
        [InlineKeyboardButton("📊 System Stats", callback_data="admin_stats")],
        [InlineKeyboardButton("⚙️ Advanced Settings", callback_data="admin_advanced")]
    ]
    
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.message.reply_text(
        admin_menu,
        parse_mode=ParseMode.MARKDOWN,
        reply_markup=reply_markup
    )

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle pesan teks dari user"""
    user_id = update.effective_user.id
    user_message = update.message.text
    
    if not user_message or user_message.startswith('/'):
        return
    
    # Cek jika admin dan belum aktifkan AI
    if is_admin(user_id) and user_message.lower() != "/runai":
        # Admin harus pakai /runai dulu
        if user_id not in config.admin_broadcast_mode or not config.admin_broadcast_mode[user_id].get("mode", False):
            return  # Admin diam saja sampai pakai /runai
    
    # Cek jika user diblokir
    if is_user_locked(user_id):
        return
    
    # Cek jika user aktif (sudah start)
    if not is_admin(user_id) and not is_user_active(user_id):
        await update.message.reply_text(
            "⚠️ **Maaf terjadi masalah.**\n\nSilakan ketik /start untuk memulai ulang."
        )
        return
    
    # Update last active
    if user_id in config.user_sessions:
        config.user_sessions[user_id]["last_active"] = datetime.now().timestamp()
    
    # Kirim typing indicator
    await update.message.chat.send_action(action="typing")
    
    # Panggil AI dengan timeout lebih lama
    response = await call_groq_api(user_message, config.system_prompt)
    
    # Format response untuk readability
    formatted_response = format_message_for_display(response)
    
    # Split jika respons terlalu panjang
    if len(formatted_response) > 4000:
        parts = []
        while formatted_response:
            if len(formatted_response) > 4000:
                split_pos = formatted_response[:4000].rfind('\n')
                if split_pos == -1:
                    split_pos = formatted_response[:4000].rfind('.')
                if split_pos == -1:
                    split_pos = 4000
                parts.append(formatted_response[:split_pos])
                formatted_response = formatted_response[split_pos:]
            else:
                parts.append(formatted_response)
                break
        
        for i, part in enumerate(parts):
            parse_mode = ParseMode.MARKDOWN if "```" in part else None
            header = f"**📄 Halaman {i+1}/{len(parts)}**\n\n" if i == 0 else ""
            await update.message.reply_text(
                f"{header}{part}",
                parse_mode=parse_mode if parse_mode else ParseMode.MARKDOWN
            )
    else:
        parse_mode = ParseMode.MARKDOWN if "```" in formatted_response else None
        await update.message.reply_text(
            formatted_response,
            parse_mode=parse_mode if parse_mode else ParseMode.MARKDOWN
        )

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle callback dari inline keyboard"""
    query = update.callback_query
    await query.answer()
    
    user_id = update.effective_user.id
    data = query.data
    
    if not is_admin(user_id):
        await query.edit_message_text("❌ Akses ditolak!")
        return
    
    # ADMIN CALLBACK HANDLERS
    if data == "admin_broadcast":
        config.admin_broadcast_mode[user_id] = {"mode": True, "message": ""}
        await query.edit_message_text(
            "📢 **MODE BROADCAST AKTIF**\n\n"
            "Kirim pesan yang ingin dikirim ke semua user.\n"
            "Ketik `!cancel` untuk membatalkan.\n\n"
            "*Format:*\n"
            "Judul Pesan\n"
            "Isi pesan..."
        )
    
    elif data == "admin_model":
        keyboard = []
        row = []
        for idx, model in enumerate(config.available_models):
            is_active = "✅" if model == config.active_model else "🔘"
            btn = InlineKeyboardButton(
                f"{is_active} {model.split('/')[-1]}",
                callback_data=f"set_model_{idx}"
            )
            row.append(btn)
            if len(row) == 2:
                keyboard.append(row)
                row = []
        if row:
            keyboard.append(row)
        
        keyboard.append([InlineKeyboardButton("🔙 Back", callback_data="admin_back")])
        
        await query.edit_message_text(
            f"🤖 **PILIH MODEL AI**\n\n"
            f"Model aktif: `{config.active_model}`\n\n"
            "Pilih model untuk semua user:",
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
    
    elif data.startswith("set_model_"):
        model_idx = int(data.split("_")[2])
        if model_idx < len(config.available_models):
            config.active_model = config.available_models[model_idx]
            config.save_config()
            await query.edit_message_text(
                f"✅ **Model berhasil diubah!**\n\n"
                f"Model aktif sekarang: `{config.active_model}`"
            )
    
    elif data == "admin_apikey":
        await query.edit_message_text(
            "🔑 **UPDATE API KEY**\n\n"
            "Kirim perintah:\n"
            "`/admin apikey YOUR_NEW_API_KEY`\n\n"
            "Pastikan API key valid dari Groq."
        )
    
    elif data == "admin_prompt":
        await query.edit_message_text(
            "📝 **UPDATE SYSTEM PROMPT**\n\n"
            "Kirim perintah:\n"
            "`/admin prompt [prompt_anda]`\n\n"
            "Prompt akan menentukan kepribadian AI."
        )
    
    elif data == "admin_users":
        keyboard = [
            [InlineKeyboardButton("🔒 Lock User", callback_data="admin_lock")],
            [InlineKeyboardButton("🔓 Unlock User", callback_data="admin_unlock")],
            [InlineKeyboardButton("👑 Add Admin", callback_data="admin_add")],
            [InlineKeyboardButton("🗑️ Remove Admin", callback_data="admin_remove")],
            [InlineKeyboardButton("📋 List Users", callback_data="admin_list")],
            [InlineKeyboardButton("🔙 Back", callback_data="admin_back")]
        ]
        await query.edit_message_text(
            "👥 **USER MANAGEMENT**\n\n"
            "Kelola user dan admin:",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
    
    elif data == "admin_lock":
        await query.edit_message_text(
            "🔒 **LOCK USER**\n\n"
            "Kirim perintah:\n"
            "`/lock @username`\n"
            "atau\n"
            "`/lock user_id`\n\n"
            "User akan diblokir dari bot."
        )
    
    elif data == "admin_unlock":
        await query.edit_message_text(
            "🔓 **UNLOCK USER**\n\n"
            "Kirim perintah:\n"
            "`/unlock @username`\n"
            "atau\n"
            "`/unlock user_id`\n\n"
            "User akan diunlock."
        )
    
    elif data == "admin_add":
        await query.edit_message_text(
            "👑 **ADD ADMIN**\n\n"
            "Kirim perintah:\n"
            "`/admin add user_id`\n\n"
            "User akan menjadi admin."
        )
    
    elif data == "admin_remove":
        await query.edit_message_text(
            "🗑️ **REMOVE ADMIN**\n\n"
            "Kirim perintah:\n"
            "`/admin remove user_id`\n\n"
            "Admin akan dihapus."
        )
    
    elif data == "admin_list":
        active_users = [u for u in config.user_sessions if config.user_sessions[u].get('active', False)]
        user_list = "**👥 ACTIVE USERS:**\n"
        for uid in list(active_users)[:20]:  # Limit 20 user
            user = config.user_sessions[uid]
            user_list += f"├─ 🆔 `{uid}` - {user.