// handlers/chat.js
// Module untuk menangani semua fungsionalitas chat

class ChatHandler {
  constructor(namespace, logActivity) {
    this.io = namespace;
    this.logActivity = logActivity;
    this.onlineUsers = new Map(); // userId -> { socketId, isViewingChat, conversationId, lastSeen, role }
    this.userSessions = new Map(); // socketId -> userId for cleanup
  }

  // Logging utility khusus untuk chat
  logUserActivity(userId, action, details = {}) {
    this.logActivity('chat', `USER_ACTIVITY: ${userId} - ${action}`, details);
  }

  // Helper function to get user status
  getUserStatus(userId) {
    const user = this.onlineUsers.get(userId);
    if (!user) return 'offline';
    return user.isViewingChat ? 'viewing' : 'connected';
  }

  // Helper function to determine check mark status
  getCheckMarkStatus(senderId, recipientId) {
    const senderStatus = this.getUserStatus(senderId);
    const recipientStatus = this.getUserStatus(recipientId);

    this.logUserActivity(senderId, 'CHECK_MARK_CALCULATION', {
      senderStatus,
      recipientStatus,
      recipient: recipientId
    });

    if (recipientStatus === 'offline') {
      return 'single'; // Single check - recipient is offline
    } else if (recipientStatus === 'connected') {
      return 'double_gray'; // Double gray check - recipient is online but not viewing
    } else if (recipientStatus === 'viewing') {
      return 'double_blue'; // Double blue check - recipient is viewing
    }
    return 'single'; // Default to single if status is undefined
  }

  // Helper function to update or create conversation item
  updateOrCreateConversationItem(data) {
    const { conversationId, userId, isPemilikToko } = data;
    this.logUserActivity(userId, 'CONVERSATION_UPDATE', {
      conversationId,
      isPemilikToko,
      action: 'update_or_create'
    });

    // Emit event to update conversation list for relevant users
    if (isPemilikToko) {
      this.io.emit('update_conversation_list', {
        conversationId,
        userId: `toko_${userId}`
      });
    } else {
      this.io.emit('update_conversation_list', {
        conversationId,
        userId: `pembeli_${userId}`
      });
    }
  }

  // Broadcast updated online users list
  broadcastOnlineUsers() {
    const onlineUsersList = Array.from(this.onlineUsers.keys());
    const userStatuses = {};

    this.onlineUsers.forEach((data, userId) => {
      userStatuses[userId] = {
        isOnline: true, // Jika ada di map onlineUsers, berarti online
        isViewingChat: data.isViewingChat,
        conversationId: data.conversationId,
        role: data.role // Tambahkan role ke status
      };
    });

    this.io.emit('online_users_update', {
      users: onlineUsersList,
      statuses: userStatuses
    });

    this.logUserActivity('SYSTEM', 'BROADCAST_ONLINE_USERS', {
      totalOnline: onlineUsersList.length,
      users: onlineUsersList
    });
  }

  // Get online users count for monitoring
  getOnlineUsersCount() {
    return this.onlineUsers.size;
  }

