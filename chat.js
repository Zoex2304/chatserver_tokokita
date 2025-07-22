// Enhanced server.js with improved status tracking
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

// Enhanced user tracking with more detailed status
const onlineUsers = new Map(); // userId -> { socketId, isViewingChat, conversationId, lastSeen, role }
const userSessions = new Map(); // socketId -> userId for cleanup

// Logging utility
const logUserActivity = (userId, action, details = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] USER_ACTIVITY: ${userId} - ${action}`, details);
};

// Helper function to get user status (not used for broadcast, but for internal logic)
const getUserStatus = (userId) => {
    const user = onlineUsers.get(userId);
    if (!user) return 'offline';
    return user.isViewingChat ? 'viewing' : 'connected';
};

// Helper function to determine check mark status
const getCheckMarkStatus = (senderId, recipientId) => {
    const senderStatus = getUserStatus(senderId);
    const recipientStatus = getUserStatus(recipientId);

    logUserActivity(senderId, 'CHECK_MARK_CALCULATION', {
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
};

// Helper function to update or create conversation item
const updateOrCreateConversationItem = (data) => {
    const { conversationId, userId, isPemilikToko } = data;
    logUserActivity(userId, 'CONVERSATION_UPDATE', {
        conversationId,
        isPemilikToko,
        action: 'update_or_create'
    });

    // Emit event to update conversation list for relevant users
    if (isPemilikToko) {
        io.emit('update_conversation_list', {
            conversationId,
            userId: `toko_${userId}`
        });
    } else {
        io.emit('update_conversation_list', {
            conversationId,
            userId: `pembeli_${userId}`
        });
    }
};

// Broadcast updated online users list
const broadcastOnlineUsers = () => {
    const onlineUsersList = Array.from(onlineUsers.keys());
    const userStatuses = {};

    onlineUsers.forEach((data, userId) => {
        userStatuses[userId] = {
            isOnline: true, // Jika ada di map onlineUsers, berarti online
            isViewingChat: data.isViewingChat,
            conversationId: data.conversationId,
            role: data.role // Tambahkan role ke status
        };
    });

    io.emit('online_users_update', {
        users: onlineUsersList,
        statuses: userStatuses
    });

    logUserActivity('SYSTEM', 'BROADCAST_ONLINE_USERS', {
        totalOnline: onlineUsersList.length,
        users: onlineUsersList
    });
};

io.on('connection', (socket) => {
    console.log(`⚡: User terhubung dengan socket id: ${socket.id}`);

    socket.on('user_connect', (data) => {
        const { userId, role } = data;
        if (userId) {
            // Store user session
            userSessions.set(socket.id, userId);

            // Update user status
            onlineUsers.set(userId, {
                socketId: socket.id,
                isViewingChat: false,
                conversationId: null,
                lastSeen: new Date(),
                role: role
            });

            logUserActivity(userId, 'CONNECTED', { role, socketId: socket.id });
            broadcastOnlineUsers();
        }
    });

    // New event: User started viewing chat window
    socket.on('start_viewing_chat', (data) => {
        const { userId, conversationId } = data;
        const user = onlineUsers.get(userId);

        if (user) {
            user.isViewingChat = true;
            user.conversationId = conversationId;

            logUserActivity(userId, 'STARTED_VIEWING_CHAT', { conversationId });
            broadcastOnlineUsers(); // Broadcast perubahan status

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

    // New event: User stopped viewing chat window
    socket.on('stop_viewing_chat', (data) => {
        const { userId, conversationId } = data;
        const user = onlineUsers.get(userId);

        if (user) {
            user.isViewingChat = false;
            user.conversationId = null;

            logUserActivity(userId, 'STOPPED_VIEWING_CHAT', { conversationId });
            broadcastOnlineUsers(); // Broadcast perubahan status

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

    // NEW EVENT: Request status update from client
    socket.on('request_status_update', () => {
        const requesterId = userSessions.get(socket.id);
        if (requesterId) {
            logUserActivity(requesterId, 'REQUESTED_STATUS_UPDATE');

            // Kirim status update terbaru ke client yang meminta
            const userStatuses = {};
            onlineUsers.forEach((data, userId) => {
                userStatuses[userId] = {
                    isOnline: true, // Jika ada di map onlineUsers, berarti online
                    isViewingChat: data.isViewingChat,
                    conversationId: data.conversationId, // Sertakan conversationId untuk konteks
                    role: data.role // Sertakan role untuk konteks
                };
            });

            socket.emit('online_users_update', {
                users: Array.from(onlineUsers.keys()), // Kirim daftar semua ID pengguna online
                statuses: userStatuses
            });
        }
    });

    socket.on('user_logout', (data) => {
        const { userId, isPemilikToko } = data;

        if (onlineUsers.has(userId)) {
            const user = onlineUsers.get(userId);
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
            onlineUsers.delete(userId);
            userSessions.delete(socket.id);

            // Emit user disconnected event
            io.emit('user_disconnected', { userId });

            logUserActivity(userId, 'EXPLICIT_LOGOUT', { socketId: socket.id, isPemilikToko });
            broadcastOnlineUsers();
        }
    });

    socket.on('join_room', (conversationId) => {
        if (conversationId) {
            socket.join(conversationId);
            const userId = userSessions.get(socket.id);
            logUserActivity(userId, 'JOINED_ROOM', { conversationId });
        }
    });

    socket.on('notify_seller', (data) => {
        const tokoUserId = `toko_${data.id_toko}`;
        const senderId = `pembeli_${data.message_data.sender_id}`;
        const tokoUser = onlineUsers.get(tokoUserId);

        if (tokoUser) {
            io.to(tokoUser.socketId).emit('seller_update_notification', data);
            logUserActivity(senderId, 'NOTIFIED_SELLER', {
                tokoUserId,
                messageId: data.message_data.id
            });

            // Determine check mark status
            const checkStatus = getCheckMarkStatus(senderId, tokoUserId);

            const senderUser = onlineUsers.get(senderId);
            if (senderUser) {
                io.to(senderUser.socketId).emit('update_message_status', {
                    messageIds: [data.message_data.id],
                    status: 'delivered',
                    checkMarkStatus: checkStatus
                });
            }
        } else {
            logUserActivity(senderId, 'SELLER_OFFLINE', {
                tokoUserId,
                messageId: data.message_data.id
            });

            // Sender gets single check when recipient is offline
            const senderUser = onlineUsers.get(senderId);
            if (senderUser) {
                io.to(senderUser.socketId).emit('update_message_status', {
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
        const recipientUser = onlineUsers.get(recipientId);

        if (recipientUser) {
            io.to(recipientUser.socketId).emit('receive_message', data);
            logUserActivity(senderId, 'SENT_MESSAGE_TO_BUYER', {
                recipientId,
                messageId: data.id
            });

            // Determine check mark status
            const checkStatus = getCheckMarkStatus(senderId, recipientId);

            const senderUser = onlineUsers.get(senderId);
            if (senderUser) {
                io.to(senderUser.socketId).emit('update_message_status', {
                    messageIds: [data.id],
                    status: 'delivered',
                    checkMarkStatus: checkStatus
                });
            }
        } else {
            logUserActivity(senderId, 'BUYER_OFFLINE', {
                recipientId,
                messageId: data.id
            });

            // Sender gets single check when recipient is offline
            const senderUser = onlineUsers.get(senderId);
            if (senderUser) {
                io.to(senderUser.socketId).emit('update_message_status', {
                    messageIds: [data.id],
                    status: 'sent',
                    checkMarkStatus: 'single'
                });
            }
        }
    });

    socket.on('mark_messages_as_read', (data) => {
        const { conversationId, readerId } = data;

        logUserActivity(readerId, 'MARKED_MESSAGES_READ', { conversationId });

        // Notify sender that messages were read (blue check)
        socket.to(conversationId).emit('messages_were_read', {
            conversationId,
            readerId,
            checkMarkStatus: 'double_blue'
        });
    });

    socket.on('check_online_status', (targetUserId) => {
        const status = getUserStatus(targetUserId);
        const user = onlineUsers.get(targetUserId);

        socket.emit('online_status_response', {
            userId: targetUserId,
            isOnline: status !== 'offline',
            isViewingChat: user ? user.isViewingChat : false,
            status: status
        });

        logUserActivity(targetUserId, 'STATUS_CHECKED', {
            requestedBy: userSessions.get(socket.id),
            status
        });
    });

    socket.on('typing_start', (data) => {
        const { userId, recipientId, conversationId } = data;

        logUserActivity(userId, 'TYPING_START', { recipientId, conversationId });

        if (recipientId) {
            const recipientUser = onlineUsers.get(recipientId);
            if (recipientUser) {
                io.to(recipientUser.socketId).emit('typing_start_from_server', {
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

        logUserActivity(userId, 'TYPING_STOP', { recipientId, conversationId });

        if (recipientId) {
            const recipientUser = onlineUsers.get(recipientId);
            if (recipientUser) {
                io.to(recipientUser.socketId).emit('typing_stop_from_server', {
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
        const userId = userSessions.get(socket.id);

        if (userId) {
            const user = onlineUsers.get(userId);
            if (user && user.conversationId) {
                // Notify others in the conversation that user is no longer viewing
                socket.to(user.conversationId).emit('user_viewing_status_changed', {
                    userId,
                    isViewing: false,
                    conversationId: user.conversationId
                });
                socket.leave(user.conversationId);
            }

            onlineUsers.delete(userId);
            userSessions.delete(socket.id);

            // Emit user disconnected event
            io.emit('user_disconnected', { userId });

            logUserActivity(userId, 'DISCONNECTED', { socketId: socket.id });
            broadcastOnlineUsers();
        }
    });
});

server.listen(port, () => {
    console.log(`🚀 Server chat berjalan di http://localhost:${port}`);
});