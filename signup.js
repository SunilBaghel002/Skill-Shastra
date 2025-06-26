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
  cors({
    origin: "https://skill-shastra.vercel.app/",
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

cloudinary.uploader.upload(
  './public/images/Logo.png',
  {
    folder: 'public/images',
    public_id: 'logo',
    resource_type: 'image',
  },
  (error, result) => {
    if (error) console.error(error);
    else console.log('Logo URL:', result.secure_url);
  }
);

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
    phone: { type: String },
    dob: { type: Date },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    resetOtp: { type: String },
    resetOtpExpiry: { type: Date },
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

// Hash password
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password
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
  title: { type: String, required: true },
  content: { type: String, required: true },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
});

const Announcement = mongoose.model("Announcement", announcementSchema);

// Course Schema
const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  duration: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
});

const Course = mongoose.model("Course", courseSchema);

// Multer Setup (Memory Storage for Cloudinary)
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
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

transporter.verify((error, success) => {
  if (error) console.error("SMTP Configuration Error:", error);
  else console.log("SMTP Server is ready to send emails");
});

// OTP Storage
let otpStorage = {};

// Utility Function: Generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Email Templates
const getRegistrationOtpEmailTemplate = (otp) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your OTP for Skill Shastra Login</title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            background-color: #1a1a1a;
            margin: 0;
            padding: 0;
            color: #e0e0e0;
            line-height: 1.6;
        }
        .container {
            width: 100%;
            max-width: 700px;
            margin: 20px auto;
            background-color: rgb(207, 199, 199);
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 0 20px rgba(0, 255, 255, 0.3);
        }
        .header {
            text-align: center;
            padding: 10px 15px;
            background: linear-gradient(135deg, #1f3a44, #0a2629);
            border-bottom: 3px solid #00cccc;
        }
        .header img {
            max-width: 120px;
            height: auto;
            margin: 5px 0;
        }
        .header h1 {
            color: #00cccc;
            font-size: 24px;
            margin: 5px 0 0;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .header p {
            color: #b0b0b0;
            font-size: 14px;
            margin: 5px 0;
        }
        .content {
            padding: 20px;
            text-align: center;
        }
        .otp-box {
            font-size: 28px;
            font-weight: bold;
            color: #00cccc;
            background-color: #1a1a1a;
            padding: 12px 25px;
            display: inline-block;
            margin: 20px 0;
            border: 2px solid #00cccc;
            border-radius: 6px;
            box-shadow: 0 0 10px rgba(0, 255, 255, 0.6);
        }
        .features {
            margin: 25px 0;
            display: flex;
            justify-content: space-around;
            flex-wrap: wrap;
            padding: 0 20px;
        }
        .feature-item {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
            flex: 1 1 30%;
            min-width: 200px;
        }
        .feature-item img {
            width: 28px;
            height: 28px;
            margin-right: 12px;
        }
        .footer {
            background-color: #333333;
            padding: 15px;
            text-align: center;
            font-size: 12px;
            color: #b0b0b0;
            border-top: 1px solid #00cccc;
        }
        a {
            color: #00cccc;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
            color: #00ffff;
        }
        h2 {
            color: #00cccc;
            margin: 15px 0;
            font-size: 24px;
        }
        p {
            margin: 10px 0;
        }
        @media only screen and (min-width: 601px) {
            .header { padding: 15px 20px; }
            .header h1 { font-size: 28px; }
            .header p { font-size: 16px; }
            .content { padding: 30px; }
            .otp-box { font-size: 32px; padding: 15px 30px; }
            .features { padding: 0 30px; }
            .feature-item { min-width: 180px; }
            .feature-item img { width: 32px; height: 32px; }
            h2 { font-size: 26px; }
            p { font-size: 16px; }
        }
        @media only screen and (max-width: 600px) {
            .container { margin: 10px; border-radius: 6px; max-width: 100%; }
            .header { padding: 8px 10px; }
            .header img { max-width: 100px; }
            .header h1 { font-size: 20px; }
            .header p { font-size: 12px; }
            .content { padding: 15px; }
            .otp-box { font-size: 22px; padding: 10px 20px; }
            .features { padding: 0 10px; display: block; }
            .feature-item { min-width: 100%; margin-bottom: 12px; }
            .feature-item img { width: 24px; height: 24px; }
            .footer { padding: 12px; font-size: 10px; }
            h2 { font-size: 20px; }
            p { font-size: 14px !important; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="https://i.postimg.cc/pT69mFMB/logo.png" alt="Skill Shastra Logo">
            <h1>Skill Shastra</h1>
            <p>Your Career Mapping and Skill Development Platform</p>
        </div>
        <div class="content">
            <h2>Unlock Your Career Potential</h2>
            <p style="font-size: 16px;">
                Hello,<br>
                Welcome to Skill Shastra—your platform for career growth and skill enhancement. We're here to guide you with personalized tools and insights.
            </p>
            <p style="font-size: 16px;">
                Your One-Time Password (OTP) to register securely:
            </p>
            <div class="otp-box">${otp}</div>
            <p style="font-size: 14px; color: #b0b0b0;">
                Valid for 10 minutes. Keep it confidential.
            </p>
            <div class="features">
                <div class="feature-item">
                    <img src="https://img.icons8.com/ios-filled/50/00cccc/clock.png" alt="Career Icon">
                    <span>Personalized career mapping</span>
                </div>
                <div class="feature-item">
                    <img src="https://img.icons8.com/ios-filled/50/00cccc/settings.png" alt="Skill Icon">
                    <span>Skill development tools</span>
                </div>
                <div class="feature-item">
                    <img src="https://img.icons8.com/ios-filled/50/00cccc/shield.png" alt="Guidance Icon">
                    <span>Expert career guidance</span>
                </div>
            </div>
            <p style="font-size: 16px;">
                Stay connected:<br>
                <a href="https://instagram.com/skillshastra" target="_blank">@SkillShastra</a> | 
                <a href="https://skill-shastra.vercel.app/" target="_blank">www.skillshastra.com</a>
            </p>
        </div>
        <div class="footer">
            <p>Best regards,<br><strong>Skill Shastra Team</strong></p>
            <p>© ${new Date().getFullYear()} Skill Shastra. All rights reserved.</p>
            <p>Need help? <a href="mailto:support@skillshastra.com">support@skillshastra.com</a></p>
        </div>
    </div>
</body>
</html>
`;

const getPasswordResetOtpEmailTemplate = (otp) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset OTP</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap');
        body { font-family: "Poppins", sans-serif; background-color: #f9f9f9; margin: 0; padding: 0; }
        .email-container { max-width: 600px; margin: 20px auto; background: #ffffff; border: 1px solid #e0e0e0; border-radius: 10px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }
        .email-header { background-color: #4caf50; color: #ffffff; text-align: center; padding: 20px; }
        .email-header img { width: 150px; }
        .email-header h1 { margin: 10px 0 0; font-size: 24px; }
        .email-body { padding: 20px; text-align: center; }
        .email-body h2 { font-size: 20px; color: #333; }
        .email-body .otp-box { background-color: #f4f4f4; font-size: 24px; color: #4caf50; padding: 15px; margin: 20px auto; width: fit-content; border-radius: 5px; border: 1px solid #ddd; }
        .email-body p { font-size: 16px; color: #555; line-height: 1.6; }
        .email-footer { text-align: center; padding: 15px; font-size: 14px; color: #777; background-color: #f4f4f4; }
        .email-footer a { color: #4caf50; text-decoration: none; }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="email-header">
            <img src="https://i.postimg.cc/pT69mFMB/logo.png" alt="Skill Shastra Logo">
            <h1>Skill Shastra</h1>
        </div>
        <div class="email-body">
            <h2>🔑 Password Reset</h2>
            <p>We received a request to reset your password. Use the OTP below to proceed:</p>
            <div class="otp-box">${otp}</div>
            <p><em>(This OTP is valid for the next 10 minutes.)</em></p>
            <p>If you didn’t request this, please ignore this email or <a href="mailto:support@skillshastra.com">contact support</a>.</p>
        </div>
        <div class="email-footer">
            <p>Need help? <a href="https://skill-shastra.vercel.app/support">Visit our support page</a>.</p>
            <p>The <strong>Skill Shastra Team</strong></p>
        </div>
    </div>
</body>
</html>
`;

const getWelcomeEmailTemplate = (name) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>Welcome to Skill Shastra</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; font-family: 'Poppins', Arial, sans-serif; background-color: #f3f0ff;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f0ff;">
        <tr>
            <td align="center">
                <div style="position: relative; width: 100%; max-width: 600px; margin: 0 auto;">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 0;">
                        <div style="position: absolute; top: -50px; left: -50px; width: 200px; height: 200px; background: radial-gradient(circle, rgba(139, 92, 246, 0.1), transparent 70%); border-radius: 50%;"></div>
                        <div style="position: absolute; bottom: -100px; right: -100px; width: 250px; height: 250px; background: radial-gradient(circle, rgba(167, 139, 250, 0.1), transparent 70%); border-radius: 50%;"></div>
                        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0, 0, 0, 0.02) 10px, rgba(0, 0, 0, 0.02) 20px);"></div>
                        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-image: radial-gradient(circle, #d1d5db, 1px, transparent 1px); background-size: 20px 20px; opacity: 0.3;"></div>
                    </div>
                    <table role="presentation" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); position: relative; z-index: 1;">
                        <tr>
                            <td style="padding: 30px; background: linear-gradient(90deg, #8b5cf6, #a78bfa); text-align: center; border-top-left-radius: 8px; border-top-right-radius: 8px;">
                                <img src="https://res.cloudinary.com/dsk80td7v/image/upload/v1750568168/public/images/logo.png" alt="Skill Shastra Logo" style="max-width: 200px; height: auto; display: block; margin: 0 auto;">
                                <h1 style="font-size: 24px; font-weight: 600; color: #ffffff; margin: 15px 0 0;">Welcome to Skill Shastra</h1>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 20px 20px;">
                                <h2 style="font-size: 20px; font-weight: 500; color: #8b5cf6; margin: 0 0 15px;">Hello, ${name}!</h2>
                                <p style="font-size: 16px; line-height: 1.6; color: #4a4a4a; margin: 0 0 15px;">
                                    We’re beyond excited to welcome you to <strong>Skill Shastra</strong>! Your account is now verified, and you’re ready to join our vibrant community of learners mastering skills for the future.
                                </p>
                                <p style="font-size: 16px; line-height: 1.6; color: #4a4a4a; margin: 0 0 20px;">
                                    Dive into our curated courses, designed to empower you to achieve your personal and professional goals. Your journey to success starts today!
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 0 20px 20px; text-align: center;">
                                <a href="https://skill-shastra.vercel.app/dashboard/courses" style="display: inline-block; padding: 12px 24px; background: linear-gradient(90deg, #8b5cf6, #a78bfa); color: #ffffff; font-size: 16px; font-weight: 500; text-decoration: none; border-radius: 8px;">Start Learning Now</a>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 0 20px 20px; text-align: center;">
                                <p style="font-size: 14px; line-height: 1.6; color: #6b7280; margin: 0;">
                                    Need help or have questions? Our support team is here for you at 
                                    <a href="mailto:support@skillshastra.com" style="color: #8b5cf6; text-decoration: none; font-weight: 500;">support@skillshastra.com</a>.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 20px; background-color: #f3f0ff; text-align: center; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;">
                                <p style="font-size: 12px; color: #6b7280; margin: 0 0 10px;">
                                    Connect with us: 
                                    <a href="https://twitter.com/skillshastra" style="color: #8b5cf6; text-decoration: none; margin: 0 5px;">Twitter</a> | 
                                    <a href="https://linkedin.com/company/skillshastra" style="color: #8b5cf6; text-decoration: none; margin: 0 5px;">LinkedIn</a> | 
                                    <a href="https://instagram.com/skillshastra" style="color: #8b5cf6; text-decoration: none; margin: 0 5px;">Instagram</a>
                                </p>
                                <p style="font-size: 12px; color: #6b7280; margin: 0;">
                                    © ${new Date().getFullYear()} Skill Shastra. All rights reserved.
                                </p>
                            </td>
                        </tr>
                    </table>
                </div>
            </td>
        </tr>
    </table>
</body>
</html>
`;

const getEnrollmentConfirmationEmailTemplate = (
  fullName,
  course,
  transactionId,
  paymentProofUrl
) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Enrollment Confirmation</title>
    <style>
        body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 20px auto; background: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); }
        .header { text-align: center; padding: 10px 0; }
        .header img { max-width: 150px; }
        .content { padding: 20px; }
        .content h1 { color: #333; font-size: 24px; margin-bottom: 20px; }
        .content p { color: #555; font-size: 16px; line-height: 1.6; margin-bottom: 15px; }
        .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .table th, .table td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        .table th { background-color: #f8f8f8; color: #333; }
        .cta-button { display: inline-block; background-color: #4caf50; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
        .footer { text-align: center; padding: 10px 0; font-size: 12px; color: #777; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="https://i.postimg.cc/pT69mFMB/logo.png" alt="Skill Shastra Logo">
        </div>
        <div class="content">
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
        </div>
        <div class="footer">
            <p>© ${new Date().getFullYear()} Skill Shastra. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`;

const getEnrollmentStatusEmailTemplate = (fullName, course, status) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Enrollment Status Update</title>
    <style>
        body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 20px auto; background: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); }
        .header { text-align: center; padding: 10px 0; }
        .header img { max-width: 150px; }
        .content { padding: 20px; }
        .content h1 { color: #333; font-size: 24px; margin-bottom: 20px; }
        .content p { color: #555; font-size: 16px; line-height: 1.6; margin-bottom: 15px; }
        .status-approved { color: #4caf50; font-weight: bold; }
        .status-rejected { color: #f44336; font-weight: bold; }
        .cta-button { display: inline-block; background-color: #4caf50; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
        .footer { text-align: center; padding: 10px 0; font-size: 12px; color: #777; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="https://i.postimg.cc/pT69mFMB/logo.png" alt="Skill Shastra Logo">
        </div>
        <div class="content">
            <h1>Enrollment Status Update</h1>
            <p>Dear ${fullName},</p>
            <p>Your enrollment for <strong>${course}</strong> has been <span class="status-${status.toLowerCase()}">${status}</span>.</p>
            ${
              status === "approved"
                ? "<p>Congratulations! You can now access your course materials on the dashboard.</p>"
                : "<p>We’re sorry, but your enrollment could not be approved. Please contact us for more details.</p>"
            }
            <p><a href="https://skill-shastra.vercel.app/dashboard" class="cta-button">View Dashboard</a></p>
            <p>Thank you for choosing Skill Shastra! If you have any questions, reach out to <a href="mailto:support@skillshastra.com">support@skillshastra.com</a>.</p>
        </div>
        <div class="footer">
            <p>© ${new Date().getFullYear()} Skill Shastra. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`;

// Authentication Middleware
const protect = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select(
      "-password -resetOtp -resetOtpExpiry"
    );
    if (!user) {
      res.clearCookie("token");
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error("JWT Verification Error:", error);
    res.clearCookie("token");
    return res.status(401).json({ message: "Invalid token" });
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

// Authentication Routes
app.post("/api/auth/signup", upload.none(), async (req, res) => {
  const { email, password, redirect } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const otp = generateOTP();
    otpStorage[email] = otp;

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: email,
      subject: "Registration OTP - Skill Shastra",
      html: getRegistrationOtpEmailTemplate(otp),
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending OTP email:", error);
        return res.status(500).json({ message: "Failed to send OTP" });
      }
      console.log("OTP email sent:", info.response);
      res.status(200).json({ message: "OTP sent! Please verify.", redirect });
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/auth/verify-otp", async (req, res) => {
  const { email, otp, password, name, phone, dob, redirect } = req.body;
  if (!email || !otp || !password || !name) {
    return res.status(400).json({ message: "All required fields must be provided" });
  }

  try {
    if (otpStorage[email] !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      email,
      password: hashedPassword,
      name,
      phone,
      dob: dob ? new Date(dob) : null,
      role: process.env.ADMIN_EMAILS?.split(",").includes(email) ? "admin" : "user",
    });

    await user.save();

    delete otpStorage[email];

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "strict",
    });

    transporter.sendMail(
      {
        from: process.env.GMAIL_USER,
        to: email,
        subject: "Welcome to Skill Shastra!",
        html: getWelcomeEmailTemplate(name),
      },
      (error, info) => {
        if (error) {
          console.error("Error sending welcome email:", error);
        } else {
          console.log("Welcome email sent:", info.response);
        }
      }
    );

    res.status(201).json({
      message: "Registration successful",
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
        const user = await User.findById(decoded.userId).select(
          "-password-resOtp-resOtpExpiry"
        );
        if (user) {
          return res.status(400).json({
            message: "User already logged in",
            user: {
              name: user.name,
              email: user.email,
              role: user.role,
              profileImage: profileImage.profileImage,
            },
            redirect: redirect,
          });
        }
        res.clearCookie("token");
      } catch (error) {
        res.clearCookie("token");
      }
    }

    const user = await User.findOne({ email: email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const newToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    res.cookie("token", newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "strict",
      meSite: "Strict",
    });

    res.status(200).json({
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage,
      },
      redirect: redirect,
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
    status: true,
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
      return res.status(404).json({ message: "Email not found" });
    }

    const otp = generateOTP();
    user.resetOtp = otp;
    user.resetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: email,
      subject: "Password Reset OTP - Skill Shastra",
      html: getPasswordResetOtpEmailTemplate(otp),
    };

    transporter.sendMail(mailOptions, (error) => {
      if (error) {
        console.error("Error sending OTP email:", error);
        return res.status(500).json({ message: "Failed to send OTP" });
      }
      res.status(200).json({ message: "OTP sent to your email", redirect });
    });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/auth/reset-password/verify-otp", async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP are required" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user || user.resetOtp !== otp || user.resetOtpExpiry < Date.now()) {
      return res.status(400).json({ valid: false });
    }
    res.status(200).json({ valid: true });
  } catch (error) {
    console.error("Verify OTP Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { email, password, redirect } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.password = password;
    user.resetOtp = null;
    user.resetOtpExpiry = null;
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
    const users = await User.find().select("-password -resetOtp -resetOtpExpiry");
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
        { status: status },
        { new: true }
      );
      if (!enrollment) {
        return res.status(404).json({ message: "Enrollment not found" });
      }
      const user = await User.findById(enrollment.userId);
      transporter.sendMail(
        {
          from: process.env.GMAIL_USER,
          to: enrollment.email,
          subject: `Skill Shastra Enrollment ${status.charAt(0).toUpperCase() + status.slice(1)}`,
          html: getEnrollmentStatusEmailTemplate(
            enrollment.fullName,
            enrollment.course,
            status
          ),
        },
        (error, info) => {
          if (error) {
            console.error("Error sending enrollment status email:", error);
          } else {
            console.log("Enrollment status email sent:", info.response);
          }
        }
      );
      res.status(200).json({ message: `Enrollment ${status} successfully`, enrollment });
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

// Announcements Route
app.post(
  "/api/admin/announcements",
  protect,
  restrictToAdmin,
  async (req, res) => {
    try {
      const { title, content } = req.body;
      if (!title || !content) {
        return res
          .status(400)
          .json({ message: "Title and content are required" });
      }
      const announcement = await Announcement.create({
        title,
        content,
        createdBy: req.user._id,
      });
      res
        .status(201)
        .json({ message: "Announcement posted successfully", announcement });
    } catch (error) {
      console.error("Error posting announcement:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

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

      transporter.sendMail(
        {
          from: process.env.GMAIL_USER,
          to: studentData.email,
          subject: "Skill Shastra Enrollment Confirmation",
          html: getEnrollmentConfirmationEmailTemplate(
            studentData.fullName,
            studentData.course,
            transactionId,
            paymentProofUrl
          ),
        },
        (error, info) => {
          if (error) {
            console.error("Error sending enrollment confirmation email:", error);
          } else {
            console.log("Enrollment confirmation email sent:", info.response);
          }
        }
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