  handleConnection(socket) {
    socket.on('user_connect', (data) => {
      const { userId, role } = data;
      if (userId) {
        // Store user session
        this.userSessions.set(socket.id, userId);

        // Update user status
        this.onlineUsers.set(userId, {
          socketId: socket.id,
          isViewingChat: false,
          conversationId: null,
          lastSeen: new Date(),
          role: role
        });

        this.logUserActivity(userId, 'CONNECTED', { role, socketId: socket.id });
        this.broadcastOnlineUsers();
      }
    });

    // User started viewing chat window
    socket.on('start_viewing_chat', (data) => {
      const { userId, conversationId } = data;
      const user = this.onlineUsers.get(userId);

      if (user) {
        user.isViewingChat = true;
        user.conversationId = conversationId;

        this.logUserActivity(userId, 'STARTED_VIEWING_CHAT', { conversationId });
        this.broadcastOnlineUsers();

        // Join the conversation room
        socket.join(conversationId);

        // Notify other participants about status change
        socket.to(conversationId).emit('user_viewing_status_changed', {
          userId,
          isViewing: true,
          conversationId
        });
      }
    });

    // User stopped viewing chat window
    socket.on('stop_viewing_chat', (data) => {
      const { userId, conversationId } = data;
      const user = this.onlineUsers.get(userId);

      if (user) {
        user.isViewingChat = false;
        user.conversationId = null;

        this.logUserActivity(userId, 'STOPPED_VIEWING_CHAT', { conversationId });
        this.broadcastOnlineUsers();

        // Notify other participants about status change
        socket.to(conversationId).emit('user_viewing_status_changed', {
          userId,
          isViewing: false,
          conversationId
        });
        // Leave the conversation room
        socket.leave(conversationId);
      }
    });

    // Request status update from client
    socket.on('request_status_update', () => {
      const requesterId = this.userSessions.get(socket.id);
      if (requesterId) {
        this.logUserActivity(requesterId, 'REQUESTED_STATUS_UPDATE');

        // Kirim status update terbaru ke client yang meminta
        const userStatuses = {};
        this.onlineUsers.forEach((data, userId) => {
          userStatuses[userId] = {
            isOnline: true,
            isViewingChat: data.isViewingChat,
            conversationId: data.conversationId,
            role: data.role
          };
        });

        socket.emit('online_users_update', {
          users: Array.from(this.onlineUsers.keys()),
          statuses: userStatuses
        });
      }
    });

    socket.on('user_logout', (data) => {
      const { userId, isPemilikToko } = data;

      if (this.onlineUsers.has(userId)) {
        const user = this.onlineUsers.get(userId);
        if (user && user.conversationId) {
          // Notify others in the conversation that user is no longer viewing
          socket.to(user.conversationId).emit('user_viewing_status_changed', {
            userId,
            isViewing: false,
            conversationId: user.conversationId
          });
          socket.leave(user.conversationId);
        }

        // Remove user from online users
        this.onlineUsers.delete(userId);
        this.userSessions.delete(socket.id);

        // Emit user disconnected event
        this.io.emit('user_disconnected', { userId });

        this.logUserActivity(userId, 'EXPLICIT_LOGOUT', { socketId: socket.id, isPemilikToko });
        this.broadcastOnlineUsers();
      }
    });

    socket.on('join_room', (conversationId) => {
      if (conversationId) {
        socket.join(conversationId);
        const userId = this.userSessions.get(socket.id);
        this.logUserActivity(userId, 'JOINED_ROOM', { conversationId });
      }
    });

    socket.on('notify_seller', (data) => {
      const tokoUserId = `toko_${data.id_toko}`;
      const senderId = `pembeli_${data.message_data.sender_id}`;
      const tokoUser = this.onlineUsers.get(tokoUserId);

      if (tokoUser) {
        this.io.to(tokoUser.socketId).emit('seller_update_notification', data);
        this.logUserActivity(senderId, 'NOTIFIED_SELLER', {
          tokoUserId,
          messageId: data.message_data.id
        });

        // Determine check mark status
        const checkStatus = this.getCheckMarkStatus(senderId, tokoUserId);

        const senderUser = this.onlineUsers.get(senderId);
        if (senderUser) {
          this.io.to(senderUser.socketId).emit('update_message_status', {
            messageIds: [data.message_data.id],
            status: 'delivered',
            checkMarkStatus: checkStatus
          });
        }
      } else {
        this.logUserActivity(senderId, 'SELLER_OFFLINE', {
          tokoUserId,
          messageId: data.message_data.id
        });

        // Sender gets single check when recipient is offline
        const senderUser = this.onlineUsers.get(senderId);
        if (senderUser) {
          this.io.to(senderUser.socketId).emit('update_message_status', {
            messageIds: [data.message_data.id],
            status: 'sent',
            checkMarkStatus: 'single'
          });
        }
      }
    });

    socket.on('send_message_to_buyer', (data) => {
      const recipientId = data.recipientId;
      const senderId = `toko_${data.sender_id}`;
      const recipientUser = this.onlineUsers.get(recipientId);

      if (recipientUser) {
        this.io.to(recipientUser.socketId).emit('receive_message', data);
        this.logUserActivity(senderId, 'SENT_MESSAGE_TO_BUYER', {
          recipientId,
          messageId: data.id
        });

        // Determine check mark status
        const checkStatus = this.getCheckMarkStatus(senderId, recipientId);

        const senderUser = this.onlineUsers.get(senderId);
        if (senderUser) {
          this.io.to(senderUser.socketId).emit('update_message_status', {
            messageIds: [data.id],
            status: 'delivered',
            checkMarkStatus: checkStatus
          });
        }
      } else {
        this.logUserActivity(senderId, 'BUYER_OFFLINE', {
          recipientId,
          messageId: data.id
        });

        // Sender gets single check when recipient is offline
        const senderUser = this.onlineUsers.get(senderId);
        if (senderUser) {
          this.io.to(senderUser.socketId).emit('update_message_status', {
            messageIds: [data.id],
            status: 'sent',
            checkMarkStatus: 'single'
          });
        }
      }
    });

    socket.on('mark_messages_as_read', (data) => {
      const { conversationId, readerId } = data;

      this.logUserActivity(readerId, 'MARKED_MESSAGES_READ', { conversationId });

      // Notify sender that messages were read (blue check)
      socket.to(conversationId).emit('messages_were_read', {
        conversationId,
        readerId,
        checkMarkStatus: 'double_blue'
      });
    });

    socket.on('check_online_status', (targetUserId) => {
      const status = this.getUserStatus(targetUserId);
      const user = this.onlineUsers.get(targetUserId);

      socket.emit('online_status_response', {
        userId: targetUserId,
        isOnline: status !== 'offline',
        isViewingChat: user ? user.isViewingChat : false,
        status: status
      });

      this.logUserActivity(targetUserId, 'STATUS_CHECKED', {
        requestedBy: this.userSessions.get(socket.id),
        status
      });
    });

    socket.on('typing_start', (data) => {
      const { userId, recipientId, conversationId } = data;

      this.logUserActivity(userId, 'TYPING_START', { recipientId, conversationId });

      if (recipientId) {
        const recipientUser = this.onlineUsers.get(recipientId);
        if (recipientUser) {
          this.io.to(recipientUser.socketId).emit('typing_start_from_server', {
            userId: userId,
            conversationId: conversationId
          });
        }
      } else {
        socket.to(conversationId).emit('typing_start_from_server', {
          userId: userId,
          conversationId: conversationId
        });
      }
    });

    socket.on('typing_stop', (data) => {
      const { userId, recipientId, conversationId } = data;

      this.logUserActivity(userId, 'TYPING_STOP', { recipientId, conversationId });

      if (recipientId) {
        const recipientUser = this.onlineUsers.get(recipientId);
        if (recipientUser) {
          this.io.to(recipientUser.socketId).emit('typing_stop_from_server', {
            userId: userId,
            conversationId: conversationId
          });
        }
      } else {
        socket.to(conversationId).emit('typing_stop_from_server', {
          userId: userId,
          conversationId: conversationId
        });
      }
    });

    socket.on('disconnect', () => {
      const userId = this.userSessions.get(socket.id);

      if (userId) {
        const user = this.onlineUsers.get(userId);
        if (user && user.conversationId) {
          // Notify others in the conversation that user is no longer viewing
          socket.to(user.conversationId).emit('user_viewing_status_changed', {
            userId,
            isViewing: false,
            conversationId: user.conversationId
          });
          socket.leave(user.conversationId);
        }

        this.onlineUsers.delete(userId);
        this.userSessions.delete(socket.id);

        // Emit user disconnected event
        this.io.emit('user_disconnected', { userId });

        this.logUserActivity(userId, 'DISCONNECTED', { socketId: socket.id });
        this.broadcastOnlineUsers();
      }
    });
  }
}

module.exports = ChatHandler;