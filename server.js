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
// Enhanced Posts API with Better Error Handling
//-----------------------------------------------------------------
app.post('/api/posts', requireAdmin, async (req, res) => {
  console.log('\n=== POST /api/posts ===');
  console.log('Admin creating post:', req.session.user);
  console.log('Request body:', req.body);
  
  const { title, excerpt, slug } = req.body;
  
  if (!title || !excerpt || !slug) {
    console.log('❌ Missing required fields');
    return res.status(400).json({ error: 'Title, excerpt, and slug are required' });
  }
  
  try {
    const result = await pool.query(
      `INSERT INTO posts (title, excerpt, slug) VALUES ($1, $2, $3) RETURNING *`,
      [title, excerpt, slug]
    );
    console.log('✅ Post created successfully:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error creating post:', err);
    console.error('Error details:', {
      message: err.message,
      code: err.code,
      detail: err.detail
    });
    res.status(500).json({ 
      error: 'Failed to create post', 
      details: err.message,
      code: err.code 
    });
  }
});

app.get('/api/posts', async (req, res) => {
  console.log('\n=== GET /api/posts ===');
  try {
    const result = await pool.query(
      `SELECT id, title, excerpt, slug, created_at FROM posts ORDER BY created_at DESC LIMIT 6`
    );
    console.log(`✅ Fetched ${result.rows.length} posts successfully`);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching posts:', err);
    res.status(500).json({ 
      error: 'Failed to fetch posts', 
      details: err.message 
    });
  }
});

app.put('/api/posts/:id', requireAdmin, async (req, res) => {
  console.log('\n=== PUT /api/posts/:id ===');
  console.log('Admin updating post:', req.session.user);
  console.log('Post ID:', req.params.id);
  console.log('Request body:', req.body);
  
  const { id } = req.params;
  const { title, excerpt, slug } = req.body;
  
  if (!title || !excerpt || !slug) {
    console.log('❌ Missing required fields');
    return res.status(400).json({ error: 'Title, excerpt, and slug are required' });
  }
  
  try {
    // First check if post exists
    const existingPost = await pool.query('SELECT * FROM posts WHERE id = $1', [id]);
    if (existingPost.rows.length === 0) {
      console.log('❌ Post not found');
      return res.status(404).json({ error: 'Post not found' });
    }
    
    const result = await pool.query(
      `UPDATE posts SET title=$1, excerpt=$2, slug=$3 WHERE id=$4 RETURNING *`,
      [title, excerpt, slug, id]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ Update returned no rows');
      return res.status(404).json({ error: 'Post not found after update' });
    }
    
    console.log('✅ Post updated successfully:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error updating post:', err);
    console.error('Error details:', {
      message: err.message,
      code: err.code,
      detail: err.detail
    });
    res.status(500).json({ 
      error: 'Failed to update post', 
      details: err.message,
      code: err.code 
    });
  }
});

app.delete('/api/posts/:id', requireAdmin, async (req, res) => {
  console.log('\n=== DELETE /api/posts/:id ===');
  console.log('Admin deleting post:', req.session.user);
  console.log('Post ID:', req.params.id);
  
  const { id } = req.params;
  
  try {
    // First check if post exists
    const existingPost = await pool.query('SELECT * FROM posts WHERE id = $1', [id]);
    if (existingPost.rows.length === 0) {
      console.log('❌ Post not found');
      return res.status(404).json({ error: 'Post not found' });
    }
    
    console.log('Deleting post:', existingPost.rows[0]);
    
    const result = await pool.query(`DELETE FROM posts WHERE id=$1 RETURNING id`, [id]);
    
    if (result.rows.length === 0) {
      console.log('❌ Delete returned no rows');
      return res.status(404).json({ error: 'Post not found for deletion' });
    }
    
    console.log('✅ Post deleted successfully');
    res.sendStatus(204);
  } catch (err) {
    console.error('❌ Error deleting post:', err);
    console.error('Error details:', {
      message: err.message,
      code: err.code,
      detail: err.detail
    });
    res.status(500).json({ 
      error: 'Failed to delete post', 
      details: err.message,
      code: err.code 
    });
  }
});

//-----------------------------------------------------------------
// Enhanced Kanban API with Better Error Handling
//-----------------------------------------------------------------
app.get('/api/kanban', requireLogin, async (req, res) => {
  console.log('\n=== GET /api/kanban ===');
  console.log('User:', req.session.user);
  
  try {
    const result = await pool.query('SELECT * FROM kanban_cards ORDER BY id');
    console.log(`✅ Fetched ${result.rows.length} cards successfully`);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching cards:', err);
    res.status(500).json({ error: 'Failed to fetch cards', details: err.message });
  }
});

