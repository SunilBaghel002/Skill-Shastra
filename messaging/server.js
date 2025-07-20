const express = require("express");
const Ably = require("ably");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { v2: cloudinary } = require("cloudinary");

// Initialize Express Router
const router = express.Router();

// Ably Client
const ably = new Ably.Realtime({
  key: process.env.ABLY_API_KEY,
  echoMessages: false,
});

// Ably Token Request Endpoint
router.get("/ably-auth", async (req, res) => {
  try {
    const token = req.query.token || req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const User = mongoose.model("User");
    const user = await User.findById(decoded.id).select("name email role isVerified");
    if (!user || !user.isVerified) {
      return res.status(401).json({ message: "Invalid or unverified user" });
    }
    const tokenRequest = await ably.auth.createTokenRequest({
      clientId: user._id.toString(),
      capability: {
        "chat:*": ["subscribe", "publish", "presence"],
        "call:*": ["subscribe", "publish"], // Added for WebRTC call signaling
        "presence": ["subscribe", "presence"], // Updated channel name
      },
    });
    res.status(200).json(tokenRequest);
  } catch (error) {
    console.error("Ably Auth Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// Get Users Endpoint with Search and Category Filtering
router.get("/users", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const { query = "", category = "all" } = req.query; // Added category filter
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const User = mongoose.model("User");
    const Message = mongoose.model("Message");
    const currentUser = await User.findById(decoded.id).select("name email role favorites isVerified");
    if (!currentUser || !currentUser.isVerified) {
      return res.status(401).json({ message: "Invalid or unverified user" });
    }

    let userQuery = { isVerified: true };
    if (currentUser.role === "admin") {
      userQuery = { isVerified: true, _id: { $ne: currentUser._id } }; // Exclude current user for admins
    } else {
      userQuery = { role: "admin", isVerified: true }; // Users only see admins
    }

    // Search filtering
    if (query) {
      userQuery.$or = [
        { name: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
      ];
    }

    let users = await User.find(userQuery).select("name email role profileImage isOnline").lean();

    const usersWithDetails = await Promise.all(
      users.map(async (user) => {
        const messageQuery = {
          $or: [
            { sender: currentUser._id, receiver: user._id },
            { sender: user._id, receiver: currentUser._id },
          ],
        };
        const unreadCount = await Message.countDocuments({
          sender: user._id,
          receiver: currentUser._id,
          isRead: false,
        });
        const latestMessage = await Message.findOne(messageQuery)
          .sort({ createdAt: -1 })
          .lean();
        return {
          _id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          profileImage: user.profileImage || "https://www.gravatar.com/avatar/?d=retro",
          isOnline: user.isOnline || false,
          unreadCount,
          lastMessage: latestMessage ? latestMessage.content : "No messages yet",
          lastMessageTime: latestMessage ? latestMessage.createdAt : null,
          isFavorite: currentUser.favorites?.map((id) => id.toString()).includes(user._id.toString()) || false,
        };
      })
    );

    // Filter by category (all or unread)
    const filteredUsers = category === "unread" ? usersWithDetails.filter((user) => user.unreadCount > 0) : usersWithDetails;

    // Sort by last message time
    filteredUsers.sort((a, b) => {
      const aTime = a.lastMessageTime ? new Date(a.lastMessageTime) : new Date(0);
      const bTime = b.lastMessageTime ? new Date(b.lastMessageTime) : new Date(0);
      return bTime - aTime;
    });

    res.status(200).json({ status: "success", users: filteredUsers });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch users" });
  }
});

// Toggle Favorite Endpoint
router.post("/toggle-favorite", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const { userId } = req.body;
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const User = mongoose.model("User");
    const currentUser = await User.findById(decoded.id);
    if (!currentUser || !currentUser.isVerified) {
      return res.status(401).json({ message: "Invalid or unverified user" });
    }
    const isFavorite = currentUser.favorites.includes(userId);
    if (isFavorite) {
      currentUser.favorites.pull(userId);
    } else {
      currentUser.favorites.push(userId);
    }
    await currentUser.save();
    const channel = ably.channels.get(`chat:${[currentUser._id, userId].sort().join(":")}`);
    await channel.publish("favoriteStatus", {
      userId,
      isFavorite: !isFavorite,
    });
    res.status(200).json({ status: "success", isFavorite: !isFavorite });
  } catch (error) {
    console.error("Error toggling favorite:", error);
    res.status(500).json({ status: "error", message: "Failed to toggle favorite" });
  }
});

// Get Messages Endpoint
router.get("/messages/:userId", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const { userId } = req.params;
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const User = mongoose.model("User");
    const Message = mongoose.model("Message");
    const currentUser = await User.findById(decoded.id).select("name email role isVerified");
    if (!currentUser || !currentUser.isVerified) {
      return res.status(401).json({ message: "Invalid or unverified user" });
    }
    const receiver = await User.findById(userId);
    if (!receiver || !receiver.isVerified) {
      return res.status(404).json({ message: "Receiver not found or not verified" });
    }
    if (currentUser.role === "user" && receiver.role !== "admin") {
      return res.status(403).json({ message: "Users can only message admins" });
    }
    const messages = await Message.find({
      $or: [
        { sender: currentUser._id, receiver: userId },
        { sender: userId, receiver: currentUser._id },
      ],
    })
      .populate("sender", "name email profileImage")
      .populate("receiver", "name email profileImage")
      .select("sender receiver content messageType createdAt isRead fileMetadata")
      .sort({ createdAt: 1 })
      .lean();
    await Message.updateMany(
      { receiver: currentUser._id, sender: userId, isRead: false },
      { isRead: true }
    );
    const channel = ably.channels.get(`chat:${[currentUser._id, userId].sort().join(":")}`);
    await channel.publish("messageStatusUpdate", {
      messageId: null,
      status: "delivered",
      isRead: true,
    });
    const formattedMessages = messages.map((msg) => ({
      sender: {
        _id: msg.sender._id.toString(),
        name: msg.sender.name,
        email: msg.sender.email,
        profileImage: msg.sender.profileImage || "https://www.gravatar.com/avatar/?d=retro",
      },
      receiver: {
        _id: msg.receiver._id.toString(),
        name: msg.receiver.name,
        email: msg.receiver.email,
        profileImage: msg.receiver.profileImage || "https://www.gravatar.com/avatar/?d=retro",
      },
      content: msg.content,
      messageType: msg.messageType || "text",
      fileMetadata: msg.fileMetadata || {},
      createdAt: msg.createdAt,
      _id: msg._id.toString(),
      isRead: msg.isRead,
    }));
    res.status(200).json({ status: "success", messages: formattedMessages });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch messages" });
  }
});

