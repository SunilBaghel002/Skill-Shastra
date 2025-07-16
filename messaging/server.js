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
    transports: ["websocket", "polling"],
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      console.error("Socket.IO Auth Error: No token provided");
      return next(new Error("Authentication error: No token provided"));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("name email role isVerified profileImage favorites");
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
        favorites: user.favorites ? user.favorites.map(id => id.toString()) : [],
      };
      console.log("Socket.IO Auth Success: User:", socket.user.email, "ID:", socket.user.id);
      next();
    } catch (error) {
      console.error("Socket.IO Auth Error:", error.message, { token });
      return next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.user.email} (${socket.user.role}, ID: ${socket.user.id})`);
    socket.join(socket.user.id);
    console.log(`User ${socket.user.id} joined room: ${socket.user.id}`);

    socket.on("rejoinRooms", () => {
      socket.join(socket.user.id);
      console.log(`User ${socket.user.id} rejoined room: ${socket.user.id}`);
    });

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
            lastMessageTime: latestMessage ? latestMessage.createdAt : new Date(0),
            isFavorite: socket.user.favorites.includes(user._id.toString())
          };
        }));
        usersWithDetails.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
        console.log("Sending users to client:", usersWithDetails.map(u => ({ id: u._id, name: u.name, unreadCount: u.unreadCount, isFavorite: u.isFavorite })));
        callback({ status: "success", users: usersWithDetails });
      } catch (error) {
        console.error("Error fetching users:", error);
        callback({ status: "error", message: "Failed to fetch users" });
      }
    });

    socket.on("toggleFavorite", async ({ userId }, callback) => {
      try {
        const currentUser = await User.findById(socket.user.id);
        const isFavorite = currentUser.favorites.includes(userId);
        if (isFavorite) {
          currentUser.favorites.pull(userId);
        } else {
          currentUser.favorites.push(userId);
        }
        await currentUser.save();
        socket.user.favorites = currentUser.favorites.map(id => id.toString());
        console.log(`Toggled favorite for user ${userId}: ${!isFavorite}`);
        callback({ status: "success", isFavorite: !isFavorite });
        socket.emit("getUsers", (response) => {
          if (response.status === "success") {
            io.to(socket.user.id).emit("updateUsers", { users: response.users });
          }
        });
      } catch (error) {
        console.error("Error toggling favorite:", error);
        callback({ status: "error", message: "Failed to toggle favorite" });
      }
    });

    socket.on("sendMessage", async ({ receiverId, content, messageType }, callback) => {
      try {
        if (!receiverId || !content || !messageType) {
          console.error("SendMessage Error: Missing receiverId, content, or messageType", { receiverId, content, messageType });
          return callback({ status: "error", message: "Receiver ID, content, and message type are required" });
        }
        const receiver = await User.findById(receiverId);
        if (!receiver || !receiver.isVerified) {
          console.error("SendMessage Error: Receiver not found or not verified:", receiverId);
          return callback({ status: "error", message: "Receiver not found or not verified" });
        }
        if (socket.user.role === "user" && receiver.role !== "admin") {
          console.error("SendMessage Error: User attempted to message non-admin:", { sender: socket.user.id, receiver: receiverId });
          return callback({ status: "error", message: "Users can only message admins" });
        }
        if (messageType === "image") {
          const base64Regex = /^data:image\/(png|jpeg|jpg);base64,/;
          if (!base64Regex.test(content)) {
            console.error("SendMessage Error: Invalid image format");
            return callback({ status: "error", message: "Invalid image format" });
          }
          const base64Data = content.replace(base64Regex, "");
          const buffer = Buffer.from(base64Data, "base64");
          if (buffer.length > 5 * 1024 * 1024) {
            console.error("SendMessage Error: Image size exceeds 5MB");
            return callback({ status: "error", message: "Image size must be less than 5MB" });
          }
        }
        const message = new Message({
          sender: socket.user.id,
          receiver: receiverId,
          content,
          messageType,
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
          messageType,
          createdAt: message.createdAt,
          messageId: message._id.toString(),
        };
        console.log(`Emitting receiveMessage to sender room: ${socket.user.id}, receiver room: ${receiverId}`, messageData);
        io.to(receiverId).emit("receiveMessage", messageData);
        io.to(socket.user.id).emit("receiveMessage", messageData);
        console.log(`Message sent from ${socket.user.id} to ${receiverId}: ${messageType}`);
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
              lastMessageTime: latestMessage ? latestMessage.createdAt : new Date(0),
              isFavorite: socket.user.favorites.includes(user._id.toString())
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

    socket.on("clearChats", async ({ userId }, callback) => {
      try {
        await Message.deleteMany({
          $or: [
            { sender: socket.user.id, receiver: userId },
            { sender: userId, receiver: socket.user.id }
          ]
        });
        console.log(`Cleared chats between ${socket.user.id} and ${userId}`);
        callback({ status: "success", message: "Chats cleared" });
        socket.emit("getMessages", { userId }, (response) => {
          if (response.status === "success") {
            io.to(socket.user.id).emit("updateMessages", { messages: response.messages });
          }
        });
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
              lastMessageTime: latestMessage ? latestMessage.createdAt : new Date(0),
              isFavorite: socket.user.favorites.includes(user._id.toString())
            };
          }));
          usersWithDetails.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
          io.to(targetUserId).emit("updateUsers", { users: usersWithDetails });
        };
        await updateUsers(socket.user.id);
      } catch (error) {
        console.error("Error clearing chats:", error);
        callback({ status: "error", message: "Failed to clear chats" });
      }
    });

    socket.on("getUserProfile", async ({ userId }, callback) => {
      try {
        const user = await User.findById(userId).select("name email role profileImage").lean();
        if (!user) {
          console.error("GetUserProfile Error: User not found:", userId);
          return callback({ status: "error", message: "User not found" });
        }
        callback({
          status: "success",
          user: {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role,
            profileImage: user.profileImage || "https://www.gravatar.com/avatar/?d=retro",
          }
        });
      } catch (error) {
        console.error("Error fetching user profile:", error);
        callback({ status: "error", message: "Failed to fetch user profile" });
      }
    });

    socket.on("getMessages", async ({ userId }, callback) => {
      try {
        console.log(`Fetching messages for user ${socket.user.id} with user ${userId}`);
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
              lastMessageTime: latestMessage ? latestMessage.createdAt : new Date(0),
              isFavorite: socket.user.favorites.includes(user._id.toString())
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
      console.log(`User disconnected: ${socket.user.email} (ID: ${socket.user.id})`);
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