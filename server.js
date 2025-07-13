require('dotenv').config();
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
app.use(express.static(path.join(__dirname, 'public')));

// FIXED: Session configuration with proper settings
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'a-very-strong-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: { 
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
      sameSite: 'lax'
    },
    name: 'agpt.session' // Custom session name
  })
);

//-----------------------------------------------------------------
// PostgreSQL Connection
//-----------------------------------------------------------------
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

//-----------------------------------------------------------------
// Auth Helpers - ENHANCED ERROR HANDLING
//-----------------------------------------------------------------
function requireLogin(req, res, next) {
  console.log('Session check:', req.session); // Debug log
  if (req.session && req.session.user) {
    return next();
  }
  console.log('Authentication failed - no valid session');
  res.status(401).json({ error: 'Authentication required' });
}

function requireAdmin(req, res, next) {
  console.log('Admin check:', req.session?.user); // Debug log
  if (req.session?.user?.role === 'admin') {
    return next();
  }
  console.log('Admin authorization failed');
  res.status(403).json({ error: 'Admin access required' });
}

//-----------------------------------------------------------------
// User & Auth Routes
//-----------------------------------------------------------------
app.get('/users/me', (req, res) => {
    console.log('User me check:', req.session); // Debug log
    if (req.session && req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

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
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND password = $2',
      [username, password]
    );
    const user = result.rows[0];
    if (user) {
      // FIXED: Ensure session is properly set
      req.session.user = { 
        id: user.id, 
        username: user.username, 
        role: user.role 
      };
      
      // Force session save
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({ error: 'Login failed' });
        }
        console.log('User logged in successfully:', req.session.user);
        res.status(200).json({ success: true });
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('agpt.session');
    res.status(200).json({ success: true });
  });
});

//-----------------------------------------------------------------
// Original Posts API (for website articles)
//-----------------------------------------------------------------
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
    res.status(500).json({ error: 'Failed to create post' });
  }
});

app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, excerpt, slug, created_at FROM posts ORDER BY created_at DESC LIMIT 6`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching posts:', err);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

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
    res.status(500).json({ error: 'Failed to update post' });
  }
});

app.delete('/api/posts/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM posts WHERE id=$1`, [id]);
    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting post:', err);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

//-----------------------------------------------------------------
// Kanban API (PostgreSQL) - SECURED WITH BETTER ERROR HANDLING
//-----------------------------------------------------------------
app.get('/api/kanban', requireLogin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM kanban_cards ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching cards:', err);
    res.status(500).json({ error: 'Failed to fetch cards' });
  }
});

app.post('/api/kanban', requireLogin, async (req, res) => {
  const { client, task, owner, due_date, status, blocker_flag, category } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO kanban_cards (client, task, owner, due_date, status, blocker_flag, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [client, task, owner, due_date, status || 'To Do', blocker_flag, category]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating card:', err);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

app.put('/api/kanban/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    const { client, task, owner, due_date, status, blocker_flag, category } = req.body;
    
    try {
        const currentState = await pool.query('SELECT status, completed_at FROM kanban_cards WHERE id = $1', [id]);
        if (currentState.rows.length === 0) {
            return res.status(404).json({ error: 'Card not found' });
        }
        
        const oldStatus = currentState.rows[0].status;
        let completed_at = currentState.rows[0].completed_at;

        if (status === 'Done' && oldStatus !== 'Done') {
            completed_at = new Date();
        } else if (status !== 'Done') {
            completed_at = null;
        }

        const result = await pool.query(
            `UPDATE kanban_cards
             SET client=$1, task=$2, owner=$3, due_date=$4, status=$5, blocker_flag=$6, category=$7, completed_at=$8
             WHERE id=$9 RETURNING *`,
            [client, task, owner, due_date, status, blocker_flag, category, completed_at, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Card not found' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating card:', err);
        res.status(500).json({ error: 'Failed to update card' });
    }
});

app.patch('/api/kanban/:id/status', requireLogin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    try {
        const currentState = await pool.query('SELECT status, completed_at FROM kanban_cards WHERE id = $1', [id]);
        if (currentState.rows.length === 0) {
            return res.status(404).json({ error: 'Card not found' });
        }
        
        const oldStatus = currentState.rows[0].status;
        let completed_at = currentState.rows[0].completed_at;

        if (status === 'Done' && oldStatus !== 'Done') {
            completed_at = new Date();
        } else if (status !== 'Done') {
            completed_at = null;
        }

        const result = await pool.query(
            `UPDATE kanban_cards SET status = $1, completed_at = $2 WHERE id = $3 RETURNING *`,
            [status, completed_at, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Card not found' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error patching card status:', err);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

app.delete('/api/kanban/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM kanban_cards WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }
    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting card:', err);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

//-----------------------------------------------------------------
// Admin Management API - FIXED ERROR HANDLING
//-----------------------------------------------------------------
app.get('/api/users', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, role FROM users ORDER BY username');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const adminUserId = req.session.user.id;
    
    if (parseInt(id) === parseInt(adminUserId)) {
        return res.status(400).json({ error: "Admin cannot delete their own account." });
    }
    
    try {
        const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.sendStatus(204);
    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// FIXED: Clear completed cards endpoint
app.delete('/api/kanban/completed', requireAdmin, async (req, res) => {
    try {
        console.log('Attempting to clear completed cards...');
        const result = await pool.query("DELETE FROM kanban_cards WHERE status = 'Done' RETURNING id");
        console.log(`Deleted ${result.rows.length} completed cards`);
        res.status(200).json({ 
            success: true, 
            deletedCount: result.rows.length,
            message: `Successfully deleted ${result.rows.length} completed cards`
        });
    } catch (err) {
        console.error('Error clearing completed cards:', err);
        res.status(500).json({ error: 'Failed to clear completed cards' });
    }
});

//-----------------------------------------------------------------
// Original Contact API
//-----------------------------------------------------------------
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;
  try {
    const transporter = nodemailer.createTransporter({
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

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error sending email:', err);
    res.status(500).json({ error: 'Failed to send email' });
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