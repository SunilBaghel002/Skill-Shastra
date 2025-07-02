const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const path = require("path");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { v2: cloudinary } = require("cloudinary");
const rateLimit = require("express-rate-limit");

dotenv.config();
const app = express();

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Middleware
app.use(
  cors({ origin: "https://skill-shastra.vercel.app/", credentials: true })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB Connected");
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
    process.exit(1);
  }
};

// User Schema
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Name is required"] },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
    },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    otp: { type: String },
    otpExpires: { type: Date },
    isVerified: { type: Boolean, default: false },
    profileImage: {
      type: String,
      default: function () {
        const emailHash = crypto
          .createHash("md5")
          .update(this.email.trim().toLowerCase())
          .digest("hex");
        return `https://www.gravatar.com/avatar/${emailHash}?s=50&d=retro`;
      },
    },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", userSchema);

// Enrollment Schema
const enrollmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  course: { type: String, required: true },
  fullName: { type: String, required: true },
  email: { type: String, required: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  phone: { type: String, required: true },
  age: { type: Number, required: true, min: 15, max: 100 },
  gender: { type: String, required: true, enum: ["Male", "Female", "Other"] },
  education: { type: String, required: true },
  institution: { type: String, required: true },
  guardianName: { type: String, required: true },
  guardianPhone: { type: String, required: true },
  country: { type: String, required: true },
  address: { type: String, required: true },
  transactionId: { type: String, required: true },
  paymentDate: { type: Date, required: true },
  paymentProof: { type: String, required: true },
  status: {
    type: String,
    default: "pending",
    enum: ["pending", "approved", "rejected"],
  },
  createdAt: { type: Date, default: Date.now },
});

const Enrollment = mongoose.model("Enrollment", enrollmentSchema);

// Feedback Schema
const feedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  userName: { type: String, required: true },
  userEmail: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  text: { type: String, required: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },
});

const Feedback = mongoose.model("Feedback", feedbackSchema);

// Message Schema
const messageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  userName: { type: String, required: true },
  userEmail: { type: String, required: true },
  content: { type: String, required: true, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now },
});

const Message = mongoose.model("Message", messageSchema);

// Announcement Schema
const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 100 },
  content: { type: String, required: true, maxlength: 1000 },
  targetAudience: {
    type: String,
    required: true,
    enum: [
      "all",
      "frontend",
      "backend",
      "full-stack",
      "digital-marketing",
      "data-science",
    ],
  },
  announcementType: {
    type: String,
    required: true,
    enum: ["class_schedule", "test", "general", "event"],
    default: "general",
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
});

const Announcement = mongoose.model("Announcement", announcementSchema);

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/png", "image/jpeg", "application/pdf"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PNG, JPG, and PDF files are allowed."));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Multer Error Handling Middleware
const multerErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: `Multer error: ${err.message}` });
  } else if (err) {
    return res.status(400).json({ message: err.message });
  }
  next();
};

// Nodemailer Setup
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // Use STARTTLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 10000, // 10 seconds
  greetingTimeout: 10000, // 10 seconds
  socketTimeout: 10000, // 10 seconds
  tls: {
    // Ensure compatibility with Gmail's TLS requirements
    ciphers: "SSLv3",
    rejectUnauthorized: false, // Allow self-signed certificates (optional, for testing)
  },
});

// sendEmail Function with Retry Logic
const sendEmail = async (to, subject, html, retries = 3, delay = 2000) => {
  const mailOptions = {
    from: `"Skillshastra" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(
        `Attempt ${attempt} to send email to ${to} at ${new Date().toISOString()}`
      );
      const startTime = Date.now();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("SMTP request timed out")), 10000); // Increased to 10 seconds
      });
      const sendPromise = transporter.sendMail(mailOptions);
      const info = await Promise.race([sendPromise, timeoutPromise]);
      console.log(
        `Email sent to ${to} in ${Date.now() - startTime}ms: ${info.response}`
      );
      return info;
    } catch (error) {
      console.error(
        `Email Error to ${to} (Attempt ${attempt}/${retries}) at ${new Date().toISOString()}:`,
        {
          message: error.message,
          stack: error.stack,
          code: error.code,
          response: error.response,
        }
      );
      if (attempt < retries) {
        console.log(`Retrying email to ${to} after ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw new Error(`Failed to send email to ${to}: ${error.message}`);
    }
  }
};