app.post('/api/kanban', requireLogin, async (req, res) => {
  console.log('\n=== POST /api/kanban ===');
  console.log('User making request:', req.session.user);
  console.log('Request body:', req.body);
  
  const { client, task, owner, due_date, status, blocker_flag, category } = req.body;
  
  // Validate required fields
  if (!client || !task) {
    console.log('❌ Missing required fields');
    return res.status(400).json({ error: 'Client and task are required' });
  }
  
  try {
    const query = `
      INSERT INTO kanban_cards (client, task, owner, due_date, status, blocker_flag, category)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `;
    const values = [
      client, 
      task, 
      owner || null, 
      due_date || null, 
      status || 'To Do', 
      blocker_flag || false, 
      category || null
    ];
    
    console.log('Executing query:', query);
    console.log('With values:', values);
    
    const result = await pool.query(query, values);
    console.log('✅ Card created successfully:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error creating card:', err);
    console.error('Error details:', {
      message: err.message,
      code: err.code,
      detail: err.detail
    });
    res.status(500).json({ 
      error: 'Failed to create card', 
      details: err.message,
      code: err.code 
    });
  }
});

app.put('/api/kanban/:id', requireLogin, async (req, res) => {
    console.log('\n=== PUT /api/kanban/:id ===');
    console.log('User making request:', req.session.user);
    console.log('Card ID:', req.params.id);
    console.log('Request body:', req.body);
    
    const { id } = req.params;
    const { client, task, owner, due_date, status, blocker_flag, category } = req.body;
    
    // Validate required fields
    if (!client || !task) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ error: 'Client and task are required' });
    }
    
    try {
        // First check if card exists
        const existingCard = await pool.query('SELECT * FROM kanban_cards WHERE id = $1', [id]);
        if (existingCard.rows.length === 0) {
            console.log('❌ Card not found');
            return res.status(404).json({ error: 'Card not found' });
        }
        
        console.log('Current card state:', existingCard.rows[0]);
        
        const oldStatus = existingCard.rows[0].status;
        let completed_at = existingCard.rows[0].completed_at;

        if (status === 'Done' && oldStatus !== 'Done') {
            completed_at = new Date();
            console.log('Setting completion timestamp:', completed_at);
        } else if (status !== 'Done') {
            completed_at = null;
            console.log('Clearing completion timestamp');
        }

        const query = `
          UPDATE kanban_cards
          SET client=$1, task=$2, owner=$3, due_date=$4, status=$5, blocker_flag=$6, category=$7, completed_at=$8
          WHERE id=$9 RETURNING *
        `;
        const values = [
          client, 
          task, 
          owner || null, 
          due_date || null, 
          status, 
          blocker_flag || false, 
          category || null, 
          completed_at, 
          id
        ];
        
        console.log('Executing update query:', query);
        console.log('With values:', values);
        
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            console.log('❌ Update returned no rows');
            return res.status(404).json({ error: 'Card not found after update' });
        }
        
        console.log('✅ Card updated successfully:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Error updating card:', err);
        console.error('Error details:', {
          message: err.message,
          code: err.code,
          detail: err.detail
        });
        res.status(500).json({ 
          error: 'Failed to update card', 
          details: err.message,
          code: err.code 
        });
    }
});

app.patch('/api/kanban/:id/status', requireLogin, async (req, res) => {
    console.log('\n=== PATCH /api/kanban/:id/status ===');
    console.log('User making request:', req.session.user);
    console.log('Card ID:', req.params.id);
    console.log('New status:', req.body.status);
    
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      console.log('❌ Status is required');
      return res.status(400).json({ error: 'Status is required' });
    }
    
    try {
        // Check if card exists and get current state
        const currentState = await pool.query('SELECT * FROM kanban_cards WHERE id = $1', [id]);
        if (currentState.rows.length === 0) {
            console.log('❌ Card not found');
            return res.status(404).json({ error: 'Card not found' });
        }
        
        console.log('Current card:', currentState.rows[0]);
        
        const oldStatus = currentState.rows[0].status;
        let completed_at = currentState.rows[0].completed_at;

        if (status === 'Done' && oldStatus !== 'Done') {
            completed_at = new Date();
            console.log('Setting completion timestamp:', completed_at);
        } else if (status !== 'Done') {
            completed_at = null;
            console.log('Clearing completion timestamp');
        }

        const query = `
          UPDATE kanban_cards 
          SET status = $1, completed_at = $2
          WHERE id = $3 
          RETURNING *
        `;
        const values = [status, completed_at, id];
        
        console.log('Executing status update:', query);
        console.log('With values:', values);
        
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            console.log('❌ Status update returned no rows');
            return res.status(404).json({ error: 'Card not found after status update' });
        }
        
        console.log('✅ Card status updated successfully:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Error updating card status:', err);
        console.error('Error details:', {
          message: err.message,
          code: err.code,
          detail: err.detail
        });
        res.status(500).json({ 
          error: 'Failed to update status', 
          details: err.message,
          code: err.code 
        });
    }
});

