const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { protect, restrictToAdmin } = require("../middleware/auth");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const Course = require("../models/Course");

// Rate Limiting Middleware for Study Materials
const materialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs
  message:
    "Too many study material requests, please try again after 15 minutes.",
});

// Multer Setup for File Uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/png",
      "image/jpeg",
      "application/pdf",
      "video/mp4",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PNG, JPG, PDF, and MP4 files are allowed."));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
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

// Study Material Schema
const studyMaterialSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 100 },
  description: { type: String, required: true, maxlength: 500 },
  fileUrl: { type: String, required: true },
  fileType: {
    type: String,
    enum: ["pdf", "video", "image"],
    required: true,
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
});

const StudyMaterial = mongoose.model("StudyMaterial", studyMaterialSchema);

// Seed Courses Function
const seedCourses = async () => {
  try {
    const existingCourses = await Course.countDocuments();
    if (existingCourses > 0) {
      console.log("Courses already exist, skipping seeding.");
      return;
    }

    const courses = [
      {
        title: "Frontend Development",
        description: "Learn React, HTML, CSS.",
        duration: "6 weeks",
        slug: "frontend",
        facultyName: "John Doe",
        facultyEmail: "john.doe@skillshastra.com",
        price: 6000,
      },
      {
        title: "Backend Development",
        description: "Master Node.js, Express, MongoDB.",
        duration: "6 weeks",
        slug: "backend",
        facultyName: "Jane Smith",
        facultyEmail: "jane.smith@skillshastra.com",
        price: 6000,
      },
      {
        title: "Full Stack Development",
        description: "Build full-stack apps with MERN.",
        duration: "8 weeks",
        slug: "full-stack",
        facultyName: "Alex Johnson",
        facultyEmail: "alex.johnson@skillshastra.com",
        price: 12000,
      },
      {
        title: "Digital Marketing",
        description: "Master SEO, PPC, and social media.",
        duration: "4 weeks",
        slug: "digital-marketing",
        facultyName: "Emma Brown",
        facultyEmail: "emma.brown@skillshastra.com",
        price: 6000,
      },
      {
        title: "JavaScript Programming",
        description: "Deep dive into JavaScript and its frameworks.",
        duration: "5 weeks",
        slug: "javascript",
        facultyName: "Michael Lee",
        facultyEmail: "michael.lee@skillshastra.com",
        price: 6000,
      },
      {
        title: "Java Programming",
        description: "Learn Java for enterprise applications.",
        duration: "6 weeks",
        slug: "java",
        facultyName: "Sarah Davis",
        facultyEmail: "sarah.davis@skillshastra.com",
        price: 6000,
      },
      {
        title: "Python Programming",
        description: "Master Python for data science and web development.",
        duration: "6 weeks",
        slug: "python",
        facultyName: "David Wilson",
        facultyEmail: "david.wilson@skillshastra.com",
        price: 6000,
      },
      {
        title: "C++ Programming",
        description: "Learn C++ for system programming.",
        duration: "6 weeks",
        slug: "cpp",
        facultyName: "Laura Martinez",
        facultyEmail: "laura.martinez@skillshastra.com",
        price: 6000,
      },
      {
        title: "Programming Fundamentals",
        description: "Introduction to programming concepts.",
        duration: "4 weeks",
        slug: "fundamentals",
        facultyName: "Chris Taylor",
        facultyEmail: "chris.taylor@skillshastra.com",
        price: 6000,
      },
      {
        title: "Gen AI",
        description: "Explore generative AI and machine learning.",
        duration: "8 weeks",
        slug: "gen-ai",
        facultyName: "Sophie Clark",
        facultyEmail: "sophie.clark@skillshastra.com",
        price: 6000,
      },
      {
        title: "DSA",
        description: "Learn Data Structures and Algorithms.",
        duration: "6 weeks",
        slug: "dsa",
        facultyName: "Robert Brown",
        facultyEmail: "robert.brown@skillshastra.com",
        price: 7500,
      },
    ];

    await Course.insertMany(courses);
    console.log("Courses seeded successfully");
  } catch (error) {
    console.error("Course Seeding Error:", error);
  }
};

seedCourses();

