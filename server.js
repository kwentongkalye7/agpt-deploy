require('dotenv').config();
console.log('EMAIL_USER =', process.env.EMAIL_USER);
console.log('EMAIL_PASS length =', process.env.EMAIL_PASS?.length);
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const session = require('express-session');

const app = express();
// Env: ADMIN_USER, ADMIN_PASS, MONGO_URI, EMAIL_USER, EMAIL_PASS

// Middleware
app.use(bodyParser.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change_this',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 600000 }
  })
);
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
const Post = mongoose.model('Post', new mongoose.Schema({ title: String, excerpt: String, slug: String, createdAt: { type: Date, default: Date.now } }));
const Contact = mongoose.model('Contact', new mongoose.Schema({ name: String, email: String, message: String, createdAt: { type: Date, default: Date.now } }));

// Auth helper
function requireAdmin(req, res, next) {
  if (req.session?.admin) return next();
  res.sendStatus(401);
}

// Admin login
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.admin = true;
    res.sendStatus(200);
  } else res.sendStatus(401);
});
app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.sendStatus(200));
});

// Update post
app.put('/api/posts/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const updated = await Post.findByIdAndUpdate(id, data, { new: true });
    res.json(updated);
  } catch (err) {
    res.sendStatus(500);
  }
});

// Delete post
app.delete('/api/posts/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await Post.findByIdAndDelete(id);
    res.sendStatus(204);
  } catch {
    res.sendStatus(500);
  }
});

// Public APIs
app.get('/api/posts', async (req, res) => {
  const posts = await Post.find().sort({ createdAt: -1 }).limit(6);
  res.json(posts);
});
app.post('/api/contact', async (req, res) => {
  try {
    const contact = new Contact(req.body);
    await contact.save();
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
    await transporter.sendMail({ from: process.env.EMAIL_USER, to: process.env.EMAIL_USER, subject: 'New Contact Message', text: `Name: ${contact.name}\nEmail: ${contact.email}\nMessage: ${contact.message}` });
    res.sendStatus(200);
  } catch { res.sendStatus(500); }
});

// Protected admin posting
app.post('/api/posts', requireAdmin, async (req, res) => {
  try { const p = new Post(req.body); await p.save(); res.status(201).json(p); }
  catch { res.sendStatus(500); }
});

// Fallback to SPA
app.get('*', (req, res) => res.sendFile(path.join(__dirname,'public/index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));