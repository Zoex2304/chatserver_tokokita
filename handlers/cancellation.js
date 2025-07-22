// handlers/cancellation.js
// Module untuk menangani semua fungsionalitas pembatalan pesanan

class CancellationHandler {
  constructor(namespace, logActivity) {
    this.io = namespace;
    this.logActivity = logActivity;
    this.onlineUsers = new Map(); // userId -> socketId
    this.userSessions = new Map(); // socketId -> userId
  }

  // Helper method untuk logging khusus cancellation
  logCancellationActivity(action, details = {}) {
    this.logActivity('cancellation', action, details);
  }

  // Get online users count for monitoring
  getOnlineUsersCount() {
    return this.onlineUsers.size;
  }

  handleConnection(socket) {
    /**
     * Register user untuk cancellation namespace
     */
    socket.on('register_user', (data) => {
      const { userId } = data;
      if (userId) {
        this.onlineUsers.set(userId, socket.id);
        this.userSessions.set(socket.id, userId);
        this.logCancellationActivity('USER_REGISTERED', { userId, socketId: socket.id });
      }
    });

    /**
     * Diterima dari pembeli saat mereka mengajukan pembatalan.
     * @param {object} data - Berisi { id_toko, order_number, reason, id_pembeli }
     */
    socket.on('request_cancellation_from_buyer', (data) => {
      const requestingUserId = this.userSessions.get(socket.id);
      this.logCancellationActivity('CANCELLATION_REQUEST_RECEIVED', {
        from: requestingUserId,
        data
      });

      const tokoUserId = `toko_${data.id_toko}`;
      const tokoSocketId = this.onlineUsers.get(tokoUserId);

      if (tokoSocketId) {
        // Kirim notifikasi ke toko yang bersangkutan
        this.io.to(tokoSocketId).emit('new_cancellation_notification', data);
        this.logCancellationActivity('NOTIFIED_SELLER', { targetUser: tokoUserId });
      } else {
        this.logCancellationActivity('SELLER_OFFLINE', { targetUser: tokoUserId });
      }
    });

    /**
     * Event untuk toko yang merespon permintaan pembatalan
     */
    socket.on('respond_to_cancellation', (data) => {
      const { id_pembeli, order_number, response, message } = data;
      // response bisa 'approved', 'rejected', 'processing'
      const pembeliUserId = `pembeli_${id_pembeli}`;
      const pembeliSocketId = this.onlineUsers.get(pembeliUserId);

      this.logCancellationActivity('CANCELLATION_RESPONSE_SENT', {
        from: this.userSessions.get(socket.id),
        to: pembeliUserId,
        order_number,
        response
      });

      if (pembeliSocketId) {
        this.io.to(pembeliSocketId).emit('cancellation_response', {
          order_number,
          response,
          message,
          timestamp: new Date().toISOString()
        });
        this.logCancellationActivity('BUYER_NOTIFIED_RESPONSE', {
          targetUser: pembeliUserId
        });
      } else {
        this.logCancellationActivity('BUYER_OFFLINE_RESPONSE', {
          targetUser: pembeliUserId
        });
      }
    });

    /**
     * Event untuk update status pembatalan secara real-time
     */
    socket.on('cancellation_status_update', (data) => {
      const { id_pembeli, order_number, status, message } = data;
      const pembeliUserId = `pembeli_${id_pembeli}`;
      const pembeliSocketId = this.onlineUsers.get(pembeliUserId);

      this.logCancellationActivity('CANCELLATION_STATUS_UPDATE', {
        from: this.userSessions.get(socket.id),
        to: pembeliUserId,
        status,
        order_number
      });

      if (pembeliSocketId) {
        this.io.to(pembeliSocketId).emit('cancellation_status_changed', {
          order_number,
          status,
          message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * Event untuk mengecek status pembatalan
     */
    socket.on('check_cancellation_status', (data) => {
      const { order_number } = data;
      const userId = this.userSessions.get(socket.id);

      this.logCancellationActivity('CANCELLATION_STATUS_CHECKED', {
        by: userId,
        order_number
      });

      // Response ke client untuk trigger update data
      socket.emit('cancellation_status_check_response', {
        order_number,
        timestamp: new Date().toISOString(),
        message: 'Status check request received'
      });
    });

    /**
     * Event untuk admin/toko yang ingin broadcast pengumuman pembatalan
     */
    socket.on('broadcast_cancellation_announcement', (data) => {
      const senderId = this.userSessions.get(socket.id);

      this.logCancellationActivity('CANCELLATION_ANNOUNCEMENT_BROADCAST', {
        from: senderId,
        message: data.message
      });

      // Broadcast ke semua user yang terhubung di namespace cancellation
      this.io.emit('cancellation_announcement', {
        message: data.message,
        timestamp: new Date().toISOString(),
        from: senderId
      });
    });

    /**
     * Event untuk pembeli yang ingin membatalkan request pembatalan
     */
    socket.on('cancel_cancellation_request', (data) => {
      const { id_toko, order_number } = data;
      const requestingUserId = this.userSessions.get(socket.id);
      const tokoUserId = `toko_${id_toko}`;
      const tokoSocketId = this.onlineUsers.get(tokoUserId);

      this.logCancellationActivity('CANCELLATION_REQUEST_CANCELLED', {
        from: requestingUserId,
        order_number,
        target_toko: tokoUserId
      });

      if (tokoSocketId) {
        this.io.to(tokoSocketId).emit('cancellation_request_cancelled', {
          order_number,
          cancelled_by: requestingUserId,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * Menangani saat koneksi pengguna terputus.
     */
    socket.on('disconnect', () => {
      const userId = this.userSessions.get(socket.id);
      if (userId) {
        this.onlineUsers.delete(userId);
        this.userSessions.delete(socket.id);
        this.logCancellationActivity('USER_DISCONNECTED', { userId, socketId: socket.id });
      } else {
        this.logCancellationActivity('UNKNOWN_USER_DISCONNECTED', { socketId: socket.id });
      }
    });
  }
}

module.exports = CancellationHandler;