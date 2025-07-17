const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const User = mongoose.model("User");
const Message = mongoose.model("Message");

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

  // Track active calls
  const activeCalls = new Map();

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
      `User connected: ${socket.user.email} (${socket.user.role}, ID: ${socket.user.id})`
    );
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
              lastMessageTime: latestMessage
                ? latestMessage.createdAt
                : new Date(0),
              isFavorite: socket.user.favorites.includes(user._id.toString()),
            };
          })
        );
        usersWithDetails.sort(
          (a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime)
        );
        console.log(
          "Sending users to client:",
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
        console.log(`Toggled favorite for user ${userId}: ${!isFavorite}`);
        if (typeof callback === "function") {
          callback({ status: "success", isFavorite: !isFavorite });
        }
        socket.emit("getUsers", (response) => {
          if (response.status === "success") {
            io.to(socket.user.id).emit("updateUsers", {
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
              !Object.values(allowedTypes)
                .flat()
                .includes(fileType)
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
            `Emitting receiveMessage to sender room: ${socket.user.id}, receiver room: ${receiverId}`,
            {
              messageId: messageData.messageId,
              messageType: messageData.messageType,
              content: messageData.content,
              fileMetadata: messageData.fileMetadata,
            }
          );

          io.to(receiverId).emit("receiveMessage", messageData);
          io.to(socket.user.id).emit("receiveMessage", messageData);
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
                  lastMessageTime: latestMessage
                    ? latestMessage.createdAt
                    : new Date(0),
                  isFavorite: socket.user.favorites.includes(
                    user._id.toString()
                  ),
                };
              })
            );
            usersWithDetails.sort(
              (a, b) =>
                new Date(b.lastMessageTime) - new Date(a.lastMessageTime)
            );
            io.to(userId).emit("updateUsers", { users: usersWithDetails });
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
        socket.emit("getMessages", { userId }, (response) => {
          if (response.status === "success") {
            io.to(socket.user.id).emit("updateMessages", {
              messages: response.messages,
            });
          }
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
                lastMessageTime: latestMessage
                  ? latestMessage.createdAt
                  : new Date(0),
                isFavorite: socket.user.favorites.includes(user._id.toString()),
              };
            })
          );
          usersWithDetails.sort(
            (a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime)
          );
          io.to(targetUserId).emit("updateUsers", { users: usersWithDetails });
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
          `Fetching messages for user ${socket.user.id} with user ${userId}`
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
          `Fetched ${formattedMessages.length} messages for user ${userId}`,
          {
            messages: formattedMessages.map((m) => ({
              id: m._id,
              messageType: m.messageType,
              content: m.content,
              fileMetadata: m.fileMetadata,
            })),
          }
        );
        if (typeof callback === "function") {
          callback({ status: "success", messages: formattedMessages });
        }

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
            `Emitting updateMessageStatus for message ${msg._id.toString()}`,
            {
              messageId: messageData.messageId,
              messageType: messageData.messageType,
              content: messageData.content,
              fileMetadata: messageData.fileMetadata,
            }
          );
          io.to(msg.sender._id.toString()).emit(
            "updateMessageStatus",
            messageData
          );
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
                lastMessageTime: latestMessage
                  ? latestMessage.createdAt
                  : new Date(0),
                isFavorite: socket.user.favorites.includes(user._id.toString()),
              };
            })
          );
          usersWithDetails.sort(
            (a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime)
          );
          io.to(targetUserId).emit("updateUsers", { users: usersWithDetails });
          console.log(`Updated user list for ${targetUserId}`);
        };
        await updateUsers(socket.user.id);
        await updateUsers(userId);
      } catch (error) {
        console.error("Error fetching messages:", error);
        if (typeof callback === "function") {
          callback({ status: "error", message: "Failed to fetch messages" });
        }
      }
    });

    // Enhanced WebRTC Signaling for Audio Calls
    socket.on("callUser", async ({ to, offer }, callback) => {
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
        if (!receiver) {
          console.error("CallUser Error: Receiver not found:", to);
          if (typeof callback === "function") {
            return callback({ status: "error", message: "Receiver not found" });
          }
          return;
        }
        if (activeCalls.has(to) || activeCalls.has(socket.user.id)) {
          console.error("CallUser Error: User is already in a call", { to, caller: socket.user.id });
          if (typeof callback === "function") {
            return callback({ status: "error", message: "User is already in a call" });
          }
          return;
        }
        activeCalls.set(to, socket.user.id);
        activeCalls.set(socket.user.id, to);
        io.to(to).emit("incomingCall", {
          from: socket.user.id,
          callerName: socket.user.name,
          offer,
        });
        console.log(`Call initiated from ${socket.user.id} to ${to}`);
        if (typeof callback === "function") {
          callback({ status: "success", message: "Call initiated" });
        }
      } catch (error) {
        console.error("CallUser Error:", error);
        if (typeof callback === "function") {
          callback({ status: "error", message: "Failed to initiate call" });
        }
      }
    });

    socket.on("answerCall", ({ to, answer }, callback) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(to)) {
          console.error("AnswerCall Error: Invalid receiver ID:", to);
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Invalid receiver ID",
            });
          }
          return;
        }
        io.to(to).emit("callAnswered", {
          from: socket.user.id,
          answer,
        });
        console.log(`Call answered by ${socket.user.id} to ${to}`);
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

    socket.on("iceCandidate", ({ to, candidate }, callback) => {
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
        io.to(to).emit("iceCandidate", {
          from: socket.user.id,
          candidate,
        });
        console.log(`ICE candidate sent from ${socket.user.id} to ${to}`);
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

    socket.on("rejectCall", ({ to }, callback) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(to)) {
          console.error("RejectCall Error: Invalid receiver ID:", to);
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Invalid receiver ID",
            });
          }
          return;
        }
        io.to(to).emit("callRejected");
        activeCalls.delete(to);
        activeCalls.delete(socket.user.id);
        console.log(`Call rejected by ${socket.user.id} to ${to}`);
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

    socket.on("endCall", ({ to }, callback) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(to)) {
          console.error("EndCall Error: Invalid receiver ID:", to);
          if (typeof callback === "function") {
            return callback({
              status: "error",
              message: "Invalid receiver ID",
            });
          }
          return;
        }
        io.to(to).emit("callEnded");
        activeCalls.delete(to);
        activeCalls.delete(socket.user.id);
        console.log(`Call ended by ${socket.user.id} to ${to}`);
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

    socket.on("disconnect", () => {
      console.log(
        `User disconnected: ${socket.user.email} (ID: ${socket.user.id})`
      );
      const otherUserId = activeCalls.get(socket.user.id);
      if (otherUserId) {
        io.to(otherUserId).emit("callEnded");
        activeCalls.delete(otherUserId);
        activeCalls.delete(socket.user.id);
        console.log(`Cleaned up call state for disconnected user ${socket.user.id}`);
      }
    });

    socket.on("connect_error", (error) => {
      console.error(
        `Socket.IO Connect Error for user ${socket.user.id}:`,
        error.message
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