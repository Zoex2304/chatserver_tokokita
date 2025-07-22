// socket/refund.js
// Server WebSocket khusus untuk menangani notifikasi refund secara real-time.

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Gunakan port yang berbeda dari server chat, misalnya 3002
const port = 3002;

const io = new Server(server, {
    cors: {
        origin: "http://localhost", // Sesuaikan dengan domain aplikasi CodeIgniter Anda
        methods: ["GET", "POST"]
    }
});

// Map untuk melacak pengguna yang online (khusus untuk refund)
// Key: userId (e.g., 'toko_1', 'pembeli_5'), Value: socketId
const onlineUsers = new Map();
// Map untuk membersihkan saat disconnect
// Key: socketId, Value: userId
const userSessions = new Map();

// Fungsi logging untuk memantau aktivitas
const logActivity = (action, details = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] REFUND_SERVER: ${action}`, details);
};

io.on('connection', (socket) => {
    logActivity('USER_CONNECTED', { socketId: socket.id });

    /**
     * Event untuk mendaftarkan pengguna (toko atau pembeli) saat mereka terhubung.
     * Ini penting agar server tahu harus mengirim notifikasi ke siapa.
     */
    socket.on('register_user', (data) => {
        const { userId } = data;
        if (userId) {
            onlineUsers.set(userId, socket.id);
            userSessions.set(socket.id, userId);
            logActivity('USER_REGISTERED', { userId, socketId: socket.id });
        }
    });

    /**
     * Event ini di-emit oleh pembeli setelah berhasil membuat request refund via AJAX.
     * Server akan meneruskan notifikasi ini ke toko yang bersangkutan.
     * @param {object} data - Berisi { id_toko, order_number, id_pembeli }
     */
    socket.on('request_refund_from_buyer', (data) => {
        const requestingUserId = userSessions.get(socket.id);
        logActivity('REFUND_REQUEST_RECEIVED', { from: requestingUserId, data });

        // Tentukan ID unik untuk user toko yang akan menerima notifikasi
        const tokoUserId = `toko_${data.id_toko}`;
        const tokoSocketId = onlineUsers.get(tokoUserId);

        if (tokoSocketId) {
            // Jika toko online, kirim notifikasi real-time ke socket spesifik milik toko
            io.to(tokoSocketId).emit('new_refund_notification', data);
            logActivity('NOTIFIED_SELLER', { targetUser: tokoUserId, targetSocket: tokoSocketId });
        } else {
            // Jika toko offline, mereka akan melihatnya saat login berikutnya (melalui AJAX call ke controller)
            logActivity('SELLER_OFFLINE', { targetUser: tokoUserId });
        }
    });

    /**
     * Menangani saat koneksi pengguna terputus.
     */
    socket.on('disconnect', () => {
        const userId = userSessions.get(socket.id);
        if (userId) {
            onlineUsers.delete(userId);
            userSessions.delete(socket.id);
            logActivity('USER_DISCONNECTED', { userId, socketId: socket.id });
        } else {
            logActivity('UNKNOWN_USER_DISCONNECTED', { socketId: socket.id });
        }
    });
});

server.listen(port, () => {
    console.log(`🚀 Server WebSocket untuk Refund berjalan di http://localhost:${port}`);
});