// Send Message Endpoint
router.post("/send-message", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const { receiverId, content, messageType = "text", fileName, fileSize, fileType } = req.body;
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }
    if (!receiverId || !content) {
      return res.status(400).json({ message: "Receiver ID and content are required" });
    }
    if (!mongoose.Types.ObjectId.isValid(receiverId)) {
      return res.status(400).json({ message: "Invalid receiver ID" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const User = mongoose.model("User");
    const Message = mongoose.model("Message");
    const sender = await User.findById(decoded.id).select("name email role profileImage isVerified");
    if (!sender || !sender.isVerified) {
      return res.status(401).json({ message: "Invalid or unverified user" });
    }
    const receiver = await User.findById(receiverId).select("name email role profileImage isVerified");
    if (!receiver || !receiver.isVerified) {
      return res.status(404).json({ message: "Receiver not found or not verified" });
    }
    if (sender.role === "user" && receiver.role !== "admin") {
      return res.status(403).json({ message: "Users can only message admins" });
    }
    let finalMessageType = messageType;
    let fileMetadata = messageType !== "text" ? { fileName, fileSize, fileType } : {};
    let secureUrl = content;

    if (content.startsWith("data:") || content.startsWith("https://res.cloudinary.com/")) {
      const allowedTypes = {
        image: ["image/png", "image/jpeg", "image/jpg"],
        audio: ["audio/mpeg", "audio/wav", "audio/webm"],
        document: [
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
      };
      if (fileType && !Object.values(allowedTypes).flat().includes(fileType)) {
        return res.status(400).json({
          message: `Invalid file type. Allowed: ${Object.values(allowedTypes).flat().join(", ")}`,
        });
      }
      if (content.startsWith("https://res.cloudinary.com/")) {
        if (content.endsWith(".jpg") || content.endsWith(".png") || content.endsWith(".jpeg")) {
          finalMessageType = "image";
          fileMetadata = {
            fileName: fileName || `image_${Date.now()}.jpg`,
            fileSize: fileSize || 0,
            fileType: fileType || (content.endsWith(".png") ? "image/png" : "image/jpeg"),
          };
        } else if (content.endsWith(".mp3") || content.endsWith(".wav") || content.endsWith(".webm")) {
          finalMessageType = "audio";
          fileMetadata = {
            fileName: fileName || `audio_${Date.now()}.webm`,
            fileSize: fileSize || 0,
            fileType: fileType || (content.endsWith(".mp3") ? "audio/mpeg" : content.endsWith(".wav") ? "audio/wav" : "audio/webm"),
          };
        } else if (content.endsWith(".pdf") || content.endsWith(".doc") || content.endsWith(".docx")) {
          finalMessageType = "document";
          fileMetadata = {
            fileName: fileName || `document_${Date.now()}.pdf`,
            fileSize: fileSize || 0,
            fileType: fileType || (content.endsWith(".pdf") ? "application/pdf" : content.endsWith(".doc") ? "application/msword" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
          };
        }
      } else if (content.startsWith("data:")) {
        const maxSizeMB = 5;
        const base64Size = (content.length * 3) / 4 / (1024 * 1024);
        if (base64Size > maxSizeMB) {
          return res.status(400).json({
            message: `${finalMessageType.charAt(0).toUpperCase() + finalMessageType.slice(1)} size must be less than ${maxSizeMB}MB`,
          });
        }
        const base64Regex = new RegExp(`^data:${fileType?.replace("/", "\\/") || "[^;]+"};base64,`);
        if (!base64Regex.test(content)) {
          return res.status(400).json({ message: `Invalid ${finalMessageType} format` });
        }
        const resourceType = finalMessageType === "image" ? "image" : finalMessageType === "audio" ? "video" : "raw";
        const uploadResult = await cloudinary.uploader.upload(content, {
          resource_type: resourceType,
          folder: `skillshastra/${finalMessageType}s`,
          public_id: `${sender._id}_${Date.now()}_${fileName || finalMessageType}`,
        });
        secureUrl = uploadResult.secure_url;
        fileMetadata = {
          fileName: fileName || `${finalMessageType}_${Date.now()}`,
          fileSize: uploadResult.bytes || fileSize || 0,
          fileType: fileType || (finalMessageType === "image" ? "image/jpeg" : finalMessageType === "audio" ? "audio/webm" : "application/pdf"),
        };
      }
    }

    const message = new Message({
      sender: sender._id,
      receiver: receiverId,
      content: secureUrl,
      messageType: finalMessageType,
      fileMetadata,
      createdAt: new Date(),
      isRead: false,
    });
    await message.save();

    const messageData = {
      senderId: sender._id.toString(),
      senderName: sender.name,
      receiverId: receiver._id.toString(),
      content: secureUrl,
      messageType: finalMessageType,
      fileMetadata,
      timestamp: message.createdAt,
      messageId: message._id.toString(),
      isRead: false,
    };
    const channelName = `chat:${[sender._id, receiverId].sort().join(":")}`;
    const ablyChannel = ably.channels.get(channelName);
    await ablyChannel.publish("message", messageData);

    res.status(200).json({
      status: "success",
      message: "Message sent",
      messageId: message._id.toString(),
    });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ status: "error", message: "Failed to send message" });
  }
});