// Email Template Functions
const getBaseEmailTemplate = (content) => `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Skill Shastra</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; background-color: #f8f9ff; color: #1f2937; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #7c3aed; text-align: center; padding: 20px; border-radius: 8px 8px 0 0; }
        .header img { max-width: 150px; height: auto; }
        .content { background-color: #ffffff; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }
        .content h1 { font-size: 24px; color: #7c3aed; margin-bottom: 20px; }
        .content p { font-size: 16px; line-height: 1.6; margin-bottom: 15px; }
        .cta-button { display: inline-block; background-color: #7c3aed; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500; margin: 15px 0; }
        .cta-button:hover { background-color: #a855f7; }
        .footer { text-align: center; padding: 20px; font-size: 14px; color: #6b7280; }
        .footer a { color: #7c3aed; text-decoration: none; margin: 0 10px; }
        .footer a:hover { text-decoration: underline; }
        @media (max-width: 600px) {
          .container { padding: 10px; }
          .content { padding: 20px; }
          .header img { max-width: 120px; }
          .content h1 { font-size: 20px; }
          .content p { font-size: 14px; }
          .cta-button { padding: 10px 20px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <img src="https://res.cloudinary.com/dsk80td7v/image/upload/v1750568168/public/images/logo.png" alt="Skill Shastra Logo" />
        </div>
        <div class="content">
          ${content}
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Skill Shastra. All rights reserved.</p>
          <p><a href="mailto:support@skillshastra.com">support@skillshastra.com</a> | <a href="https://skill-shastra.vercel.app/">skillshastra.com</a></p>
        </div>
      </div>
    </body>
  </html>
`;

const getAnnouncementEmailTemplate = (title, content, announcementType) =>
  getBaseEmailTemplate(`
    <h1>New Announcement: ${title}</h1>
    <p>Dear Skill Shastra User,</p>
    <p>We have a new ${announcementType.replace(
      "_",
      " "
    )} announcement for you:</p>
    <p><strong>${title}</strong></p>
    <p>${content}</p>
    <a href="https://skill-shastra.vercel.app/dashboard/announcements" class="cta-button">View Announcements</a>
    <p>Stay updated via your dashboard or contact us at <a href="mailto:support@skillshastra.com">support@skillshastra.com</a>.</p>
  `);

const getVerifyEmailTemplate = (otp) =>
  getBaseEmailTemplate(`
    <h1>Verify Your Account</h1>
    <p>Welcome to Skill Shastra, we're excited to have you!</p>
    <p>Your One-Time Password (OTP) for email verification is:</p>
    <div class="otp">${otp}</div>
    <p>This OTP is valid for 10 minutes. Please use it to complete your verification.</p>
    <a href="https://skill-shastra.vercel.app/signup" class="cta-button">Verify Now</a>
    <p>If you didn't request this, please ignore this email.</p>
  `);

const getResetPasswordEmailTemplate = (otp) =>
  getBaseEmailTemplate(`
    <h1>Reset Your Password</h1>
    <p>Welcome to Skill Shastra! Let's get your password reset.</p>
    <p>Your One-Time Password (OTP) for password reset is:</p>
    <div class="otp">${otp}</div>
    <p>This OTP is valid for 10 minutes. Please use it to complete your password reset.</p>
    <a href="https://skill-shastra.vercel.app/forgot-password" class="cta-button">Reset Password</a>
    <p>If you didn't request this, please ignore this email.</p>
  `);

const getWelcomeEmailTemplate = (name) =>
  getBaseEmailTemplate(`
    <h1>Welcome to Skill Shastra</h1>
    <p>Hello, ${name}!</p>
    <p>We’re beyond excited to welcome you to <strong>Skill Shastra</strong>! Your account is now verified, and you’re ready to join our vibrant community of learners mastering skills for the future.</p>
    <p>Dive into our curated courses, designed to empower you to achieve your personal and professional goals. Your journey to success starts today!</p>
    <p><a href="https://skill-shastra.vercel.app/dashboard/courses" class="cta-button">Start Learning Now</a></p>
    <p>Need help or have questions? Our support team is here for you at <a href="mailto:support@skillshastra.com">support@skillshastra.com</a>.</p>
    <p>Connect with us: 
      <a href="https://twitter.com/skillshastra">Twitter</a> | 
      <a href="https://linkedin.com/company/skillshastra">LinkedIn</a> | 
      <a href="https://instagram.com/skillshastra">Instagram</a>
    </p>
  `);

