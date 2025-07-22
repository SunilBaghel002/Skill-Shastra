const jwt = require("jsonwebtoken");
const User = require("../models/User"); // Adjust path if needed

const protect = async (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
  const isApiRoute = req.originalUrl.startsWith("/api/");
  const isSignupRoute = req.originalUrl.startsWith("/signup");

  if (!token) {
    if (isApiRoute) {
      return res.status(401).json({ message: "No token provided" });
    }
    if (isSignupRoute) {
      return next();
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
      if (isSignupRoute) {
        return next();
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
    res.clearCookie("token");
    if (isApiRoute) {
      return res.status(401).json({ message: "Invalid token" });
    }
    if (isSignupRoute) {
      return next();
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

module.exports = { protect, restrictToAdmin };