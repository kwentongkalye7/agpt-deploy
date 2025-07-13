require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const session = require('express-session');
const { Pool } = require('pg');

const app = express();

//-----------------------------------------------------------------
// DEBUGGING MIDDLEWARE - Add this to see what's happening
//-----------------------------------------------------------------
app.use((req, res, next) => {
  console.log(`\n=== ${req.method} ${req.url} ===`);
  console.log('Headers:', req.headers);
  console.log('Session ID:', req.sessionID);
  console.log('Session Data:', req.session);
  console.log('Cookies:', req.headers.cookie);
  next();
});

//-----------------------------------------------------------------
// Middleware
//-----------------------------------------------------------------
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ENHANCED Session configuration with multiple fallbacks
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'agpt-secret-key-2025',
    resave: true, // Changed to true for debugging
    saveUninitialized: true, // Changed to true for debugging
    rolling: true, // Refresh session on each request
    cookie: { 
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
      httpOnly: false, // Changed to false for debugging
      secure: false, // Must be false for HTTP
      sameSite: 'lax'
    },
    name: 'agpt.session.id' // More specific session name
  })
);

// Additional session debugging
app.use((req, res, next) => {
  console.log('POST-SESSION MIDDLEWARE:');
  console.log('Session ID after middleware:', req.sessionID);
  console.log('Session object:', req.session);
  next();
});

//-----------------------------------------------------------------
// PostgreSQL Connection
//-----------------------------------------------------------------
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

//-----------------------------------------------------------------
// Auth Helpers - COMPLETELY REWRITTEN
//-----------------------------------------------------------------
function requireLogin(req, res, next) {
  console.log('\n=== REQUIRE LOGIN CHECK ===');
  console.log('Session exists:', !!req.session);
  console.log('Session user:', req.session?.user);
  console.log('Session ID:', req.sessionID);
  
  if (req.session && req.session.user && req.session.user.id) {
    console.log('✅ Authentication SUCCESS');
    return next();
  }
  
  console.log('❌ Authentication FAILED');
  res.status(401).json({ 
    error: 'Authentication required',
    debug: {
      hasSession: !!req.session,
      hasUser: !!req.session?.user,
      sessionId: req.sessionID,
      userObject: req.session?.user
    }
  });
}

function requireAdmin(req, res, next) {
  console.log('\n=== REQUIRE ADMIN CHECK ===');
  console.log('User role:', req.session?.user?.role);
  
  if (req.session?.user?.role === 'admin') {
    console.log('✅ Admin authorization SUCCESS');
    return next();
  }
  
  console.log('❌ Admin authorization FAILED');
  res.status(403).json({ 
    error: 'Admin access required',
    debug: {
      userRole: req.session?.user?.role,
      userId: req.session?.user?.id
    }
  });
}

//-----------------------------------------------------------------
// User & Auth Routes - COMPLETELY REWRITTEN
//-----------------------------------------------------------------
app.get('/users/me', (req, res) => {
    console.log('\n=== GET /users/me ===');
    console.log('Session:', req.session);
    console.log('User in session:', req.session?.user);
    
    if (req.session && req.session.user) {
        console.log('✅ Returning user data');
        res.json(req.session.user);
    } else {
        console.log('❌ No user in session');
        res.status(401).json({ 
          error: 'Not authenticated',
          debug: {
            hasSession: !!req.session,
            sessionId: req.sessionID
          }
        });
    }
});

app.post('/users/register', async (req, res) => {
    const { username, password } = req.body;
    console.log('\n=== POST /users/register ===');
    console.log('Username:', username);
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }
    
    try {
        const existingUser = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Username already taken.' });
        }
        
        const result = await pool.query(
            `INSERT INTO users (username, password, role) VALUES ($1, $2, 'employee') RETURNING id, username, role`,
            [username, password]
        );
        
        console.log('✅ User registered successfully');
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('❌ Registration error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/admin/login', async (req, res) => {
  console.log('\n=== POST /admin/login ===');
  const { username, password } = req.body;
  console.log('Login attempt for username:', username);
  
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND password = $2',
      [username, password]
    );
    
    const user = result.rows[0];
    console.log('Database query result:', !!user);
    
    if (user) {
      console.log('User found, setting session...');
      
      // MULTIPLE session setting approaches
      req.session.user = { 
        id: user.id, 
        username: user.username, 
        role: user.role 
      };
      
      // Force regenerate session
      req.session.regenerate((err) => {
        if (err) {
          console.error('Session regenerate error:', err);
          return res.status(500).json({ error: 'Session creation failed' });
        }
        
        // Set user again after regeneration
        req.session.user = { 
          id: user.id, 
          username: user.username, 
          role: user.role 
        };
        
        // Force save
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('Session save error:', saveErr);
            return res.status(500).json({ error: 'Session save failed' });
          }
          
          console.log('✅ Login successful, session saved');
          console.log('Session after save:', req.session);
          res.status(200).json({ 
            success: true, 
            user: req.session.user,
            sessionId: req.sessionID
          });
        });
      });
    } else {
      console.log('❌ Invalid credentials');
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/admin/logout', (req, res) => {
  console.log('\n=== POST /admin/logout ===');
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('agpt.session.id');
    console.log('✅ Logout successful');
    res.status(200).json({ success: true });
  });
});

