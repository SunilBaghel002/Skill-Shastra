const mongoose = require("mongoose");

const courseSchema = new mongoose.Schema({
  title: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  duration: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  facultyName: { type: String, required: true },
  facultyEmail: { type: String, required: true },
  price: { type: Number, required: true },
});

module.exports = mongoose.model("Course", courseSchema);