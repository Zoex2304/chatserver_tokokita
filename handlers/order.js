// handlers/order.js
// Module untuk menangani notifikasi pesanan baru dan pembaruan status.

class OrderHandler {
    constructor(namespace, logActivity) {
        this.io = namespace;
        this.logActivity = logActivity;
        this.onlineUsers = new Map(); // Menyimpan userId (e.g., 'toko_123') -> socketId
        this.userSessions = new Map(); // Menyimpan socketId -> userId
    }

    logOrderActivity(action, details = {}) {
        this.logActivity('order', action, details);
    }

    getOnlineUsersCount() {
        return this.onlineUsers.size;
    }

    // [BARU] Fungsi untuk memancarkan event pembaruan status pesanan
    emitOrderStatusUpdate(orderData) {
        const tokoUserId = `toko_${orderData.id_toko}`;
        const tokoSocketId = this.onlineUsers.get(tokoUserId);

        if (tokoSocketId) {
            this.io.to(tokoSocketId).emit('order_status_updated', {
                message: `Pembayaran untuk pesanan #${orderData.order_number} berhasil.`,
                order: orderData
            });
            this.logOrderActivity('NOTIFIED_SELLER_PAYMENT_SUCCESS', {
                targetUser: tokoUserId,
                orderNumber: orderData.order_number
            });
        } else {
            this.logOrderActivity('SELLER_OFFLINE_PAYMENT_SUCCESS', { targetUser: tokoUserId });
        }
    }

    handleConnection(socket) {
        socket.on('register_user', (data) => {
            const { userId } = data;
            if (userId) {
                this.onlineUsers.set(userId, socket.id);
                this.userSessions.set(socket.id, userId);
                this.logOrderActivity('USER_REGISTERED', { userId, socketId: socket.id });
            }
        });

        socket.on('new_order_placed', (data) => {
            const { id_toko, order_data } = data;
            this.logOrderActivity('NEW_ORDER_PLACED', { from: 'checkout_page', data });

            const tokoUserId = `toko_${id_toko}`;
            const tokoSocketId = this.onlineUsers.get(tokoUserId);

            if (tokoSocketId) {
                this.io.to(tokoSocketId).emit('new_order_notification', {
                    message: `Pesanan baru #${order_data.order_number} telah masuk!`,
                    order: order_data,
                    timestamp: new Date().toISOString()
                });
                this.logOrderActivity('NOTIFIED_SELLER', {
                    targetUser: tokoUserId,
                    targetSocket: tokoSocketId,
                    orderNumber: order_data.order_number
                });
            } else {
                this.logOrderActivity('SELLER_OFFLINE', { targetUser: tokoUserId });
            }
        });

        socket.on('disconnect', () => {
            const userId = this.userSessions.get(socket.id);
            if (userId) {
                this.onlineUsers.delete(userId);
                this.userSessions.delete(socket.id);
                this.logOrderActivity('USER_DISCONNECTED', { userId, socketId: socket.id });
            } else {
                this.logOrderActivity('UNKNOWN_USER_DISCONNECTED', { socketId: socket.id });
            }
        });
    }
}

module.exports = OrderHandler;
