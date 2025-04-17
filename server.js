require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
const Post = mongoose.model('Post', new mongoose.Schema({ title: String, excerpt: String, slug: String }));
const Contact = mongoose.model('Contact', new mongoose.Schema({ name: String, email: String, message: String, createdAt: { type: Date, default: Date.now } }));

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: get latest posts
app.get('/api/posts', async (req, res) => {
  const posts = await Post.find().sort({ createdAt: -1 }).limit(6);
  res.json(posts);
});

// API: contact form
app.post('/api/contact', async (req, res) => {
  try {
    const contact = new Contact(req.body);
    await contact.save();
    // send email notification
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
    await transporter.sendMail({ from: process.env.EMAIL_USER, to: process.env.EMAIL_USER, subject: 'New Contact Message', text: `Name: ${contact.name}\nEmail: ${contact.email}\nMessage: ${contact.message}` });
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
