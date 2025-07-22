// main.js - Unified Socket.IO Server
// Menggabungkan chat, refund, dan cancellation dalam satu server dengan namespace terpisah

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "http://localhost", // Sesuaikan dengan domain aplikasi Anda
        methods: ["GET", "POST"]
    }
});

const port = 3000;

// Import modules
const ChatHandler = require('./handlers/chat');
const RefundHandler = require('./handlers/refund');
const CancellationHandler = require('./handlers/cancellation');

// Utility functions
const logActivity = (namespace, action, details = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${namespace.toUpperCase()}: ${action}`, details);
};

// Create namespaces
const chatNamespace = io.of('/chat');
const refundNamespace = io.of('/refund');
const cancellationNamespace = io.of('/cancellation');

// Initialize handlers
const chatHandler = new ChatHandler(chatNamespace, logActivity);
const refundHandler = new RefundHandler(refundNamespace, logActivity);
const cancellationHandler = new CancellationHandler(cancellationNamespace, logActivity);

// Setup namespace connections
chatNamespace.on('connection', (socket) => {
    logActivity('chat', 'USER_CONNECTED', { socketId: socket.id });
    chatHandler.handleConnection(socket);
});

refundNamespace.on('connection', (socket) => {
    logActivity('refund', 'USER_CONNECTED', { socketId: socket.id });
    refundHandler.handleConnection(socket);
});

cancellationNamespace.on('connection', (socket) => {
    logActivity('cancellation', 'USER_CONNECTED', { socketId: socket.id });
    cancellationHandler.handleConnection(socket);
});

// Root namespace for basic server info
io.on('connection', (socket) => {
    console.log(`⚡: User terhubung ke root namespace dengan socket id: ${socket.id}`);
    
    socket.emit('server_info', {
        message: 'Server Socket.IO Terpusat',
        namespaces: ['/chat', '/refund', '/cancellation'],
        timestamp: new Date().toISOString()
    });

    socket.on('get_server_status', () => {
        socket.emit('server_status', {
            chat: {
                connected: chatNamespace.sockets.size,
                online_users: chatHandler.getOnlineUsersCount()
            },
            refund: {
                connected: refundNamespace.sockets.size,
                online_users: refundHandler.getOnlineUsersCount()
            },
            cancellation: {
                connected: cancellationNamespace.sockets.size,
                online_users: cancellationHandler.getOnlineUsersCount()
            }
        });
    });
});

server.listen(port, () => {
    console.log(`🚀 Server Socket.IO Terpusat berjalan di http://localhost:${port}`);
    console.log(`📂 Namespace tersedia:`);
    console.log(`   - /chat (untuk fitur chat)`);
    console.log(`   - /refund (untuk notifikasi refund)`);
    console.log(`   - /cancellation (untuk notifikasi pembatalan)`);
});

module.exports = { io, server };