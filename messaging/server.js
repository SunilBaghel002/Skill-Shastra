const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const User = mongoose.model("User");
const Message = mongoose.model("Message");

// Define Call Schema
const CallSchema = new mongoose.Schema({
  caller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  offer: { type: Object, required: false },
  status: {
    type: String,
    enum: ["pending", "accepted", "rejected", "ended"],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
const Call = mongoose.model("Call", CallSchema);

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const initializeMessaging = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        const allowedOrigins = [
          "http://localhost:5000",
          "http://localhost:3000",
          "https://skill-shastra.vercel.app",
        ];
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.error(`CORS Error: Origin ${origin} not allowed`);
          callback(new Error("Not allowed by CORS"));
        }
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingTimeout: 20000,
    pingInterval: 25000,
    maxHttpBufferSize: 10 * 1024 * 1024,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      console.error("Socket.IO Auth Error: No token provided");
      return next(new Error("Authentication error: No token provided"));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select(
        "name email role isVerified profileImage favorites"
      );
      if (!user || !user.isVerified) {
        console.error(
          "Socket.IO Auth Error: User not found or not verified:",
          decoded.id
        );
        return next(
          new Error("Authentication error: Invalid or unverified user")
        );
      }
      socket.user = {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        profileImage:
          user.profileImage || "https://www.gravatar.com/avatar/?d=retro",
        favorites: user.favorites
          ? user.favorites.map((id) => id.toString())
          : [],
      };
      console.log(
        "Socket.IO Auth Success: User:",
        socket.user.email,
        "ID:",
        socket.user.id
      );
      next();
    } catch (error) {
      console.error("Socket.IO Auth Error:", error.message, { token });
      return next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(
      `User connected: ${socket.user.email} (${socket.user.role}, ID: ${socket.user.id}, Socket: ${socket.id})`
    );
    socket.join(`room:${socket.user.id}`);
    console.log(
      `User ${socket.user.id} joined room: room:${socket.user.id}, rooms:`,
      Array.from(io.sockets.adapter.rooms.get(`room:${socket.user.id}`) || [])
    );

    // Check for pending messages and calls on connection
    const checkPendingMessages = async () => {
      const pendingMessages = await Message.find({
        receiver: socket.user.id,
        isRead: false,
      })
        .populate("sender", "name email profileImage")
        .populate("receiver", "name email profileImage")
        .lean();
      pendingMessages.forEach((msg) => {
        const messageData = {
          sender: {
            id: msg.sender._id.toString(),
            name: msg.sender.name,
            email: msg.sender.email,
            profileImage:
              msg.sender.profileImage ||
              "https://www.gravatar.com/avatar/?d=retro",
          },
          receiver: {
            id: msg.receiver._id.toString(),
            name: msg.receiver.name,
            email: msg.receiver.email,
            profileImage:
              msg.receiver.profileImage ||
              "https://www.gravatar.com/avatar/?d=retro",
          },
          content: msg.content,
          messageType: msg.messageType || "text",
          fileMetadata: msg.fileMetadata,
          createdAt: msg.createdAt,
          messageId: msg._id.toString(),
          isRead: msg.isRead,
        };
        console.log(
          `Emitting pending receiveMessage to ${
            socket.user.id
          }, messageId: ${msg._id.toString()}`,
          { content: msg.content.substring(0, 50) + "..." }
        );
        socket.emit("receiveMessage", messageData);
      });
    };

    const checkPendingCalls = async () => {
      const calls = await Call.find({
        receiver: socket.user.id,
        status: "pending",
      })
        .populate("caller", "name")
        .lean();
      calls.forEach((call) => {
        console.log(
          `Emitting pending incomingCall to ${socket.user.id} from ${call.caller._id}`,
          { callId: call._id.toString() }
        );
        socket.emit("incomingCall", {
          from: call.caller._id.toString(),
          callerName: call.caller.name,
          offer: call.offer,
          callId: call._id.toString(),
        });
      });
    };

    checkPendingMessages();
    checkPendingCalls();

    socket.on("rejoinRooms", () => {
      if (!socket.user?.id) {
        console.error("RejoinRooms Error: socket.user.id is undefined", {
          socketId: socket.id,
        });
        return;
      }
      socket.join(`room:${socket.user.id}`);
      console.log(
        `User ${socket.user.id} rejoined room: room:${socket.user.id}, rooms:`,
        Array.from(io.sockets.adapter.rooms.get(`room:${socket.user.id}`) || [])
      );
      checkPendingMessages();
      checkPendingCalls();
    });

    socket.on("getUsers", async (callback) => {
      try {
        let users;
        if (socket.user.role === "admin") {
          users = await User.find({ isVerified: true })
            .select("name email role profileImage")
            .lean();
        } else {
          users = await User.find({ role: "admin", isVerified: true })
            .select("name email role profileImage")
            .lean();
        }
        const usersWithDetails = await Promise.all(
          users.map(async (user) => {
            const unreadCount = await Message.countDocuments({
              sender: user._id,
              receiver: socket.user.id,
              isRead: false,
            });
            const latestMessage = await Message.findOne({
              $or: [
                { sender: socket.user.id, receiver: user._id },
                { sender: user._id, receiver: socket.user.id },
              ],
            })
              .sort({ createdAt: -1 })
              .lean();
            return {
              ...user,
              _id: user._id.toString(),
              unreadCount,
              lastMessage: latestMessage
                ? {
                    content: latestMessage.content,
                    createdAt: latestMessage.createdAt,
                  }
                : null,
              isFavorite: socket.user.favorites.includes(user._id.toString()),
            };
          })
        );
        usersWithDetails.sort((a, b) => {
          const aTime = a.lastMessage
            ? new Date(a.lastMessage.createdAt)
            : new Date(0);
          const bTime = b.lastMessage
            ? new Date(b.lastMessage.createdAt)
            : new Date(0);
          return bTime - aTime;
        });
        console.log(
          `Sending users to ${socket.user.id}:`,
          usersWithDetails.map((u) => ({
            id: u._id,
            name: u.name,
            unreadCount: u.unreadCount,
            isFavorite: u.isFavorite,
          }))
        );
        if (typeof callback === "function") {
          callback({ status: "success", users: usersWithDetails });
        }
      } catch (error) {
        console.error("Error fetching users:", error);
        if (typeof callback === "function") {
          callback({ status: "error", message: "Failed to fetch users" });
        }
      }
    });

    socket.on("toggleFavorite", async ({ userId }, callback) => {
      try {
        const currentUser = await User.findById(socket.user.id);
        const isFavorite = currentUser.favorites.includes(userId);
        if (isFavorite) {
          currentUser.favorites.pull(userId);
        } else {
          if (!currentUser.favorites.includes(userId)) {
            currentUser.favorites.push(userId);
          }
        }
        await currentUser.save();
        socket.user.favorites = currentUser.favorites.map((id) =>
          id.toString()
        );
        console.log(
          `Toggled favorite for user ${userId} by ${
            socket.user.id
          }: ${!isFavorite}`
        );
        if (typeof callback === "function") {
          callback({ status: "success", isFavorite: !isFavorite });
        }
        socket.emit("getUsers", (response) => {
          if (response.status === "success") {
            io.to(`room:${socket.user.id}`).emit("updateUsers", {
              users: response.users,
            });
          }
        });
      } catch (error) {
        console.error("Error toggling favorite:", error);
        if (typeof callback === "function") {
          callback({ status: "error", message: "Failed to toggle favorite" });
        }
      }
    });

    socket.on(
      "sendMessage",
      async (
        { receiverId, content, messageType, fileName, fileSize, fileType },
        callback
      ) => {
        try {
          if (!receiverId || !content) {
            console.error("SendMessage Error: Missing receiverId or content", {
              receiverId,
              content,
              sender: socket.user.id,
            });
            if (typeof callback === "function") {
              return callback({
                status: "error",
                message: "Receiver ID and content are required",
              });
            }
            return;
          }
          const receiver = await User.findById(receiverId);
          if (!receiver || !receiver.isVerified) {
            console.error(
              "SendMessage Error: Receiver not found or not verified:",
              receiverId
            );
            if (typeof callback === "function") {
              return callback({
                status: "error",
                message: "Receiver not found or not verified",
              });
            }
            return;
          }
          if (socket.user.role === "user" && receiver.role !== "admin") {
            console.error(
              "SendMessage Error: User attempted to message non-admin:",
              { sender: socket.user.id, receiver: receiverId }
            );
            if (typeof callback === "function") {
              return callback({
                status: "error",
                message: "Users can only message admins",
              });
            }
            return;
          }

          let finalMessageType = messageType || "text";
          let fileMetadata =
            messageType !== "text"
              ? {
                  fileName: fileName || "uploaded_file",
                  fileSize: fileSize || 0,
                  fileType: fileType || "application/octet-stream",
                }
              : undefined;
          let secureUrl = content;

          if (
            content.startsWith("data:") ||
            content.startsWith("https://res.cloudinary.com/")
          ) {
            const allowedTypes = {
              image: ["image/png", "image/jpeg", "image/jpg"],
              audio: ["audio/mpeg", "audio/wav", "audio/webm"],
              document: [
                "application/pdf",
                "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              ],
            };

            if (
              fileType &&
              !Object.values(allowedTypes).flat().includes(fileType)
            ) {
              console.error("SendMessage Error: Invalid file type:", fileType);
              if (typeof callback === "function") {
                return callback({
                  status: "error",
                  message: `Invalid file type. Allowed: ${Object.values(
                    allowedTypes
                  )
                    .flat()
                    .join(", ")}`,
                });
              }
              return;
            }

            if (content.startsWith("https://res.cloudinary.com/")) {
              if (
                content.endsWith(".jpg") ||
                content.endsWith(".png") ||
                content.endsWith(".jpeg")
              ) {
                finalMessageType = "image";
                fileMetadata = {
                  fileName: fileName || "image_file",
                  fileSize: fileSize || 0,
                  fileType:
                    fileType ||
                    (content.endsWith(".png") ? "image/png" : "image/jpeg"),
                };
              } else if (
                content.endsWith(".mp3") ||
                content.endsWith(".wav") ||
                content.endsWith(".webm")
              ) {
                finalMessageType = "audio";
                fileMetadata = {
                  fileName: fileName || "audio_file",
                  fileSize: fileSize || 0,
                  fileType:
                    fileType ||
                    (content.endsWith(".mp3")
                      ? "audio/mpeg"
                      : content.endsWith(".wav")
                      ? "audio/wav"
                      : "audio/webm"),
                };
              } else if (
                content.endsWith(".pdf") ||
                content.endsWith(".doc") ||
                content.endsWith(".docx")
              ) {
                finalMessageType = "document";
                fileMetadata = {
                  fileName: fileName || "document_file",
                  fileSize: fileSize || 0,
                  fileType:
                    fileType ||
                    (content.endsWith(".pdf")
                      ? "application/pdf"
                      : content.endsWith(".doc")
                      ? "application/msword"
                      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
                };
              }
            } else if (content.startsWith("data:")) {
              const maxSizeMB = 5;
              const base64Size = (content.length * 3) / 4 / (1024 * 1024);
              if (base64Size > maxSizeMB) {
                console.error(
                  `SendMessage Error: ${finalMessageType} size exceeds ${maxSizeMB}MB`,
                  { base64Size }
                );
                if (typeof callback === "function") {
                  return callback({
                    status: "error",
                    message: `${
                      finalMessageType.charAt(0).toUpperCase() +
                      finalMessageType.slice(1)
                    } size must be less than ${maxSizeMB}MB`,
                  });
                }
                return;
              }

              const base64Regex = new RegExp(
                `^data:${fileType?.replace("/", "\\/") || "[^;]+"};base64,`
              );
              if (!base64Regex.test(content)) {
                console.error(
                  `SendMessage Error: Invalid ${finalMessageType} base64 format`
                );
                if (typeof callback === "function") {
                  return callback({
                    status: "error",
                    message: `Invalid ${finalMessageType} format`,
                  });
                }
                return;
              }

              const base64Data = content.replace(base64Regex, "");
              const resourceType =
                finalMessageType === "image"
                  ? "image"
                  : finalMessageType === "audio"
                  ? "video"
                  : "raw";
              try {
                const uploadResult = await cloudinary.uploader.upload(content, {
                  resource_type: resourceType,
                  folder: `skillshastra/${finalMessageType}s`,
                  public_id: `${socket.user.id}_${Date.now()}_${
                    fileName || finalMessageType
                  }`,
                });
                secureUrl = uploadResult.secure_url;
                fileMetadata = {
                  fileName: fileName || finalMessageType + "_file",
                  fileSize: fileSize || uploadResult.bytes || 0,
                  fileType:
                    fileType ||
                    (finalMessageType === "image"
                      ? "image/jpeg"
                      : finalMessageType === "audio"
                      ? "audio/webm"
                      : "application/pdf"),
                };
                console.log(
                  `Uploaded ${finalMessageType} to Cloudinary:`,
                  secureUrl,
                  { fileMetadata }
                );
              } catch (uploadError) {
                console.error(
                  `Error uploading ${finalMessageType} to Cloudinary:`,
                  uploadError
                );
                if (typeof callback === "function") {
                  return callback({
                    status: "error",
                    message: `Failed to upload ${finalMessageType}`,
                  });
                }
                return;
              }
            }
          }

          const message = new Message({
            sender: socket.user.id,
            receiver: receiverId,
            content: secureUrl,
            messageType: finalMessageType,
            fileMetadata,
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
              profileImage:
                receiver.profileImage ||
                "https://www.gravatar.com/avatar/?d=retro",
            },
            content: secureUrl,
            messageType: finalMessageType,
            fileMetadata,
            createdAt: message.createdAt,
            messageId: message._id.toString(),
            isRead: false,
          };

          console.log(
            `Emitting receiveMessage to sender room: room:${socket.user.id}, receiver room: room:${receiverId}`,
            {
              senderRoom: Array.from(
                io.sockets.adapter.rooms.get(`room:${socket.user.id}`) || []
              ),
              receiverRoom: Array.from(
                io.sockets.adapter.rooms.get(`room:${receiverId}`) || []
              ),
              messageId: messageData.messageId,
              messageType: messageData.messageType,
              content: messageData.content.substring(0, 50) + "...",
              fileMetadata: messageData.fileMetadata,
            }
          );

          io.to(`room:${receiverId}`).emit("receiveMessage", messageData);
          io.to(`room:${socket.user.id}`).emit("receiveMessage", messageData);

          // Trigger updateMessages for both users to refresh the chat
          io.to(`room:${receiverId}`).emit("updateMessages", {
            userId: socket.user.id,
          });
          io.to(`room:${socket.user.id}`).emit("updateMessages", {
            userId: receiverId,
          });

          console.log(
            `Message sent from ${socket.user.id} to ${receiverId}: ${finalMessageType}`
          );

          const updateUsers = async (userId) => {
            const users =
              socket.user.role === "admin"
                ? await User.find({ isVerified: true })
                    .select("name email role profileImage")
                    .lean()
                : await User.find({ role: "admin", isVerified: true })
                    .select("name email role profileImage")
                    .lean();
            const usersWithDetails = await Promise.all(
              users.map(async (user) => {
                const unreadCount = await Message.countDocuments({
                  sender: user._id,
                  receiver: userId,
                  isRead: false,
                });
                const latestMessage = await Message.findOne({
                  $or: [
                    { sender: userId, receiver: user._id },
                    { sender: user._id, receiver: userId },
                  ],
                })
                  .sort({ createdAt: -1 })
                  .lean();
                return {
                  ...user,
                  _id: user._id.toString(),
                  unreadCount,
                  lastMessage: latestMessage
                    ? {
                        content: latestMessage.content,
                        createdAt: latestMessage.createdAt,
                      }
                    : null,
                  isFavorite: socket.user.favorites.includes(
                    user._id.toString()
                  ),
                };
              })
            );
            usersWithDetails.sort((a, b) => {
              const aTime = a.lastMessage
                ? new Date(a.lastMessage.createdAt)
                : new Date(0);
              const bTime = b.lastMessage
                ? new Date(b.lastMessage.createdAt)
                : new Date(0);
              return bTime - aTime;
            });
            console.log(
              `Emitting updateUsers to room:${userId}, rooms:`,
              Array.from(io.sockets.adapter.rooms.get(`room:${userId}`) || []),
              {
                users: usersWithDetails.map((u) => ({
                  id: u._id,
                  name: u.name,
                  unreadCount: u.unreadCount,
                })),
              }
            );
            io.to(`room:${userId}`).emit("updateUsers", {
              users: usersWithDetails,
            });
            console.log(`Updated user list for ${userId}`);
          };
          await updateUsers(socket.user.id);
          await updateUsers(receiverId);
          if (typeof callback === "function") {
            callback({
              status: "success",
              message: "Message sent",
              messageId: message._id.toString(),
            });
          }
        } catch (error) {
          console.error("Error sending message:", error);
          if (typeof callback === "function") {
            callback({ status: "error", message: "Failed to send message" });
          }
        }
      }
    );

    socket.on("clearChats", async ({ userId }, callback) => {
      try {
        await Message.deleteMany({
          $or: [
            { sender: socket.user.id, receiver: userId },
            { sender: userId, receiver: socket.user.id },
          ],
        });
        console.log(`Cleared chats between ${socket.user.id} and ${userId}`);
        if (typeof callback === "function") {
          callback({ status: "success", message: "Chats cleared" });
        }
        io.to(`room:${socket.user.id}`).emit("updateMessages", { userId });
        io.to(`room:${userId}`).emit("updateMessages", {
          userId: socket.user.id,
        });

        const updateUsers = async (targetUserId) => {
          const users =
            socket.user.role === "admin"
              ? await User.find({ isVerified: true })
                  .select("name email role profileImage")
                  .lean()
              : await User.find({ role: "admin", isVerified: true })
                  .select("name email role profileImage")
                  .lean();
          const usersWithDetails = await Promise.all(
            users.map(async (user) => {
              const unreadCount = await Message.countDocuments({
                sender: user._id,
                receiver: targetUserId,
                isRead: false,
              });
              const latestMessage = await Message.findOne({
                $or: [
                  { sender: targetUserId, receiver: user._id },
                  { sender: user._id, receiver: targetUserId },
                ],
              })
                .sort({ createdAt: -1 })
                .lean();
              return {
                ...user,
                _id: user._id.toString(),
                unreadCount,
                lastMessage: latestMessage
                  ? {
                      content: latestMessage.content,
                      createdAt: latestMessage.createdAt,
                    }
                  : null,
                isFavorite: socket.user.favorites.includes(user._id.toString()),
              };
            })
          );
          usersWithDetails.sort((a, b) => {
            const aTime = a.lastMessage
              ? new Date(a.lastMessage.createdAt)
              : new Date(0);
            const bTime = b.lastMessage
              ? new Date(b.lastMessage.createdAt)
              : new Date(0);
            return bTime - aTime;
          });
          console.log(
            `Emitting updateUsers to room:${targetUserId}, rooms:`,
            Array.from(
              io.sockets.adapter.rooms.get(`room:${targetUserId}`) || []
            )
          );
          io.to(`room:${targetUserId}`).emit("updateUsers", {
            users: usersWithDetails,
          });
        };
        await updateUsers(socket.user.id);
        await updateUsers(userId);
      } catch (error) {
        console.error("Error clearing chats:", error);
        if (typeof callback === "function") {
          callback({ status: "error", message: "Failed to clear chats" });
        }
      }
    });

    socket.on("getUserProfile", async ({ userId }, callback) => {
      try {
        const user = await User.findById(userId)
          .select("name email role profileImage")
          .lean();
        if (!user) {
          console.error("GetUserProfile Error: User not found:", userId);
          if (typeof callback === "function") {
            return callback({ status: "error", message: "User not found" });
          }
          return;
        }
        console.log(`Fetched profile for user ${userId} by ${socket.user.id}`);
        if (typeof callback === "function") {
          callback({
            status: "success",
            user: {
              id: user._id.toString(),
              name: user.name,
              email: user.email,
              role: user.role,
              profileImage:
                user.profileImage || "https://www.gravatar.com/avatar/?d=retro",
            },
          });
        }
      } catch (error) {
        console.error("Error fetching user profile:", error);
        if (typeof callback === "function") {
          callback({
            status: "error",
            message: "Failed to fetch user profile",
          });
        }
      }
    });

    socket.on("getMessages", async ({ userId }, callback) => {
      try {
        console.log(
          `Fetching messages for user ${socket.user.id} with user ${userId}, rooms:`,
          Array.from(
            io.sockets.adapter.rooms.get(`room:${socket.user.id}`) || []
          )
        );
        const messages = await Message.find({
          $or: [
            { sender: socket.user.id, receiver: userId },
            { sender: userId, receiver: socket.user.id },
          ],
        })
          .populate("sender", "name email profileImage")
          .populate("receiver", "name email profileImage")
          .select(
            "sender receiver content messageType createdAt isRead fileMetadata"
          )
          .sort({ createdAt: 1 })
          .lean();
        await Message.updateMany(
          { receiver: socket.user.id, sender: userId, isRead: false },
          { isRead: true }
        );
        const formattedMessages = messages.map((msg) => ({
          sender: {
            _id: msg.sender._id.toString(),
            name: msg.sender.name,
            email: msg.sender.email,
            profileImage:
              msg.sender.profileImage ||
              "https://www.gravatar.com/avatar/?d=retro",
          },
          receiver: {
            _id: msg.receiver._id.toString(),
            name: msg.receiver.name,
            email: msg.receiver.email,
            profileImage:
              msg.receiver.profileImage ||
              "https://www.gravatar.com/avatar/?d=retro",
          },
          content: msg.content,
          messageType: msg.messageType || "text",
          fileMetadata: msg.fileMetadata,
          createdAt: msg.createdAt,
          _id: msg._id.toString(),
          isRead: msg.isRead,
        }));
        console.log(
          `Fetched ${formattedMessages.length} messages for user ${userId} by ${socket.user.id}`,
          {
            messages: formattedMessages.map((m) => ({
              id: m._id,
              messageType: m.messageType,
              content: m.content.substring(0, 50) + "...",
              fileMetadata: m.fileMetadata,
            })),
          }
        );
        if (typeof callback === "function") {
          callback({ status: "success", messages: formattedMessages });
        }

        // Notify sender of read status updates
        const updatedMessages = await Message.find({
          $or: [
            { sender: socket.user.id, receiver: userId },
            { sender: userId, receiver: socket.user.id },
          ],
        })
          .populate("sender", "name email profileImage")
          .populate("receiver", "name email profileImage")
          .select(
            "sender receiver content messageType createdAt isRead fileMetadata _id"
          )
          .lean();
        updatedMessages.forEach((msg) => {
          const messageData = {
            sender: {
              id: msg.sender._id.toString(),
              name: msg.sender.name,
              email: msg.sender.email,
              profileImage:
                msg.sender.profileImage ||
                "https://www.gravatar.com/avatar/?d=retro",
            },
            receiver: {
              id: msg.receiver._id.toString(),
              name: msg.receiver.name,
              email: msg.receiver.email,
              profileImage:
                msg.receiver.profileImage ||
                "https://www.gravatar.com/avatar/?d=retro",
            },
            content: msg.content,
            messageType: msg.messageType || "text",
            fileMetadata: msg.fileMetadata,
            createdAt: msg.createdAt,
            messageId: msg._id.toString(),
            isRead: msg.isRead,
          };
          console.log(
            `Emitting updateMessageStatus for message ${msg._id.toString()} to room:${msg.sender._id.toString()}`,
            {
              messageId: messageData.messageId,
              messageType: messageData.messageType,
              content: messageData.content.substring(0, 50) + "...",
              fileMetadata: messageData.fileMetadata,
            }
          );
          io.to(`room:${msg.sender._id.toString()}`).emit(
            "updateMessageStatus",
            messageData
          );
        });
      } catch (error) {
        console.error("Error fetching messages:", error);
        if (typeof callback === "function") {
          callback({ status: "error", message: "Failed to fetch messages" });
        }
      }
    });

    // WebRTC Signaling for Audio Calls
    socket.on("callUser", async ({ to, offer, callerName }, callback) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(to)) {
          console.error("CallUser Error: Invalid receiver ID:", to);
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Invalid receiver ID",
            });
          }
          return;
        }
        const receiver = await User.findById(to);
        if (!receiver || !receiver.isVerified) {
          console.error(
            "CallUser Error: Receiver not found or not verified:",
            to
          );
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Receiver not found or not verified",
            });
          }
          return;
        }
        const call = new Call({
          caller: socket.user.id,
          receiver: to,
          offer,
          status: "pending",
        });
        await call.save();
        console.log(
          `Stored pending call from ${
            socket.user.id
          } to ${to}, callId: ${call._id.toString()}`
        );
        const receiverRoom = io.sockets.adapter.rooms.get(`room:${to}`);
        if (receiverRoom && receiverRoom.size > 0) {
          console.log(
            `Emitting incomingCall to room:${to}, rooms:`,
            Array.from(receiverRoom),
            { callId: call._id.toString(), callerName }
          );
          io.to(`room:${to}`).emit("incomingCall", {
            from: socket.user.id,
            callerName,
            offer,
            callId: call._id.toString(),
          });
        } else {
          console.log(
            `Receiver ${to} is offline, call queued, callId: ${call._id.toString()}`
          );
        }
        if (typeof callback === "function") {
          callback({
            status: "success",
            message: "Call initiated",
            callId: call._id.toString(),
          });
        }
      } catch (error) {
        console.error("CallUser Error:", error);
        if (typeof callback === "function") {
          callback({ status: "error", message: "Failed to initiate call" });
        }
      }
    });

    socket.on("answerCall", async ({ to, answer, callId }, callback) => {
      try {
        if (
          !mongoose.Types.ObjectId.isValid(to) ||
          !mongoose.Types.ObjectId.isValid(callId)
        ) {
          console.error("AnswerCall Error: Invalid receiver ID or callId:", {
            to,
            callId,
          });
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Invalid receiver ID or call ID",
            });
          }
          return;
        }
        const call = await Call.findById(callId).populate("caller receiver");
        if (!call || call.status !== "pending") {
          console.error(
            "AnswerCall Error: Call not found or not pending:",
            callId,
            { call }
          );
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Call not found or already processed",
            });
          }
          return;
        }
        if (call.caller._id.toString() !== to) {
          console.error(
            "AnswerCall Error: Receiver ID does not match caller:",
            { to, caller: call.caller._id.toString() }
          );
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Invalid receiver ID for this call",
            });
          }
          return;
        }
        call.status = "accepted";
        call.updatedAt = new Date();
        await call.save();
        const callerRoom = io.sockets.adapter.rooms.get(`room:${to}`);
        if (!callerRoom || callerRoom.size === 0) {
          console.error(
            `AnswerCall Error: Caller ${to} is not online, room:`,
            callerRoom
          );
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Caller is not online",
            });
          }
          return;
        }
        console.log(
          `Emitting callAnswered to room:${to}, rooms:`,
          Array.from(callerRoom),
          { from: socket.user.id, callId }
        );
        io.to(`room:${to}`).emit("callAnswered", {
          from: socket.user.id,
          answer,
          callId,
        });
        console.log(
          `Call answered by ${socket.user.id} to ${to}, callId: ${callId}`
        );
        if (typeof callback === "function") {
          callback({ status: "success", message: "Call answered" });
        }
      } catch (error) {
        console.error("AnswerCall Error:", error);
        if (typeof callback === "function") {
          callback({ status: "error", message: "Failed to answer call" });
        }
      }
    });

    socket.on("iceCandidate", ({ to, candidate, callId }, callback) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(to)) {
          console.error("IceCandidate Error: Invalid receiver ID:", to);
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Invalid receiver ID",
            });
          }
          return;
        }
        const receiverRoom = io.sockets.adapter.rooms.get(`room:${to}`);
        if (!receiverRoom || receiverRoom.size === 0) {
          console.error(
            `IceCandidate Error: Receiver ${to} is not online, room:`,
            receiverRoom
          );
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Receiver is not online",
            });
          }
          return;
        }
        console.log(
          `Emitting iceCandidate to room:${to}, rooms:`,
          Array.from(receiverRoom),
          { from: socket.user.id, callId }
        );
        io.to(`room:${to}`).emit("iceCandidate", {
          from: socket.user.id,
          candidate,
          callId,
        });
        console.log(
          `ICE candidate sent from ${socket.user.id} to ${to}, callId: ${callId}`
        );
        if (typeof callback === "function") {
          callback({ status: "success", message: "ICE candidate sent" });
        }
      } catch (error) {
        console.error("IceCandidate Error:", error);
        if (typeof callback === "function") {
          callback({
            status: "error",
            message: "Failed to send ICE candidate",
          });
        }
      }
    });

    socket.on("rejectCall", async ({ to, callId }, callback) => {
      try {
        if (
          !mongoose.Types.ObjectId.isValid(to) ||
          !mongoose.Types.ObjectId.isValid(callId)
        ) {
          console.error("RejectCall Error: Invalid receiver ID or callId:", {
            to,
            callId,
          });
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Invalid receiver ID or call ID",
            });
          }
          return;
        }
        const call = await Call.findById(callId);
        if (!call || call.status !== "pending") {
          console.error(
            "RejectCall Error: Call not found or not pending:",
            callId
          );
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Call not found or already processed",
            });
          }
          return;
        }
        call.status = "rejected";
        call.updatedAt = new Date();
        await call.save();
        const receiverRoom = io.sockets.adapter.rooms.get(`room:${to}`);
        if (receiverRoom && receiverRoom.size > 0) {
          console.log(
            `Emitting callRejected to room:${to}, rooms:`,
            Array.from(receiverRoom),
            { callId }
          );
          io.to(`room:${to}`).emit("callRejected", {
            from: socket.user.id,
            callId,
          });
        }
        console.log(
          `Call rejected by ${socket.user.id} to ${to}, callId: ${callId}`
        );
        if (typeof callback === "function") {
          callback({ status: "success", message: "Call rejected" });
        }
      } catch (error) {
        console.error("RejectCall Error:", error);
        if (typeof callback === "function") {
          callback({ status: "error", message: "Failed to reject call" });
        }
      }
    });

    socket.on("endCall", async ({ to, callId }, callback) => {
      try {
        if (
          !mongoose.Types.ObjectId.isValid(to) ||
          !mongoose.Types.ObjectId.isValid(callId)
        ) {
          console.error("EndCall Error: Invalid receiver ID or callId:", {
            to,
            callId,
          });
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Invalid receiver ID or call ID",
            });
          }
          return;
        }
        const call = await Call.findById(callId);
        if (!call) {
          console.error("EndCall Error: Call not found:", callId);
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Call not found",
            });
          }
          return;
        }
        call.status = "ended";
        call.updatedAt = new Date();
        await call.save();
        const receiverRoom = io.sockets.adapter.rooms.get(`room:${to}`);
        if (receiverRoom && receiverRoom.size > 0) {
          console.log(
            `Emitting callEnded to room:${to}, rooms:`,
            Array.from(receiverRoom),
            { callId }
          );
          io.to(`room:${to}`).emit("callEnded", {
            from: socket.user.id,
            callId,
          });
        }
        console.log(
          `Call ended by ${socket.user.id} to ${to}, callId: ${callId}`
        );
        if (typeof callback === "function") {
          callback({ status: "success", message: "Call ended" });
        }
      } catch (error) {
        console.error("EndCall Error:", error);
        if (typeof callback === "function") {
          callback({ status: "error", message: "Failed to end call" });
        }
      }
    });

    socket.on("connect_error", (error) => {
      console.error(
        `Socket.IO Connect Error for user ${socket.user?.id || "unknown"}:`,
        error.message
      );
      setTimeout(() => {
        socket.emit("rejoinRooms");
      }, 1000);
    });

    socket.on("disconnect", () => {
      console.log(
        `User disconnected: ${socket.user.email} (ID: ${socket.user.id}, Socket: ${socket.id})`
      );
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
      res
        .status(200)
        .json({ message: "Messages fetched successfully", messages });
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  return { io, router };
};

module.exports = initializeMessaging;
