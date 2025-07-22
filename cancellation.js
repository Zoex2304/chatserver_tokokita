// socket/cancellation.js
// Server WebSocket khusus untuk notifikasi pembatalan pesanan.

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Gunakan port baru yang unik, misalnya 3003
const port = 3003;

const io = new Server(server, {
    cors: {
        origin: "http://localhost", // Domain aplikasi CodeIgniter Anda
        methods: ["GET", "POST"]
    }
});

const onlineUsers = new Map(); // Key: userId (e.g., 'toko_1'), Value: socketId
const userSessions = new Map(); // Key: socketId, Value: userId

const logActivity = (action, details = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] CANCELLATION_SERVER: ${action}`, details);
};

io.on('connection', (socket) => {
    logActivity('USER_CONNECTED', { socketId: socket.id });

    socket.on('register_user', (data) => {
        const { userId } = data;
        if (userId) {
            onlineUsers.set(userId, socket.id);
            userSessions.set(socket.id, userId);
            logActivity('USER_REGISTERED', { userId, socketId: socket.id });
        }
    });

    /**
     * Diterima dari pembeli saat mereka mengajukan pembatalan.
     * @param {object} data - Berisi { id_toko, order_number }
     */
    socket.on('request_cancellation_from_buyer', (data) => {
        const requestingUserId = userSessions.get(socket.id);
        logActivity('CANCELLATION_REQUEST_RECEIVED', { from: requestingUserId, data });

        const tokoUserId = `toko_${data.id_toko}`;
        const tokoSocketId = onlineUsers.get(tokoUserId);

        if (tokoSocketId) {
            // Kirim notifikasi ke toko yang bersangkutan
            io.to(tokoSocketId).emit('new_cancellation_notification', data);
            logActivity('NOTIFIED_SELLER', { targetUser: tokoUserId });
        } else {
            logActivity('SELLER_OFFLINE', { targetUser: tokoUserId });
        }
    });

    socket.on('disconnect', () => {
        const userId = userSessions.get(socket.id);
        if (userId) {
            onlineUsers.delete(userId);
            userSessions.delete(socket.id);
            logActivity('USER_DISCONNECTED', { userId, socketId: socket.id });
        }
    });
});

server.listen(port, () => {
    console.log(`🚀 Server WebSocket untuk Pembatalan berjalan di http://localhost:${port}`);
});
