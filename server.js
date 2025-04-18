require('dotenv').config();
console.log('EMAIL_USER =', process.env.EMAIL_USER);
console.log('EMAIL_PASS length =', process.env.EMAIL_PASS?.length);

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const session = require('express-session');
const { Pool } = require('pg');

const app = express();

//-----------------------------------------------------------------
// Middleware
//-----------------------------------------------------------------
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

//-----------------------------------------------------------------
// PostgreSQL Connection
//-----------------------------------------------------------------
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

//-----------------------------------------------------------------
// Auth Helper
//-----------------------------------------------------------------
function requireAdmin(req, res, next) {
  if (req.session?.admin) return next();
  res.sendStatus(401);
}

//-----------------------------------------------------------------
// Admin Routes
//-----------------------------------------------------------------
// Login
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
    req.session.admin = true;
    return res.sendStatus(200);
  }
  res.sendStatus(401);
});

// Logout
app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.sendStatus(200));
});

//-----------------------------------------------------------------
// Posts API (PostgreSQL)
//-----------------------------------------------------------------
// Create
app.post('/api/posts', requireAdmin, async (req, res) => {
  const { title, excerpt, slug } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO posts (title, excerpt, slug) VALUES ($1, $2, $3) RETURNING *`,
      [title, excerpt, slug]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating post:', err);
    res.sendStatus(500);
  }
});

// Read (public)
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, excerpt, slug, created_at FROM posts ORDER BY created_at DESC LIMIT 6`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching posts:', err);
    res.sendStatus(500);
  }
});

// Update
app.put('/api/posts/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { title, excerpt, slug } = req.body;
  try {
    const result = await pool.query(
      `UPDATE posts SET title=$1, excerpt=$2, slug=$3 WHERE id=$4 RETURNING *`,
      [title, excerpt, slug, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating post:', err);
    res.sendStatus(500);
  }
});

// Delete
app.delete('/api/posts/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM posts WHERE id=$1`, [id]);
    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting post:', err);
    res.sendStatus(500);
  }
});

//-----------------------------------------------------------------
// Contact API (email-only)
//-----------------------------------------------------------------
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `New message from ${name}`,
      text: `Email: ${email}\n\n${message}`
    });

    res.sendStatus(200);
  } catch (err) {
    console.error('Error sending email:', err);
    res.sendStatus(500);
  }
});

//-----------------------------------------------------------------
// SPA Fallback
//-----------------------------------------------------------------
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/index.html'))
);

//-----------------------------------------------------------------
// Start Server
//-----------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));