const getEnrollmentConfirmationEmailTemplate = (
  fullName,
  course,
  transactionId,
  paymentProofUrl
) =>
  getBaseEmailTemplate(`
    <h1>Enrollment Confirmation</h1>
    <p>Dear ${fullName},</p>
    <p>Thank you for enrolling in <strong>${course}</strong> with Skill Shastra!</p>
    <p>We have received your enrollment details and payment proof. Our team will verify your payment and update your enrollment status soon.</p>
    <table class="table">
      <tr><th>Course</th><td>${course}</td></tr>
      <tr><th>Transaction ID</th><td>${transactionId}</td></tr>
      <tr><th>Status</th><td>Pending</td></tr>
    </table>
    <p><a href="${paymentProofUrl}" class="cta-button" target="_blank">View Payment Proof</a></p>
    <p>Check your dashboard for updates or contact us at <a href="mailto:support@skillshastra.com">support@skillshastra.com</a> if you have any questions.</p>
  `);

const getEnrollmentStatusEmailTemplate = (fullName, course, status) =>
  getBaseEmailTemplate(`
    <h1>Enrollment Status Update</h1>
    <p>Dear ${fullName},</p>
    <p>Your enrollment for <strong>${course}</strong> has been <span class="status-${status.toLowerCase()}">${status}</span>.</p>
    ${
      status === "approved"
        ? "<p>Congratulations! You can now access your course materials on the dashboard.</p>"
        : "<p>We’re sorry, but your enrollment could not be approved. Please contact us for more details.</p>"
    }
    <a href="https://skill-shastra.vercel.app/dashboard" class="cta-button">View Dashboard</a>
    <p>Thank you for choosing Skill Shastra! If you have any questions, reach out to <a href="mailto:support@skillshastra.com">support@skillshastra.com</a>.</p>
  `);

// Authentication Middleware
const protect = async (req, res, next) => {
  const token = req.cookies.token;
  const isApiRoute = req.originalUrl.startsWith("/api/");

  if (!token) {
    if (isApiRoute) {
      return res.status(401).json({ message: "No token provided" });
    }
    console.log(
      `No token provided, redirecting to /signup from ${req.originalUrl}`
    );
    return res.redirect(
      `/signup?redirect=${encodeURIComponent(req.originalUrl)}`
    );
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select(
      "-password -otp -otpExpires"
    );
    if (!user || !user.isVerified) {
      res.clearCookie("token");
      if (isApiRoute) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      console.log(
        `Unauthorized user, redirecting to /signup from ${req.originalUrl}`
      );
      return res.redirect(
        `/signup?redirect=${encodeURIComponent(req.originalUrl)}`
      );
    }
    req.user = user;
    next();
  } catch (error) {
    console.error("JWT Verification Error:", {
      message: error.message,
      stack: error.stack,
    });
    res.clearCookie("token");
    if (isApiRoute) {
      return res.status(401).json({ message: "Invalid token" });
    }
    console.log(
      `Invalid token, redirecting to /signup from ${req.originalUrl}`
    );
    return res.redirect(
      `/signup?redirect=${encodeURIComponent(req.originalUrl)}`
    );
  }
};

const restrictToAdmin = async (req, res, next) => {
  const adminEmails = process.env.ADMIN_EMAILS?.split(",") || [];
  if (!req.user || !adminEmails.includes(req.user.email)) {
    return res.status(403).json({ message: "Access denied. Admin only." });
  }
  req.user.role = "admin";
  next();
};

// Rate Limiting for Announcement Creation
const announcementLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 announcement creations per window
  message: "Too many announcement attempts, please try again after 15 minutes.",
});

