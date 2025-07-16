const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = mongoose.model("User");
const Message = mongoose.model("Message");

const initializeMessaging = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: "http://localhost:5000",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Socket.IO Authentication Middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication error: No token provided"));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("name email role");
      if (!user || !user.isVerified) {
        return next(new Error("Authentication error: Invalid or unverified user"));
      }
      socket.user = { id: user._id, name: user.name, email: user.email, role: user.role };
      next();
    } catch (error) {
      return next(new Error("Authentication error: Invalid token"));
    }
  });

  // Handle Socket.IO Connections
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.user.email} (${socket.user.role})`);
    socket.join(socket.user.id.toString()); // Join a room based on user ID

    // Fetch user list for admins or admins-only for students
    socket.on("getUsers", async (callback) => {
      try {
        let users;
        if (socket.user.role === "admin") {
          users = await User.find({ isVerified: true }).select("name email role").lean();
        } else {
          users = await User.find({ role: "admin", isVerified: true }).select("name email role").lean();
        }
        callback({ status: "success", users });
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
        // Validate receiver exists
        const receiver = await User.findById(receiverId);
        if (!receiver || !receiver.isVerified) {
          return callback({ status: "error", message: "Invalid receiver" });
        }
        // Restrict students to messaging admins only
        if (socket.user.role === "user" && receiver.role !== "admin") {
          return callback({ status: "error", message: "Students can only message admins" });
        }
        // Save message to database
        const message = new Message({
          sender: socket.user.id,
          receiver: receiverId,
          content,
          createdAt: new Date(),
          isRead: false,
        });
        await message.save();
        // Emit message to receiver
        io.to(receiverId).emit("receiveMessage", {
          sender: { id: socket.user.id, name: socket.user.name, email: socket.user.email },
          content,
          createdAt: message.createdAt,
          messageId: message._id,
        });
        // Notify sender of success
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
          .populate("sender", "name email")
          .populate("receiver", "name email")
          .sort({ createdAt: 1 })
          .lean();
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

  // API Route for fetching all messages (admin only)
  const router = require("express").Router();
  router.get("/messages", async (req, res) => {
    try {
      const adminEmails = process.env.ADMIN_EMAILS?.split(",") || [];
      if (!req.user || !adminEmails.includes(req.user.email)) {
        return res.status(403).json({ message: "Access denied. Admin only." });
      }
      const messages = await Message.find()
        .populate("sender", "name email role")
        .populate("receiver", "name email role")
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