// FIXED: Clear Completed Cards Endpoint - MOVED BEFORE the /:id route
app.delete('/api/kanban/completed', requireAdmin, async (req, res) => {
    console.log('\n=== DELETE /api/kanban/completed ===');
    console.log('Admin clearing completed cards:', req.session.user);
    
    try {
        // First, let's see what cards we're trying to delete
        const doneCards = await pool.query("SELECT id, client, task FROM kanban_cards WHERE status = 'Done'");
        console.log(`Found ${doneCards.rows.length} cards in Done status:`, doneCards.rows);
        
        if (doneCards.rows.length === 0) {
            console.log('ℹ️ No cards in Done status to delete');
            return res.status(200).json({ 
                success: true, 
                deletedCount: 0,
                message: 'No completed cards to delete'
            });
        }
        
        // Try to delete each card individually to identify any problem cards
        let deletedCount = 0;
        let failedCards = [];
        
        for (const card of doneCards.rows) {
            try {
                const deleteResult = await pool.query("DELETE FROM kanban_cards WHERE id = $1 AND status = 'Done' RETURNING id", [card.id]);
                if (deleteResult.rows.length > 0) {
                    deletedCount++;
                    console.log(`✅ Deleted card ${card.id}: ${card.client} - ${card.task}`);
                } else {
                    console.log(`⚠️ Card ${card.id} was not deleted (may have changed status)`);
                }
            } catch (err) {
                console.error(`❌ Failed to delete card ${card.id}:`, err.message);
                failedCards.push({ id: card.id, client: card.client, error: err.message });
            }
        }
        
        if (failedCards.length > 0) {
            console.log('Some cards failed to delete:', failedCards);
            return res.status(207).json({ // 207 = Multi-Status
                success: true,
                deletedCount: deletedCount,
                failedCount: failedCards.length,
                failedCards: failedCards,
                message: `Deleted ${deletedCount} cards, ${failedCards.length} failed`
            });
        }
        
        console.log(`✅ Successfully deleted all ${deletedCount} completed cards`);
        res.status(200).json({ 
            success: true, 
            deletedCount: deletedCount,
            message: `Successfully deleted ${deletedCount} completed cards`
        });
        
    } catch (err) {
        console.error('❌ Error in clear completed cards:', err);
        console.error('Error details:', {
            message: err.message,
            code: err.code,
            detail: err.detail,
            stack: err.stack
        });
        res.status(500).json({ 
            error: 'Failed to clear completed cards', 
            details: err.message,
            code: err.code 
        });
    }
});

// Individual card deletion - MOVED AFTER the /completed route
app.delete('/api/kanban/:id', requireAdmin, async (req, res) => {
  console.log('\n=== DELETE /api/kanban/:id ===');
  console.log('Admin deleting individual card:', req.session.user);
  console.log('Card ID:', req.params.id);
  
  const { id } = req.params;
  
  try {
    // First check if card exists
    const existingCard = await pool.query('SELECT * FROM kanban_cards WHERE id = $1', [id]);
    if (existingCard.rows.length === 0) {
      console.log('❌ Card not found');
      return res.status(404).json({ error: 'Card not found' });
    }
    
    console.log('Deleting card:', existingCard.rows[0]);
    
    const result = await pool.query('DELETE FROM kanban_cards WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      console.log('❌ Delete returned no rows');
      return res.status(404).json({ error: 'Card not found for deletion' });
    }
    
    console.log('✅ Individual card deleted successfully');
    res.sendStatus(204);
  } catch (err) {
    console.error('❌ Error deleting individual card:', err);
    console.error('Error details:', {
      message: err.message,
      code: err.code,
      detail: err.detail
    });
    res.status(500).json({ 
      error: 'Failed to delete card', 
      details: err.message,
      code: err.code 
    });
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