// Clear Chats Endpoint
router.post("/clear-chats", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const { userId } = req.body;
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const User = mongoose.model("User");
    const Message = mongoose.model("Message");
    const currentUser = await User.findById(decoded.id);
    if (!currentUser || !currentUser.isVerified) {
      return res.status(401).json({ message: "Invalid or unverified user" });
    }
    await Message.deleteMany({
      $or: [
        { sender: currentUser._id, receiver: userId },
        { sender: userId, receiver: currentUser._id },
      ],
    });
    const channel = ably.channels.get(`chat:${[currentUser._id, userId].sort().join(":")}`);
    await channel.publish("chatsCleared", { status: "success" });
    res.status(200).json({ status: "success", message: "Chats cleared" });
  } catch (error) {
    console.error("Error clearing chats:", error);
    res.status(500).json({ status: "error", message: "Failed to clear chats" });
  }
});

// Get User Profile Endpoint
router.get("/user/:userId", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const { userId } = req.params;
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const User = mongoose.model("User");
    const currentUser = await User.findById(decoded.id);
    if (!currentUser || !currentUser.isVerified) {
      return res.status(401).json({ message: "Invalid or unverified user" });
    }
    const user = await User.findById(userId).select("name email role profileImage isOnline").lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({
      status: "success",
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage || "https://www.gravatar.com/avatar/?d=retro",
        isOnline: user.isOnline || false,
      },
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch user profile" });
  }
});

