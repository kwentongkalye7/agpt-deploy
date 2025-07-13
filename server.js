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
// Auth Helpers
//-----------------------------------------------------------------
function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  res.sendStatus(401); // Unauthorized
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  res.sendStatus(403); // Forbidden
}

//-----------------------------------------------------------------
// User & Auth Routes
//-----------------------------------------------------------------
// Get current user status
app.get('/users/me', (req, res) => {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).send('Not authenticated');
    }
});

// Register New Employee
app.post('/users/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).send('Username and password are required.');
    }
    try {
        const existingUser = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            return res.status(409).send('Username already taken.');
        }
        const result = await pool.query(
            `INSERT INTO users (username, password, role) VALUES ($1, $2, 'employee') RETURNING id, username, role`,
            [username, password]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Registration error:', err);
        res.sendStatus(500);
    }
});

// Login
app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND password = $2',
      [username, password]
    );
    const user = result.rows[0];
    if (user) {
      req.session.user = { id: user.id, username: user.username, role: user.role };
      return res.sendStatus(200);
    }
    res.sendStatus(401);
  } catch (err) {
    console.error('Login error:', err);
    res.sendStatus(500);
  }
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
// Kanban API (PostgreSQL) - SECURED
//-----------------------------------------------------------------
// Read All Cards (Any Logged-in User)
app.get('/api/kanban', requireLogin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM kanban_cards ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching cards:', err);
    res.sendStatus(500);
  }
});

// Create Card (Any Logged-in User)
app.post('/api/kanban', requireLogin, async (req, res) => {
  const { client, task, owner, due_date, status, blocker_flag, category } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO kanban_cards (client, task, owner, due_date, status, blocker_flag, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [client, task, owner, due_date, status, blocker_flag, category]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating card:', err);
    res.sendStatus(500);
  }
});

// Update Card (handles completed_at timestamp)
app.put('/api/kanban/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    const { client, task, owner, due_date, status, blocker_flag, category } = req.body;
    try {
        const currentState = await pool.query('SELECT status, completed_at FROM kanban_cards WHERE id = $1', [id]);
        if (currentState.rows.length === 0) {
            return res.status(404).send('Card not found');
        }
        const oldStatus = currentState.rows[0].status;
        let completed_at = currentState.rows[0].completed_at;

        if (status === 'Done' && oldStatus !== 'Done') {
            completed_at = new Date(); // Set timestamp when moving to Done
        } else if (status !== 'Done') {
            completed_at = null; // Clear timestamp if moving out of Done
        }

        const result = await pool.query(
            `UPDATE kanban_cards
             SET client=$1, task=$2, owner=$3, due_date=$4, status=$5, blocker_flag=$6, category=$7, completed_at=$8
             WHERE id=$9 RETURNING *`,
            [client, task, owner, due_date, status, blocker_flag, category, completed_at, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating card:', err);
        res.sendStatus(500);
    }
});

// Delete Card (Admin Only)
app.delete('/api/kanban/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM kanban_cards WHERE id=$1', [id]);
    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting card:', err);
    res.sendStatus(500);
  }
});

//-----------------------------------------------------------------
// Admin Management API
//-----------------------------------------------------------------
// Get all users (Admin only)
app.get('/api/users', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, role FROM users ORDER BY username');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.sendStatus(500);
    }
});

// Delete a user (Admin only)
app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const adminUserId = req.session.user.id;
    if (id == adminUserId) {
        return res.status(400).send("Admin cannot delete their own account.");
    }
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        res.sendStatus(204);
    } catch (err) {
        console.error('Error deleting user:', err);
        res.sendStatus(500);
    }
});

// Clear all completed cards (Admin only)
app.delete('/api/kanban/completed', requireAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM kanban_cards WHERE status = 'Done'");
        res.sendStatus(204); // No Content
    } catch (err) {
        console.error('Error clearing completed cards:', err);
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