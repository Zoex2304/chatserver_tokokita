// main.js - Unified Socket.IO Server
// Menggabungkan semua namespace dan menambahkan endpoint HTTP untuk trigger dari PHP

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
app.use(express.json()); // Middleware untuk parsing body JSON dari request

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "https://chatserver-tokokita.onrender.com",
        methods: ["GET", "POST"]
    }
});

const port = 3000;

// Import handlers
const ChatHandler = require('./handlers/chat');
const RefundHandler = require('./handlers/refund');
const CancellationHandler = require('./handlers/cancellation');
const OrderHandler = require('./handlers/order');

// Utility function
const logActivity = (namespace, action, details = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${namespace.toUpperCase()}: ${action}`, details);
};

// Create namespaces
const chatNamespace = io.of('/chat');
const refundNamespace = io.of('/refund');
const cancellationNamespace = io.of('/cancellation');
const orderNamespace = io.of('/order');

// Initialize handlers
const chatHandler = new ChatHandler(chatNamespace, logActivity);
const refundHandler = new RefundHandler(refundNamespace, logActivity);
const cancellationHandler = new CancellationHandler(cancellationNamespace, logActivity);
const orderHandler = new OrderHandler(orderNamespace, logActivity);

// [BARU] Endpoint HTTP untuk trigger dari PHP (Midtrans Webhook)
app.post('/trigger-order-update', (req, res) => {
    const orderData = req.body;
    if (orderData && orderData.id_toko) {
        logActivity('http', 'TRIGGER_RECEIVED_FOR_ORDER_UPDATE', { order: orderData.order_number });
        orderHandler.emitOrderStatusUpdate(orderData); // Panggil method baru di handler
        res.status(200).json({ status: 'ok', message: 'Event triggered successfully.' });
    } else {
        logActivity('http', 'INVALID_TRIGGER_DATA', { data: orderData });
        res.status(400).json({ status: 'error', message: 'Invalid or missing order data.' });
    }
});

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

orderNamespace.on('connection', (socket) => {
    logActivity('order', 'USER_CONNECTED', { socketId: socket.id });
    orderHandler.handleConnection(socket);
});

io.on('connection', (socket) => {
    console.log(`⚡: User terhubung ke root namespace dengan socket id: ${socket.id}`);

    socket.emit('server_info', {
        message: 'Server Socket.IO Terpusat',
        namespaces: ['/chat', '/refund', '/cancellation', '/order'],
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
            },
            order: {
                connected: orderNamespace.sockets.size,
                online_users: orderHandler.getOnlineUsersCount()
            }
        });
    });
});

server.listen(port, () => {
    console.log(`🚀 Server Socket.IO Terpusat berjalan di https://chatserver-tokokita.onrender.com:${port}`);
    console.log(`📂 Namespace tersedia:`);
    console.log(`   - /chat (untuk fitur chat)`);
    console.log(`   - /refund (untuk notifikasi refund)`);
    console.log(`   - /cancellation (untuk notifikasi pembatalan)`);
    console.log(`   - /order (untuk notifikasi pesanan baru)`);
    console.log(`⚡️ Endpoint HTTP trigger tersedia di POST https://chatserver-tokokita.onrender.com:${port}/trigger-order-update`);
});

module.exports = { io, server };