// Presence Handling
ably.connection.on("connected", () => {
  console.log("Connected to Ably");
});

const presenceChannel = ably.channels.get("presence"); // Updated channel name to match frontend
const onlineUsers = new Map();

presenceChannel.presence.subscribe("enter", async (member) => {
  try {
    const User = mongoose.model("User");
    await User.findByIdAndUpdate(member.clientId, { isOnline: true });
    onlineUsers.set(member.clientId, true);
    const members = await presenceChannel.presence.get();
    const userStatus = members.map((m) => ({
      userId: m.clientId,
      isOnline: true,
    }));
    await presenceChannel.publish("onlineStatus", userStatus);
  } catch (error) {
    console.error("Presence enter error:", error);
  }
});

presenceChannel.presence.subscribe("leave", async (member) => {
  try {
    const User = mongoose.model("User");
    await User.findByIdAndUpdate(member.clientId, { isOnline: false });
    onlineUsers.delete(member.clientId);
    await presenceChannel.publish("onlineStatus", [
      { userId: member.clientId, isOnline: false },
    ]);
  } catch (error) {
    console.error("Presence leave error:", error);
  }
});

// Typing Indicator Endpoint
router.post("/typing", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const { receiverId, isTyping } = req.body;
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }
    if (!mongoose.Types.ObjectId.isValid(receiverId)) {
      return res.status(400).json({ message: "Invalid receiver ID" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const User = mongoose.model("User");
    const sender = await User.findById(decoded.id);
    if (!sender || !sender.isVerified) {
      return res.status(401).json({ message: "Invalid or unverified user" });
    }
    const receiver = await User.findById(receiverId);
    if (!receiver || !receiver.isVerified) {
      return res.status(404).json({ message: "Receiver not found or not verified" });
    }
    if (sender.role === "user" && receiver.role !== "admin") {
      return res.status(403).json({ message: "Users can only message admins" });
    }
    const channel = ably.channels.get(`chat:${[sender._id, receiverId].sort().join(":")}`);
    await channel.publish("typing", {
      senderId: sender._id.toString(),
      isTyping,
    });
    res.status(200).json({ status: "success", message: "Typing status sent" });
  } catch (error) {
    console.error("Error sending typing status:", error);
    res.status(500).json({ status: "error", message: "Failed to send typing status" });
  }
});

// Export Router
module.exports = { router };