// Admin: Create Study Material
router.post(
  "/",
  protect,
  restrictToAdmin,
  materialLimiter,
  upload.single("file"),
  multerErrorHandler,
  async (req, res) => {
    try {
      const { title, description, courseId, fileType } = req.body;
      if (!title || !description || !courseId || !fileType || !req.file) {
        return res
          .status(400)
          .json({ message: "All fields and file are required" });
      }

      const course = await Course.findById(courseId);
      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "skillshastra/study-materials",
            public_id: `study_material_${Date.now()}`,
            resource_type:
              fileType === "video"
                ? "video"
                : fileType === "pdf"
                ? "raw"
                : "image",
            format: req.file.mimetype.split("/")[1],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });

      const studyMaterial = new StudyMaterial({
        title,
        description,
        fileUrl: uploadResult.secure_url,
        fileType,
        course: courseId,
        createdBy: req.user._id,
      });

      await studyMaterial.save();
      res.status(201).json({
        message: "Study material created successfully",
        studyMaterial,
      });
    } catch (error) {
      console.error("Create Study Material Error:", {
        message: error.message,
        stack: error.stack,
        body: req.body,
        file: req.file ? req.file.mimetype : "No file",
      });
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Admin: Update Study Material
router.patch(
  "/:id",
  protect,
  restrictToAdmin,
  materialLimiter,
  upload.single("file"),
  multerErrorHandler,
  async (req, res) => {
    try {
      const { title, description, courseId, fileType } = req.body;
      if (!title || !description || !courseId || !fileType) {
        return res.status(400).json({ message: "All fields are required" });
      }

      const course = await Course.findById(courseId);
      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      const updateData = { title, description, course: courseId, fileType };
      if (req.file) {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "skillshastra/study-materials",
              public_id: `study_material_${Date.now()}`,
              resource_type:
                fileType === "video"
                  ? "video"
                  : fileType === "pdf"
                  ? "raw"
                  : "image",
              format: req.file.mimetype.split("/")[1],
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          stream.end(req.file.buffer);
        });
        updateData.fileUrl = uploadResult.secure_url;
      }

      const studyMaterial = await StudyMaterial.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      );
      if (!studyMaterial) {
        return res.status(404).json({ message: "Study material not found" });
      }

      res.status(200).json({
        message: "Study material updated successfully",
        studyMaterial,
      });
    } catch (error) {
      console.error("Update Study Material Error:", {
        message: error.message,
        stack: error.stack,
        body: req.body,
        file: req.file ? req.file.mimetype : "No file",
      });
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Admin: Delete Study Material
router.delete(
  "/:id",
  protect,
  restrictToAdmin,
  materialLimiter,
  async (req, res) => {
    try {
      const studyMaterial = await StudyMaterial.findByIdAndDelete(
        req.params.id
      );
      if (!studyMaterial) {
        return res.status(404).json({ message: "Study material not found" });
      }
      res.status(200).json({ message: "Study material deleted successfully" });
    } catch (error) {
      console.error("Delete Study Material Error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// User: Fetch Enrolled Courses and Study Materials
router.get("/", protect, async (req, res) => {
  try {
    const enrollments = await mongoose
      .model("Enrollment")
      .find({ userId: req.user._id, status: "approved" })
      .select("course");
    const userCourses = enrollments.map((e) => e.course);

    const courses = await Course.find({
      title: { $in: userCourses },
    }).lean();

    const studyMaterials = await StudyMaterial.find({
      course: { $in: courses.map((c) => c._id) },
    })
      .populate("course", "title facultyName")
      .populate("createdBy", "name")
      .sort({ createdAt: -1 })
      .lean();

    const coursesWithMaterials = courses.map((course) => ({
      ...course,
      materials: studyMaterials.filter(
        (material) => material.course._id.toString() === course._id.toString()
      ),
    }));

    res.status(200).json({
      message: "Courses and study materials fetched successfully",
      courses: coursesWithMaterials,
    });
  } catch (error) {
    console.error("Fetch Study Materials Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Admin: Fetch All Study Materials
router.get("/admin", protect, restrictToAdmin, async (req, res) => {
  try {
    const studyMaterials = await StudyMaterial.find()
      .populate("course", "title facultyName")
      .populate("createdBy", "name")
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({
      message: "Study materials fetched successfully",
      studyMaterials,
    });
  } catch (error) {
    console.error("Fetch Admin Study Materials Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Admin: Fetch All Courses
router.get("/courses", protect, restrictToAdmin, async (req, res) => {
  try {
    const courses = await Course.find().lean();
    res.status(200).json({
      message: "Courses fetched successfully",
      courses,
    });
  } catch (error) {
    console.error("Fetch Courses Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Admin: Seed Courses Endpoint
router.post("/seed-courses", protect, restrictToAdmin, async (req, res) => {
  try {
    await seedCourses();
    res.status(200).json({ message: "Courses seeded successfully" });
  } catch (error) {
    console.error("Seed Courses Endpoint Error:", error);
    res.status(500).json({ message: "Server error during seeding" });
  }
});

module.exports = router;
