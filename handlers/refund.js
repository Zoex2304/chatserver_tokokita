// handlers/refund.js
// Module untuk menangani semua fungsionalitas refund

class RefundHandler {
  constructor(namespace, logActivity) {
    this.io = namespace;
    this.logActivity = logActivity;
    this.onlineUsers = new Map(); // userId -> socketId
    this.userSessions = new Map(); // socketId -> userId
  }

  // Helper method untuk logging khusus refund
  logRefundActivity(action, details = {}) {
    this.logActivity('refund', action, details);
  }

  // Get online users count for monitoring
  getOnlineUsersCount() {
    return this.onlineUsers.size;
  }

  handleConnection(socket) {
    /**
     * Event untuk mendaftarkan pengguna (toko atau pembeli) saat mereka terhubung.
     * Ini penting agar server tahu harus mengirim notifikasi ke siapa.
     */
    socket.on('register_user', (data) => {
      const { userId } = data;
      if (userId) {
        this.onlineUsers.set(userId, socket.id);
        this.userSessions.set(socket.id, userId);
        this.logRefundActivity('USER_REGISTERED', { userId, socketId: socket.id });
      }
    });

    /**
     * Event ini di-emit oleh pembeli setelah berhasil membuat request refund via AJAX.
     * Server akan meneruskan notifikasi ini ke toko yang bersangkutan.
     * @param {object} data - Berisi { id_toko, order_number, id_pembeli }
     */
    socket.on('request_refund_from_buyer', (data) => {
      const requestingUserId = this.userSessions.get(socket.id);
      this.logRefundActivity('REFUND_REQUEST_RECEIVED', { from: requestingUserId, data });

      // Tentukan ID unik untuk user toko yang akan menerima notifikasi
      const tokoUserId = `toko_${data.id_toko}`;
      const tokoSocketId = this.onlineUsers.get(tokoUserId);

      if (tokoSocketId) {
        // Jika toko online, kirim notifikasi real-time ke socket spesifik milik toko
        this.io.to(tokoSocketId).emit('new_refund_notification', data);
        this.logRefundActivity('NOTIFIED_SELLER', {
          targetUser: tokoUserId,
          targetSocket: tokoSocketId
        });
      } else {
        // Jika toko offline, mereka akan melihatnya saat login berikutnya
        this.logRefundActivity('SELLER_OFFLINE', { targetUser: tokoUserId });
      }
    });

    /**
     * Event untuk toko yang ingin mengirim update status refund ke pembeli
     */
    socket.on('refund_status_update', (data) => {
      const { id_pembeli, status, order_number, message } = data;
      const pembeliUserId = `pembeli_${id_pembeli}`;
      const pembeliSocketId = this.onlineUsers.get(pembeliUserId);

      this.logRefundActivity('REFUND_STATUS_UPDATE', {
        from: this.userSessions.get(socket.id),
        to: pembeliUserId,
        status,
        order_number
      });

      if (pembeliSocketId) {
        this.io.to(pembeliSocketId).emit('refund_status_changed', {
          order_number,
          status,
          message,
          timestamp: new Date().toISOString()
        });
        this.logRefundActivity('BUYER_NOTIFIED_STATUS_CHANGE', {
          targetUser: pembeliUserId
        });
      } else {
        this.logRefundActivity('BUYER_OFFLINE_STATUS_UPDATE', {
          targetUser: pembeliUserId
        });
      }
    });

    /**
     * Event untuk mengecek status refund secara real-time
     */
    socket.on('check_refund_status', (data) => {
      const { order_number } = data;
      const userId = this.userSessions.get(socket.id);

      this.logRefundActivity('REFUND_STATUS_CHECKED', {
        by: userId,
        order_number
      });

      // Emit ke client yang meminta untuk update status
      // Biasanya ini akan trigger AJAX call ke backend untuk data terbaru
      socket.emit('refund_status_check_response', {
        order_number,
        timestamp: new Date().toISOString(),
        message: 'Status check request received'
      });
    });

    /**
     * Event untuk admin/toko yang ingin broadcast pengumuman refund
     */
    socket.on('broadcast_refund_announcement', (data) => {
      const senderId = this.userSessions.get(socket.id);

      this.logRefundActivity('REFUND_ANNOUNCEMENT_BROADCAST', {
        from: senderId,
        message: data.message
      });

      // Broadcast ke semua user yang terhubung di namespace refund
      this.io.emit('refund_announcement', {
        message: data.message,
        timestamp: new Date().toISOString(),
        from: senderId
      });
    });

    /**
     * Menangani saat koneksi pengguna terputus.
     */
    socket.on('disconnect', () => {
      const userId = this.userSessions.get(socket.id);
      if (userId) {
        this.onlineUsers.delete(userId);
        this.userSessions.delete(socket.id);
        this.logRefundActivity('USER_DISCONNECTED', { userId, socketId: socket.id });
      } else {
        this.logRefundActivity('UNKNOWN_USER_DISCONNECTED', { socketId: socket.id });
      }
    });
  }
}

module.exports = RefundHandler;