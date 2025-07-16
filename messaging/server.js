const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = mongoose.model("User");
const Message = mongoose.model("Message");

const initializeMessaging = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: ["http://localhost:5000", "https://skill-shastra.vercel.app"],
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Socket.IO Authentication Middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      console.error("Socket.IO Auth Error: No token provided");
      return next(new Error("Authentication error: No token provided"));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("name email role isVerified profileImage");
      if (!user || !user.isVerified) {
        console.error("Socket.IO Auth Error: User not found or not verified:", decoded.id);
        return next(new Error("Authentication error: Invalid or unverified user"));
      }
      socket.user = {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage || "https://www.gravatar.com/avatar/?d=retro",
      };
      console.log("Socket.IO Auth Success: User:", socket.user.email);
      next();
    } catch (error) {
      console.error("Socket.IO Auth Error:", error.message, { token });
      return next(new Error("Authentication error: Invalid token"));
    }
  });

  // Handle Socket.IO Connections
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.user.email} (${socket.user.role})`);
    socket.join(socket.user.id);

    // Fetch user list with unread message counts and sort by recent messages
    socket.on("getUsers", async (callback) => {
      try {
        let users;
        if (socket.user.role === "admin") {
          users = await User.find({ isVerified: true }).select("name email role profileImage").lean();
        } else {
          users = await User.find({ role: "admin", isVerified: true }).select("name email role profileImage").lean();
        }
        const usersWithDetails = await Promise.all(users.map(async (user) => {
          const unreadCount = await Message.countDocuments({
            sender: user._id,
            receiver: socket.user.id,
            isRead: false
          });
          const latestMessage = await Message.findOne({
            $or: [
              { sender: socket.user.id, receiver: user._id },
              { sender: user._id, receiver: socket.user.id }
            ]
          })
            .sort({ createdAt: -1 })
            .lean();
          return {
            ...user,
            _id: user._id.toString(),
            unreadCount,
            lastMessageTime: latestMessage ? latestMessage.createdAt : new Date(0)
          };
        }));
        usersWithDetails.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
        console.log("Sending users to client:", usersWithDetails.map(u => ({ id: u._id, name: u.name, unreadCount: u.unreadCount, lastMessageTime: u.lastMessageTime })));
        callback({ status: "success", users: usersWithDetails });
      } catch (error) {
        console.error("Error fetching users:", error);
        callback({ status: "error", message: "Failed to fetch users" });
      }
    });

    // Handle sending messages
    socket.on("sendMessage", async ({ receiverId, content }, callback) => {
      try {
        if (!receiverId || !content) {
          return callback({ status: "error", message: "Receiver ID and content are required" });
        }
        const receiver = await User.findById(receiverId);
        if (!receiver || !receiver.isVerified) {
          return callback({ status: "error", message: "Receiver not found or not verified" });
        }
        if (socket.user.role === "user" && receiver.role !== "admin") {
          return callback({ status: "error", message: "Users can only message admins" });
        }
        const message = new Message({
          sender: socket.user.id,
          receiver: receiverId,
          content,
          createdAt: new Date(),
          isRead: false,
        });
        await message.save();
        const messageData = {
          sender: {
            id: socket.user.id,
            name: socket.user.name,
            email: socket.user.email,
            profileImage: socket.user.profileImage,
          },
          receiver: {
            id: receiver._id.toString(),
            name: receiver.name,
            email: receiver.email,
            profileImage: receiver.profileImage || "https://www.gravatar.com/avatar/?d=retro",
          },
          content,
          createdAt: message.createdAt,
          messageId: message._id.toString(),
        };
        io.to(receiverId).emit("receiveMessage", messageData);
        io.to(socket.user.id).emit("receiveMessage", messageData);
        console.log(`Message sent from ${socket.user.id} to ${receiverId}: ${content}`);
        // Update user lists for both sender and receiver
        const updateUsers = async (userId) => {
          const users = socket.user.role === "admin"
            ? await User.find({ isVerified: true }).select("name email role profileImage").lean()
            : await User.find({ role: "admin", isVerified: true }).select("name email role profileImage").lean();
          const usersWithDetails = await Promise.all(users.map(async (user) => {
            const unreadCount = await Message.countDocuments({
              sender: user._id,
              receiver: userId,
              isRead: false
            });
            const latestMessage = await Message.findOne({
              $or: [
                { sender: userId, receiver: user._id },
                { sender: user._id, receiver: userId }
              ]
            })
              .sort({ createdAt: -1 })
              .lean();
            return {
              ...user,
              _id: user._id.toString(),
              unreadCount,
              lastMessageTime: latestMessage ? latestMessage.createdAt : new Date(0)
            };
          }));
          usersWithDetails.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
          io.to(userId).emit("updateUsers", { users: usersWithDetails });
          console.log(`Updated user list for ${userId}`);
        };
        await updateUsers(socket.user.id);
        await updateUsers(receiverId);
        callback({ status: "success", message: "Message sent" });
      } catch (error) {
        console.error("Error sending message:", error);
        callback({ status: "error", message: "Failed to send message" });
      }
    });

    // Fetch message history
    socket.on("getMessages", async ({ userId }, callback) => {
      try {
        const messages = await Message.find({
          $or: [
            { sender: socket.user.id, receiver: userId },
            { sender: userId, receiver: socket.user.id },
          ],
        })
          .populate("sender", "name email profileImage")
          .populate("receiver", "name email profileImage")
          .sort({ createdAt: 1 })
          .lean();
        await Message.updateMany(
          { receiver: socket.user.id, sender: userId, isRead: false },
          { isRead: true }
        );
        const updateUsers = async (targetUserId) => {
          const users = socket.user.role === "admin"
            ? await User.find({ isVerified: true }).select("name email role profileImage").lean()
            : await User.find({ role: "admin", isVerified: true }).select("name email role profileImage").lean();
          const usersWithDetails = await Promise.all(users.map(async (user) => {
            const unreadCount = await Message.countDocuments({
              sender: user._id,
              receiver: targetUserId,
              isRead: false
            });
            const latestMessage = await Message.findOne({
              $or: [
                { sender: targetUserId, receiver: user._id },
                { sender: user._id, receiver: targetUserId }
              ]
            })
              .sort({ createdAt: -1 })
              .lean();
            return {
              ...user,
              _id: user._id.toString(),
              unreadCount,
              lastMessageTime: latestMessage ? latestMessage.createdAt : new Date(0)
            };
          }));
          usersWithDetails.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
          io.to(targetUserId).emit("updateUsers", { users: usersWithDetails });
          console.log(`Updated user list for ${targetUserId}`);
        };
        await updateUsers(socket.user.id);
        await updateUsers(userId);
        console.log(`Fetched ${messages.length} messages for user ${userId}`);
        callback({ status: "success", messages });
      } catch (error) {
        console.error("Error fetching messages:", error);
        callback({ status: "error", message: "Failed to fetch messages" });
      }
    });

    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.user.email}`);
    });
  });

  const router = require("express").Router();
  router.get("/messages", async (req, res) => {
    try {
      const messages = await Message.find()
        .populate("sender", "name email role profileImage")
        .populate("receiver", "name email role profileImage")
        .sort({ createdAt: -1 })
        .lean();
      res.status(200).json({ message: "Messages fetched successfully", messages });
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  return { io, router };
};

module.exports = initializeMessaging;