// Helper Function
const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// Authentication Routes
app.post("/api/auth/signup", upload.none(), async (req, res) => {
  const { name, email, password, redirect } = req.body;
  if (!name || !email || !password) {
    console.log(`Missing signup fields: name=${name}, email=${email}`);
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    console.log(`Processing signup for email: ${email}`);
    let user = await User.findOne({ email });
    if (user) {
      console.log(`User already exists: ${email}`);
      return res.status(400).json({ message: "User already exists" });
    }

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    console.log(`Generated OTP for ${email}: ${otp}`);

    user = new User({
      name,
      email,
      password,
      otp,
      otpExpires,
      role: process.env.ADMIN_EMAILS.split(",").includes(email)
        ? "admin"
        : "user",
    });

    await user.save();
    console.log(`User saved: ${email}`);

    try {
      await sendEmail(
        email,
        "Verify Your Skill Shastra Account",
        getVerifyEmailTemplate(otp)
      );
      console.log(`Signup OTP email sent to: ${email}`);
    } catch (emailError) {
      console.error(`Failed to send signup OTP email to ${email}:`, {
        message: emailError.message,
        stack: emailError.stack,
        code: emailError.code,
        response: emailError.response,
      });
      // Continue to respond to client, as email failure is non-critical
    }

    res.status(201).json({ message: "OTP sent to your email", redirect });
  } catch (error) {
    console.error("Signup Error:", {
      message: error.message,
      stack: error.stack,
      email,
    });
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/auth/verify-otp", async (req, res) => {
  const { email, otp, redirect } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP are required" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: "User already verified" });
    }

    if (user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.isVerified = true;
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1hr",
    });

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "strict",
    });

    await sendEmail(
      user.email,
      "Welcome to Skill Shastra!",
      getWelcomeEmailTemplate(user.name)
    );

    res.status(200).json({
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage,
      },
      redirect,
    });
  } catch (error) {
    console.error("Verify OTP Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password, redirect } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const token = req.cookies.token;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select(
          "-password -otp -otpExpires"
        );
        if (user && user.isVerified) {
          return res.status(400).json({
            message: "User already logged in",
            user: {
              name: user.name,
              email: user.email,
              role: user.role,
              profileImage: user.profileImage,
            },
            redirect,
          });
        }
        res.clearCookie("token");
      } catch (error) {
        res.clearCookie("token");
      }
    }

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (!user.isVerified) {
      return res
        .status(400)
        .json({ message: "Please verify your email first" });
    }

    const newToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    res.cookie("token", newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "strict",
    });

    res.status(200).json({
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage,
      },
      redirect,
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });
  res.status(200).json({ message: "Logged out successfully" });
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const { email, redirect } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendEmail(
      email,
      "Skill Shastra Password Reset",
      getResetPasswordEmailTemplate(otp)
    );

    res
      .status(200)
      .json({ message: "OTP sent to your email for password reset", redirect });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { email, otp, newPassword, redirect } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.password = newPassword;
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    res.status(200).json({ message: "Password reset successfully", redirect });
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Admin Middleware
app.get("/api/auth/admin-panel", protect, restrictToAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password -otp -otpExpires");
    res.status(200).json({ message: "Welcome to Admin Panel", users });
  } catch (error) {
    console.error("Admin Panel Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Admin Routes
app.get("/api/admin/users", protect, restrictToAdmin, async (req, res) => {
  try {
    const users = await User.find().select("name email profileImage").lean();
    const enrollments = await Enrollment.find().lean();
    const usersWithEnrollments = users.map((user) => ({
      ...user,
      enrollments: enrollments.filter(
        (e) => e.userId.toString() === user._id.toString()
      ),
    }));
    res.status(200).json({
      message: "Users fetched successfully",
      users: usersWithEnrollments,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.patch(
  "/api/admin/enrollments/:id",
  protect,
  restrictToAdmin,
  async (req, res) => {
    try {
      const { status } = req.body;
      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      const enrollment = await Enrollment.findByIdAndUpdate(
        req.params.id,
        { status },
        { new: true }
      );
      if (!enrollment) {
        return res.status(404).json({ message: "Enrollment not found" });
      }
      const user = await User.findById(enrollment.userId);
      await sendEmail(
        enrollment.email,
        `Skill Shastra Enrollment ${
          status.charAt(0).toUpperCase() + status.slice(1)
        }`,
        getEnrollmentStatusEmailTemplate(
          enrollment.fullName,
          enrollment.course,
          status
        )
      );
      res
        .status(200)
        .json({ message: `Enrollment ${status} successfully`, enrollment });
    } catch (error) {
      console.error("Error updating enrollment:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Feedback Routes
app.post("/api/feedback", protect, async (req, res) => {
  try {
    const { rating, text } = req.body;
    if (!rating || !text) {
      return res
        .status(400)
        .json({ message: "Rating and feedback text are required" });
    }
    if (rating < 1 || rating > 5) {
      return res
        .status(400)
        .json({ message: "Rating must be between 1 and 5" });
    }
    if (text.length > 500) {
      return res
        .status(400)
        .json({ message: "Feedback text must be 500 characters or less" });
    }

    const feedback = new Feedback({
      userId: req.user._id,
      userName: req.user.name,
      userEmail: req.user.email,
      rating,
      text,
    });

    await feedback.save();
    res.status(201).json({ message: "Feedback submitted successfully" });
  } catch (error) {
    console.error("Error submitting feedback:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/admin/feedback", protect, restrictToAdmin, async (req, res) => {
  try {
    const feedback = await Feedback.find().lean();
    res.status(200).json({ feedback });
  } catch (error) {
    console.error("Error fetching feedback:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Analytics Route
app.get("/api/admin/analytics", protect, restrictToAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalEnrollments = await Enrollment.countDocuments();
    const enrollmentsByStatus = await Enrollment.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const avgFeedbackRating = await Feedback.aggregate([
      { $group: { _id: null, avgRating: { $avg: "$rating" } } },
    ]);
    const analytics = {
      totalUsers,
      totalEnrollments,
      enrollmentsByStatus: enrollmentsByStatus.reduce(
        (acc, curr) => ({ ...acc, [curr._id]: curr.count }),
        {}
      ),
      avgFeedbackRating: avgFeedbackRating[0]?.avgRating || 0,
    };
    res
      .status(200)
      .json({ message: "Analytics fetched successfully", analytics });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Enrollment Details Route
app.get(
  "/api/admin/enrollments/:id",
  protect,
  restrictToAdmin,
  async (req, res) => {
    try {
      const enrollment = await Enrollment.findById(req.params.id).lean();
      if (!enrollment) {
        return res.status(404).json({ message: "Enrollment not found" });
      }
      res
        .status(200)
        .json({ message: "Enrollment fetched successfully", enrollment });
    } catch (error) {
      console.error("Error fetching enrollment:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Messages Route
app.get("/api/admin/messages", protect, restrictToAdmin, async (req, res) => {
  try {
    const messages = await Message.find().lean();
    res
      .status(200)
      .json({ message: "Messages fetched successfully", messages });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ message: "Server error" });
  }
});

const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  duration: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
});

const Course = mongoose.model("Course", courseSchema);

// Recommended Courses Route
app.get("/api/courses/recommended", protect, async (req, res) => {
  try {
    const recommendedCourses = [
      {
        title: "Frontend Development",
        description: "Learn React, HTML, CSS.",
        duration: "6 weeks",
        slug: "frontend",
      },
      {
        title: "Backend Development",
        description: "Master Node.js, Express, MongoDB.",
        duration: "6 weeks",
        slug: "backend",
      },
      {
        title: "Full Stack Development",
        description: "Build full-stack apps with MERN.",
        duration: "8 weeks",
        slug: "full-stack",
      },
      {
        title: "Digital Marketing",
        description: "Master SEO, PPC, and social media.",
        duration: "4 weeks",
        slug: "digital-marketing",
      },
      {
        title: "Data Science",
        description: "Explore Python, Pandas, and ML.",
        duration: "8 weeks",
        slug: "data-science",
      },
    ];
    res.status(200).json({ courses: recommendedCourses });
  } catch (error) {
    console.error("Error fetching recommended courses:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Enrollment Route
app.post(
  "/api/enroll",
  protect,
  upload.single("paymentProof"),
  multerErrorHandler,
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ message: "Payment proof file is required" });
      }

      let studentData;
      try {
        studentData = JSON.parse(req.body.studentData || "{}");
      } catch (error) {
        return res.status(400).json({ message: "Invalid student data format" });
      }

      const { transactionId, paymentDate } = req.body;

      const requiredFields = [
        "course",
        "fullName",
        "email",
        "phone",
        "age",
        "gender",
        "education",
        "institution",
        "guardianName",
        "guardianPhone",
        "country",
        "address",
      ];
      for (const field of requiredFields) {
        if (!studentData[field]) {
          return res.status(400).json({ message: `${field} is required` });
        }
      }
      if (!transactionId || !paymentDate) {
        return res
          .status(400)
          .json({ message: "Transaction ID and payment date are required" });
      }

      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "skillshastra/enrollments",
            public_id: `payment_proof_${studentData.email}_${Date.now()}`,
            resource_type:
              req.file.mimetype === "application/pdf" ? "raw" : "image",
            format: req.file.mimetype.split("/")[1],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });

      const paymentProofUrl = uploadResult.secure_url;
      console.log("Stored payment proof URL:", paymentProofUrl);

      const enrollment = new Enrollment({
        userId: req.user._id,
        course: studentData.course,
        fullName: studentData.fullName,
        email: studentData.email,
        phone: studentData.phone,
        age: parseInt(studentData.age),
        gender: studentData.gender,
        education: studentData.education,
        institution: studentData.institution,
        guardianName: studentData.guardianName,
        guardianPhone: studentData.guardianPhone,
        country: studentData.country,
        address: studentData.address,
        transactionId,
        paymentDate: new Date(paymentDate),
        paymentProof: paymentProofUrl,
        status: "pending",
      });

      await enrollment.save();

      await sendEmail(
        studentData.email,
        "Skill Shastra Enrollment Confirmation",
        getEnrollmentConfirmationEmailTemplate(
          studentData.fullName,
          studentData.course,
          transactionId,
          paymentProofUrl
        )
      );

      res.status(201).json({ message: "Enrollment submitted successfully" });
    } catch (error) {
      console.error("Enrollment Error:", error);
      res.status(500).json({ message: error.message || "Server error" });
    }
  }
);

// Get Enrollments Route
app.get("/api/enrollments", protect, async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ userId: req.user._id }).select(
      "course status paymentProof"
    );
    res
      .status(200)
      .json({ message: "Enrollments fetched successfully", enrollments });
  } catch (error) {
    console.error("Error fetching enrollments:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/user/enrollment", protect, async (req, res) => {
  try {
    const enrollment = await Enrollment.findOne({ email: req.user.email }).sort(
      { createdAt: -1 }
    );
    if (!enrollment) {
      return res.status(404).json({ message: "No previous enrollment found" });
    }
    res.status(200).json({
      fullName: enrollment.fullName || req.user.name,
      phone: enrollment.phone ? enrollment.phone.split(" ")[1] || "" : "",
      isdCode: enrollment.phone ? enrollment.phone.split(" ")[0] || "" : "",
      age: enrollment.age || "",
      gender: enrollment.gender || "",
      education: enrollment.education || "",
      institution: enrollment.institution || "",
      guardianName: enrollment.guardianName || "",
      guardianPhone: enrollment.guardianPhone
        ? enrollment.guardianPhone.split(" ")[1] || ""
        : "",
      guardianIsdCode: enrollment.guardianPhone
        ? enrollment.guardianPhone.split(" ")[0] || ""
        : "",
      country: enrollment.country || "",
      address: enrollment.address || "",
    });
  } catch (error) {
    console.error("Fetch Enrollment Error:", {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({ message: "Server error" });
  }
});

// Announcement Routes
app.post(
  "/api/admin/announcements",
  protect,
  restrictToAdmin,
  announcementLimiter,
  async (req, res) => {
    try {
      const { title, content, targetAudience, announcementType } = req.body;
      console.log("Received announcement data:", {
        title,
        content,
        targetAudience,
        announcementType,
      });

      // Validate required fields
      if (!title || !content || !targetAudience || !announcementType) {
        console.log(
          `Missing announcement fields: title=${title}, content=${content}, targetAudience=${targetAudience}, announcementType=${announcementType}`
        );
        return res.status(400).json({ message: "All fields are required" });
      }

      // Validate targetAudience against schema enum
      const validAudiences = [
        "all",
        "frontend",
        "backend",
        "full-stack",
        "digital-marketing",
        "data-science",
      ];
      if (!validAudiences.includes(targetAudience)) {
        console.log(`Invalid targetAudience: ${targetAudience}`);
        return res.status(400).json({ message: "Invalid target audience" });
      }

      // Validate announcementType against schema enum
      const validTypes = ["general", "class_schedule", "test", "event"];
      if (!validTypes.includes(announcementType)) {
        console.log(`Invalid announcementType: ${announcementType}`);
        return res.status(400).json({ message: "Invalid announcement type" });
      }

      const announcement = await Announcement.create({
        title,
        content,
        targetAudience,
        announcementType,
        createdBy: req.user._id,
      });
      console.log(`Announcement created: ${title} for ${targetAudience}`);

      // Send email notifications
      let recipients = [];
      if (targetAudience === "all") {
        recipients = await User.find({ isVerified: true }).select("email");
      } else {
        // Map targetAudience to course names for enrollment lookup
        const audienceToCourseMap = {
          frontend: "Front End Development",
          backend: "Back End Development",
          "full-stack": "Full Stack Development",
          "digital-marketing": "Digital Marketing",
          "data-science": "Data Science",
        };
        const course = audienceToCourseMap[targetAudience];
        if (course) {
          recipients = await Enrollment.find({
            course,
            status: "approved",
          }).select("email");
        }
      }

      try {
        await Promise.all(
          recipients.map(({ email }) =>
            sendEmail(
              email,
              `New ${announcementType.replace(
                "_",
                " "
              )} Announcement: ${title}`,
              getAnnouncementEmailTemplate(title, content, announcementType)
            )
          )
        );
        console.log(
          `Announcement emails sent for ${title} to ${recipients.length} users`
        );
      } catch (emailError) {
        console.error(`Failed to send announcement emails for ${title}:`, {
          message: emailError.message,
          stack: emailError.stack,
        });
        // Continue responding to client, as email failure is non-critical
      }

      res
        .status(201)
        .json({ message: "Announcement posted successfully", announcement });
    } catch (error) {
      console.error("Create Announcement Error:", {
        message: error.message,
        stack: error.stack,
      });
      res.status(500).json({ message: error.message || "Server error" });
    }
  }
);

app.get("/api/announcements", protect, async (req, res) => {
  try {
    const enrollments = await Enrollment.find({
      userId: req.user._id,
      status: "approved",
    }).select("course");
    const userCourses = enrollments.map((e) => e.course);
    const announcements = await Announcement.find({
      $or: [
        { targetAudience: "all" },
        { targetAudience: { $in: userCourses } },
      ],
    })
      .sort({ createdAt: -1 })
      .lean();
    res
      .status(200)
      .json({ message: "Announcements fetched successfully", announcements });
  } catch (error) {
    console.error("Fetch Announcements Error:", {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({ message: "Server error" });
  }
});

app.get(
  "/api/admin/announcements",
  protect,
  restrictToAdmin,
  async (req, res) => {
    try {
      const announcements = await Announcement.find()
        .sort({ createdAt: -1 })
        .populate("createdBy", "name email")
        .lean();
      res
        .status(200)
        .json({ message: "Announcements fetched successfully", announcements });
    } catch (error) {
      console.error("Fetch Admin Announcements Error:", {
        message: error.message,
        stack: error.stack,
      });
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.patch(
  "/api/admin/announcements/:id",
  protect,
  restrictToAdmin,
  announcementLimiter,
  async (req, res) => {
    try {
      const { title, content, targetAudience, announcementType } = req.body;
      if (!title || !content || !targetAudience || !announcementType) {
        console.log(
          `Missing update fields: title=${title}, targetAudience=${targetAudience}, announcementType=${announcementType}`
        );
        return res.status(400).json({ message: "All fields are required" });
      }

      const announcement = await Announcement.findByIdAndUpdate(
        req.params.id,
        {
          title,
          content,
          targetAudience,
          announcementType,
          updatedAt: Date.now(),
        },
        { new: true }
      );

      if (!announcement) {
        console.log(`Announcement not found: ${req.params.id}`);
        return res.status(404).json({ message: "Announcement not found" });
      }

      console.log(`Announcement updated: ${title} for ${targetAudience}`);
      res
        .status(200)
        .json({ message: "Announcement updated successfully", announcement });
    } catch (error) {
      console.error("Update Announcement Error:", {
        message: error.message,
        stack: error.stack,
      });
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.delete(
  "/api/admin/announcements/:id",
  protect,
  restrictToAdmin,
  async (req, res) => {
    try {
      const announcement = await Announcement.findByIdAndDelete(req.params.id);
      if (!announcement) {
        console.log(`Announcement not found for deletion: ${req.params.id}`);
        return res.status(404).json({ message: "Announcement not found" });
      }

      console.log(`Announcement deleted: ${announcement.title}`);
      res.status(200).json({ message: "Announcement deleted successfully" });
    } catch (error) {
      console.error("Delete Announcement Error:", {
        message: error.message,
        stack: error.stack,
      });
      res.status(500).json({ message: "Server error" });
    }
  }
);

// EJS Setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Routes for EJS Templates
const renderPage = (page) => (req, res) =>
  res.render(page, { user: req.user || null, request: req });

app.get("/", renderPage("index"));
app.get("/signup", renderPage("signup"));
app.get("/admin", protect, restrictToAdmin, renderPage("admin"));
app.get(
  "/admin/feedback",
  protect,
  restrictToAdmin,
  renderPage("admin/feedback")
);
app.get(
  "/admin/analytics",
  protect,
  restrictToAdmin,
  renderPage("admin/analytics")
);
app.get(
  "/admin/messages",
  protect,
  restrictToAdmin,
  renderPage("admin/messages")
);
app.get(
  "/admin/announcements",
  protect,
  restrictToAdmin,
  renderPage("admin/announcements")
);
app.get("/dashboard", protect, renderPage("dashboard"));
app.get("/dashboard/courses", protect, renderPage("dashboard/courses"));
app.get(
  "/dashboard/coding-Challenge",
  protect,
  renderPage("dashboard/coding-Challenge")
);
app.get(
  "/dashboard/practiceProject",
  protect,
  renderPage("dashboard/practiceProject")
);
app.get(
  "/dashboard/studyMaterials",
  protect,
  renderPage("dashboard/studyMaterials")
);
app.get("/dashboard/messages", protect, renderPage("dashboard/messages"));
app.get(
  "/dashboard/announcement",
  protect,
  renderPage("dashboard/announcement")
);
app.get("/dashboard/feedback", protect, renderPage("dashboard/feedback"));
app.get("/dashboard/feed", protect, renderPage("dashboard/feed"));
app.get("/digital-marketing", renderPage("courses/digitalMarketing"));
app.get(
  "/details-digital-marketing",
  renderPage("courses/course-details/digital-marketing")
);
app.get("/web-dev", renderPage("courses/webdev"));
app.get("/frontend", renderPage("courses/course-details/frontend"));
app.get("/backend", renderPage("courses/course-details/backend"));
app.get("/fullstack", renderPage("courses/course-details/fullstack"));
app.get("/ai-fundamentals", renderPage("courses/course-details/details-genai"));
app.get("/java", renderPage("courses/course-details/java"));
app.get("/cpp", renderPage("courses/course-details/cpp"));
app.get("/python", renderPage("courses/course-details/python"));
app.get("/fundamentals", renderPage("courses/course-details/fundamentals"));
app.get("/javaScript", renderPage("courses/course-details/javaScript"));
app.get("/programming", renderPage("courses/Programming"));
app.get("/genai", renderPage("courses/genai"));
app.get("/codingChallenge", renderPage("resources/CodingChallenge"));
app.get("/practiceProject", renderPage("resources/PracticeProject"));
app.get("/studyMaterials", renderPage("resources/StudyMaterials"));
app.get("/expertProfiles", renderPage("team/ExpertProfile"));
app.get("/meetTeam", renderPage("team/MeetOurTeam"));

app.get("/payment", protect, (req, res) => {
  res.render("courses/payment2", {
    user: {
      name: req.user.name,
      email: req.user.email,
      profileImage: req.user.profileImage,
    },
    request: req,
  });
});

// Start Server
connectDB().then(() => {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