//-----------------------------------------------------------------
// DEBUG ENDPOINT - Add this to test sessions
//-----------------------------------------------------------------
app.get('/debug/session', (req, res) => {
  res.json({
    sessionId: req.sessionID,
    session: req.session,
    cookies: req.headers.cookie,
    user: req.session?.user
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
  console.log('\n=== POST /api/kanban ===');
  console.log('User making request:', req.session.user);
  
  try {
    const result = await pool.query(
      `INSERT INTO kanban_cards (client, task, owner, due_date, status, blocker_flag, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [client, task, owner, due_date, status || 'To Do', blocker_flag, category]
    );
    console.log('✅ Card created successfully');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error creating card:', err);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

app.put('/api/kanban/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    const { client, task, owner, due_date, status, blocker_flag, category } = req.body;
    console.log('\n=== PUT /api/kanban/:id ===');
    console.log('User making request:', req.session.user);
    
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
        
        console.log('✅ Card updated successfully');
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Error updating card:', err);
        res.status(500).json({ error: 'Failed to update card' });
    }
});

app.patch('/api/kanban/:id/status', requireLogin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    console.log('\n=== PATCH /api/kanban/:id/status ===');
    console.log('User making request:', req.session.user);
    console.log('Updating card', id, 'to status:', status);
    
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
        
        console.log('✅ Card status updated successfully');
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Error patching card status:', err);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

app.delete('/api/kanban/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  console.log('\n=== DELETE /api/kanban/:id ===');
  console.log('Admin deleting card:', id);
  
  try {
    const result = await pool.query('DELETE FROM kanban_cards WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }
    console.log('✅ Card deleted successfully');
    res.sendStatus(204);
  } catch (err) {
    console.error('❌ Error deleting card:', err);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

//-----------------------------------------------------------------
// Admin Management API - ENHANCED
//-----------------------------------------------------------------
app.get('/api/users', requireAdmin, async (req, res) => {
    console.log('\n=== GET /api/users ===');
    try {
        const result = await pool.query('SELECT id, username, role FROM users ORDER BY username');
        console.log('✅ Users fetched successfully');
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Error fetching users:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const adminUserId = req.session.user.id;
    console.log('\n=== DELETE /api/users/:id ===');
    console.log('Admin ID:', adminUserId, 'Deleting user ID:', id);
    
    if (parseInt(id) === parseInt(adminUserId)) {
        return res.status(400).json({ error: "Admin cannot delete their own account." });
    }
    
    try {
        const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        console.log('✅ User deleted successfully');
        res.sendStatus(204);
    } catch (err) {
        console.error('❌ Error deleting user:', err);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

app.delete('/api/kanban/completed', requireAdmin, async (req, res) => {
    console.log('\n=== DELETE /api/kanban/completed ===');
    console.log('Admin clearing completed cards');
    
    try {
        const result = await pool.query("DELETE FROM kanban_cards WHERE status = 'Done' RETURNING id");
        console.log(`✅ Deleted ${result.rows.length} completed cards`);
        res.status(200).json({ 
            success: true, 
            deletedCount: result.rows.length,
            message: `Successfully deleted ${result.rows.length} completed cards`
        });
    } catch (err) {
        console.error('❌ Error clearing completed cards:', err);
        res.status(500).json({ error: 'Failed to clear completed cards', details: err.message });
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
app.listen(PORT, () => {
  console.log(`\n🚀 Server listening on port ${PORT}`);
  console.log(`🔍 Debug session endpoint: http://localhost:${PORT}/debug/session`);
  console.log(`📝 Visit this URL after login to check session state\n`);
});