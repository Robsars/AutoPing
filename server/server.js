const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');
const { parseExpression } = require('cron-parser');
const notifier = require('node-notifier');

// Load dotenv with explicit path, handling missing .env gracefully
try {
  const dotenvPath = path.resolve(__dirname, '.env');
  require('dotenv').config({ path: dotenvPath });
} catch (e) {
  console.log('No .env file found, using defaults');
}

// Import email service - wrap in try-catch for packaged app
let emailService;
try {
  emailService = require('./emailService');
} catch (e) {
  console.error('Email service import error:', e.message);
  // Provide fallbacks if emailService fails to load
  emailService = {
    sendFailureNotification: async () => false,
    sendRecoveryNotification: async () => false,
    canSendEmail: () => false
  };
}
const { sendFailureNotification, sendRecoveryNotification, canSendEmail } = emailService;

const app = express();
// Allow Render/other hosts to set the port
const PORT = process.env.PORT || 3001;

// Serve static files in production (Electron)
if (process.env.SERVE_STATIC) {
  app.use(express.static(process.env.SERVE_STATIC));
}

// Middleware
app.use(cors());
app.use(express.json());

// Database Setup
// Allow override to place the DB on a mounted disk in hosted environments
const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'autoping.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database at:', dbPath);

    // Use serialize to ensure operations happen in order
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        interval TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        last_run DATETIME,
        last_duration INTEGER,
        last_result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        failure_count INTEGER DEFAULT 0,
        original_interval TEXT,
        failure_state TEXT DEFAULT 'normal',
        pause_until DATETIME,
        last_email_sent DATETIME,
        alert_email TEXT,
        failure_started_at DATETIME,
        last_email_type TEXT,
        email_sent_at DATETIME,
        email_rate_limit INTEGER DEFAULT 30,
        failure_cycles INTEGER DEFAULT 0,
        permanently_paused INTEGER DEFAULT 0
      )`, (err) => {
        if (err) {
          console.error('Error creating table:', err.message);
        } else {
          console.log('Jobs table ready.');
        }
      });

      // Migration: Add new columns to existing tables
      const migrations = [
        'ALTER TABLE jobs ADD COLUMN failure_count INTEGER DEFAULT 0',
        'ALTER TABLE jobs ADD COLUMN original_interval TEXT',
        'ALTER TABLE jobs ADD COLUMN failure_state TEXT DEFAULT "normal"',
        'ALTER TABLE jobs ADD COLUMN pause_until DATETIME',
        'ALTER TABLE jobs ADD COLUMN last_email_sent DATETIME',
        'ALTER TABLE jobs ADD COLUMN alert_email TEXT',
        'ALTER TABLE jobs ADD COLUMN failure_started_at DATETIME',
        'ALTER TABLE jobs ADD COLUMN last_email_type TEXT',
        'ALTER TABLE jobs ADD COLUMN email_sent_at DATETIME',
        'ALTER TABLE jobs ADD COLUMN email_rate_limit INTEGER DEFAULT 30',
        'ALTER TABLE jobs ADD COLUMN failure_cycles INTEGER DEFAULT 0',
        'ALTER TABLE jobs ADD COLUMN permanently_paused INTEGER DEFAULT 0'
      ];

      migrations.forEach(migration => {
        db.run(migration, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error('Migration error:', err.message);
          }
        });
      });

      // Load existing jobs after table is ready
      db.all("SELECT * FROM jobs", [], (err, rows) => {
        if (err) {
          console.error("Error loading jobs:", err);
          return;
        }
        rows.forEach(row => {
          // Pass the full job data to handle paused/rapid_check states
          startJob(row.id, row.url, row.interval, row.status, row);
        });
        console.log(`Loaded ${rows.length} jobs from database.`);
      });
    });
  }
});

// In-memory storage for active cron tasks
const activeTasks = {};

// In-memory storage for failure history (for email notifications)
const failureHistory = {};

// In-memory storage for pause timeouts
const pauseTimeouts = {};

// Constants
const RAPID_CHECK_INTERVAL = '15 seconds';
const PAUSE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const FAILURE_THRESHOLD = 3; // Send email after 3 failures
const MAX_FAILURE_CYCLES = 5; // Permanently pause after 5 cycles
const EMAIL_RATE_LIMIT_MINUTES = parseInt(process.env.EMAIL_RATE_LIMIT_MINUTES || '60');

// Helper to get cron expression from interval string
const getCronExpression = (interval) => {
  switch (interval) {
    case '15 seconds': return '*/15 * * * * *';
    case '30 seconds': return '*/30 * * * * *';
    case '1 minute': return '* * * * *';
    case '5 minutes': return '*/5 * * * *';
    case '30 minutes': return '*/30 * * * *';
    case '1 hour': return '0 * * * *';
    default: return '* * * * *';
  }
};

// Helper to handle job resumption after pause
const resumeJob = (id) => {
  db.get("SELECT * FROM jobs WHERE id = ?", [id], (err, job) => {
    if (err || !job) {
      console.error(`Error resuming job ${id}:`, err?.message);
      return;
    }

    console.log(`⏰ Resuming job ${id} after 5-minute pause (Cycle ${job.failure_cycles + 1}/${MAX_FAILURE_CYCLES})`);

    // Increment failure cycles since we're resuming after a pause
    const newCycles = (job.failure_cycles || 0) + 1;

    // Reset to normal state
    const originalInterval = job.original_interval || job.interval;
    db.run(
      `UPDATE jobs SET
        failure_state = 'normal',
        failure_count = 0,
        pause_until = NULL,
        interval = ?,
        original_interval = NULL,
        failure_cycles = ?
      WHERE id = ?`,
      [originalInterval, newCycles, id],
      () => {
        // Clear failure history for this cycle
        delete failureHistory[id];
        // Restart job with original interval
        startJob(id, job.url, originalInterval, job.status);
      }
    );
  });
};

// Helper to perform a single ping manually (used for immediate first ping)
const performSinglePing = async (id, url) => {
  const start = Date.now();
  const now = new Date().toISOString();

  try {
    console.log(`[${now}] Performing immediate ping for ${url}...`);
    const response = await axios.get(url, {
      timeout: 30000,
      validateStatus: (status) => status < 500
    });
    const duration = Date.now() - start;
    const result = `Success: ${response.status}`;

    console.log(`[${now}] ✅ ${result} (${duration}ms)`);

    // Update database with initial result
    db.run(
      `UPDATE jobs SET
        last_run = ?,
        last_duration = ?,
        last_result = ?
      WHERE id = ?`,
      [now, duration, result, id],
      (err) => {
        if (err) {
          console.error(`Error updating initial ping result for job ${id}:`, err.message);
        }
      }
    );

    return { success: true, duration, result };
  } catch (error) {
    const duration = Date.now() - start;
    const result = `Error: ${error.message}`;
    console.error(`[${now}] ❌ ${result} (${duration}ms)`);

    // Update database with initial error
    db.run(
      `UPDATE jobs SET
        last_run = ?,
        last_duration = ?,
        last_result = ?
      WHERE id = ?`,
      [now, duration, result, id],
      (err) => {
        if (err) {
          console.error(`Error updating initial ping result for job ${id}:`, err.message);
        }
      }
    );

    return { success: false, duration, result };
  }
};

// Helper to start a cron job with failure tracking
const startJob = (id, url, interval, status, jobData = null) => {
  // Stop existing task if any
  if (activeTasks[id]) {
    activeTasks[id].stop();
    delete activeTasks[id];
  }

  // Clear any existing pause timeout
  if (pauseTimeouts[id]) {
    clearTimeout(pauseTimeouts[id]);
    delete pauseTimeouts[id];
  }

  if (status === 'stopped') {
    console.log(`Job ${id} for ${url} is stopped.`);
    return;
  }

  // Check if job is in paused state
  if (jobData) {
    if (jobData.failure_state === 'paused' && jobData.pause_until) {
      const pauseUntil = new Date(jobData.pause_until);
      const now = new Date();

      if (now < pauseUntil) {
        // Still in pause period, schedule resume
        const remainingPause = pauseUntil - now;
        console.log(`Job ${id} is paused. Will resume in ${Math.round(remainingPause / 1000)}s`);
        pauseTimeouts[id] = setTimeout(() => resumeJob(id), remainingPause);
        return;
      } else {
        // Pause period is over, resume immediately
        resumeJob(id);
        return;
      }
    }
  }

  console.log(`Starting job ${id} for ${url} every ${interval}`);

  const cronExpression = getCronExpression(interval);

  const task = cron.schedule(cronExpression, async () => {
    const start = Date.now();
    const now = new Date().toISOString();

    try {
      console.log(`[${now}] Pinging ${url}...`);
      const response = await axios.get(url, {
        timeout: 30000, // 30 second timeout
        validateStatus: (status) => status < 500 // Consider 4xx as success (server is responding)
      });
      const duration = Date.now() - start;
      const result = `Success: ${response.status}`;

      console.log(`[${now}] ✅ ${result} (${duration}ms)`);

      // Get current job state
      db.get("SELECT * FROM jobs WHERE id = ?", [id], async (err, job) => {
        if (err || !job) return;

        // Success! Check if we were in rapid_check mode
        if (job.failure_state === 'rapid_check') {
          console.log(`✅ Job ${id} recovered! Returning to normal interval.`);

          // Calculate downtime duration
          let downtimeDuration = 'Unknown';
          if (job.failure_started_at) {
            const failureStart = new Date(job.failure_started_at);
            const recoveryTime = new Date(now);
            const durationMs = recoveryTime - failureStart;
            const minutes = Math.floor(durationMs / 60000);
            const seconds = Math.floor((durationMs % 60000) / 1000);

            if (minutes > 0) {
              downtimeDuration = `${minutes} minute${minutes > 1 ? 's' : ''} ${seconds} second${seconds > 1 ? 's' : ''}`;
            } else {
              downtimeDuration = `${seconds} second${seconds > 1 ? 's' : ''}`;
            }
          }

          // Send recovery email if alert email is configured
          let emailSentAt = null;
          let lastEmailType = null;
          console.log(`📧 Recovery email check for job ${id}: alert_email=${job.alert_email}, downtime=${downtimeDuration}`);
          if (job.alert_email) {
            console.log(`📧 Calling sendRecoveryNotification for job ${id}...`);
            const emailSent = await sendRecoveryNotification(job, downtimeDuration);
            console.log(`📧 sendRecoveryNotification returned: ${emailSent}`);
            if (emailSent) {
              emailSentAt = now;
              lastEmailType = 'recovery';
              console.log(`📧 ✅ Setting recovery email_sent_at=${emailSentAt}, last_email_type=${lastEmailType} for job ${id}`);
            } else {
              console.error(`📧 ❌ Recovery email sending FAILED for job ${id}`);
            }
          } else {
            console.warn(`📧 No alert_email configured for job ${id}, skipping recovery email`);
          }

          // Reset to normal state and original interval
          const originalInterval = job.original_interval || job.interval;
          db.run(
            `UPDATE jobs SET
              last_run = ?,
              last_duration = ?,
              last_result = ?,
              failure_count = 0,
              failure_cycles = 0,
              failure_state = 'normal',
              interval = ?,
              original_interval = NULL,
              failure_started_at = NULL,
              email_sent_at = ?,
              last_email_type = ?
            WHERE id = ?`,
            [now, duration, result, originalInterval, emailSentAt, lastEmailType, id],
            () => {
              // Clear failure history
              delete failureHistory[id];
              // Restart with original interval
              startJob(id, url, originalInterval, 'active');
            }
          );
        } else {
          // Normal success update - check if we need to send recovery email
          let emailSentAt = null;
          let lastEmailType = null;

          // If we had sent a failure email previously, send recovery email
          if (job.last_email_type === 'failure' && job.email_sent_at) {
            console.log(`✅ Job ${id} recovered in normal mode! Sending recovery email...`);

            // Calculate downtime duration
            let downtimeDuration = 'Unknown';
            if (job.failure_started_at) {
              const failureStart = new Date(job.failure_started_at);
              const recoveryTime = new Date(now);
              const durationMs = recoveryTime - failureStart;
              const minutes = Math.floor(durationMs / 60000);
              const seconds = Math.floor((durationMs % 60000) / 1000);

              if (minutes > 0) {
                downtimeDuration = `${minutes} minute${minutes > 1 ? 's' : ''} ${seconds} second${seconds > 1 ? 's' : ''}`;
              } else {
                downtimeDuration = `${seconds} second${seconds > 1 ? 's' : ''}`;
              }
            }

            if (job.alert_email) {
              const emailSent = await sendRecoveryNotification(job, downtimeDuration);
              if (emailSent) {
                emailSentAt = now;
                lastEmailType = 'recovery';
                console.log(`📧 ✅ Recovery email sent for job ${id}`);
              }
            }
          }

          db.run(
            `UPDATE jobs SET
              last_run = ?,
              last_duration = ?,
              last_result = ?,
              failure_count = 0,
              failure_cycles = 0,
              failure_started_at = NULL,
              email_sent_at = ?,
              last_email_type = ?
            WHERE id = ?`,
            [now, duration, result, emailSentAt, lastEmailType, id]
          );
          // Clear failure history on success
          delete failureHistory[id];
        }
      });

    } catch (error) {
      const duration = Date.now() - start;
      const result = `Error: ${error.message}`;
      console.error(`[${now}] ❌ ${result} (${duration}ms)`);

      // Get current job state to handle failure
      db.get("SELECT * FROM jobs WHERE id = ?", [id], async (err, job) => {
        if (err || !job) {
          // If we can't get job data, just update the basic fields
          db.run(
            "UPDATE jobs SET last_run = ?, last_duration = ?, last_result = ? WHERE id = ?",
            [now, duration, result, id]
          );
          return;
        }

        const newFailureCount = (job.failure_count || 0) + 1;

        // Store failure in history for email
        if (!failureHistory[id]) {
          failureHistory[id] = [];
        }
        failureHistory[id].push({
          time: now,
          result: result,
          duration: duration
        });
        // Keep only last 5 failures
        if (failureHistory[id].length > 5) {
          failureHistory[id].shift();
        }

        console.log(`⚠️  Job ${id} failure count: ${newFailureCount}`);

        // STATE MACHINE LOGIC
        if (job.failure_state === 'normal' && newFailureCount === 1) {
          // TRANSITION: normal -> rapid_check
          console.log(`🔄 Job ${id}: First failure detected. Switching to rapid check (15s interval)`);

          db.run(
            `UPDATE jobs SET
              last_run = ?,
              last_duration = ?,
              last_result = ?,
              failure_count = ?,
              failure_state = 'rapid_check',
              original_interval = ?,
              interval = ?,
              failure_started_at = ?
            WHERE id = ?`,
            [now, duration, result, newFailureCount, job.interval, RAPID_CHECK_INTERVAL, now, id],
            () => {
              // Restart with rapid check interval
              startJob(id, url, RAPID_CHECK_INTERVAL, 'active');
            }
          );

        } else if (job.failure_state === 'rapid_check' && newFailureCount >= FAILURE_THRESHOLD) {
          // TRANSITION: rapid_check -> paused (after 3rd failure)
          const currentCycles = job.failure_cycles || 0;
          console.log(`🚨 Job ${id}: ${FAILURE_THRESHOLD} consecutive failures! (Cycle ${currentCycles + 1}/${MAX_FAILURE_CYCLES})`);

          // Check if we've exceeded max failure cycles
          if (currentCycles >= MAX_FAILURE_CYCLES) {
            // PERMANENTLY PAUSE - Too many failure cycles
            console.log(`🛑 Job ${id}: Exceeded ${MAX_FAILURE_CYCLES} failure cycles. PERMANENTLY PAUSING.`);

            // Send Windows toast notification
            notifier.notify({
              title: 'AutoPing - Site Permanently Paused',
              message: `${url} has failed ${MAX_FAILURE_CYCLES} cycles and requires manual intervention.`,
              sound: true,
              wait: false
            }, (err, response) => {
              if (err) {
                console.error('❌ Toast notification error:', err);
              } else {
                console.log('✅ Toast notification sent:', response);
              }
            });

            db.run(
              `UPDATE jobs SET
                last_run = ?,
                last_duration = ?,
                last_result = ?,
                failure_count = ?,
                failure_state = 'permanently_paused',
                permanently_paused = 1,
                status = 'stopped'
              WHERE id = ?`,
              [now, duration, result, newFailureCount, id],
              () => {
                // Stop the current task
                if (activeTasks[id]) {
                  activeTasks[id].stop();
                  delete activeTasks[id];
                }
                console.log(`🛑 Job ${id} permanently paused. Manual reset required.`);
              }
            );
            return;
          }

          // Normal pause cycle
          console.log(`📧 Sending email and pausing for 5 minutes...`);
          const pauseUntil = new Date(Date.now() + PAUSE_DURATION_MS).toISOString();
          const originalInterval = job.original_interval || job.interval;

          // Check if we can send email (rate limiting) - use job-specific rate limit
          const jobRateLimit = job.email_rate_limit || EMAIL_RATE_LIMIT_MINUTES;
          const canSend = canSendEmail(job.last_email_sent, jobRateLimit);
          let emailSent = false;
          let lastEmailSent = job.last_email_sent;
          let emailSentAt = null;
          let lastEmailType = null;

          console.log(`📧 Email check for job ${id}: canSend=${canSend}, alert_email=${job.alert_email}, last_email_sent=${job.last_email_sent}, rate_limit=${jobRateLimit} minutes`);

          if (canSend && job.alert_email) {
            // Send email notification
            console.log(`📧 Calling sendFailureNotification for job ${id}...`);
            emailSent = await sendFailureNotification(job, failureHistory[id] || []);
            console.log(`📧 sendFailureNotification returned: ${emailSent}`);
            if (emailSent) {
              lastEmailSent = now;
              emailSentAt = now;
              lastEmailType = 'failure';
              console.log(`📧 ✅ Setting email_sent_at=${emailSentAt}, last_email_type=${lastEmailType} for job ${id}`);

              // Send Windows toast notification
              notifier.notify({
                title: 'AutoPing - Site Down Alert',
                message: `${url} has failed ${FAILURE_THRESHOLD} times. Email alert sent to ${job.alert_email}`,
                sound: true,
                wait: false
              }, (err, response) => {
                if (err) {
                  console.error('❌ Toast notification error:', err);
                } else {
                  console.log('✅ Toast notification sent:', response);
                }
              });
            } else {
              console.error(`📧 ❌ Email sending FAILED for job ${id}`);
            }
          } else if (!job.alert_email) {
            console.warn(`⚠️  No alert email configured for job ${id}. Skipping email notification.`);
          } else {
            console.warn(`⚠️  Email rate limit active for job ${id}. Skipping email notification.`);
          }

          // Update to paused state
          console.log(`💾 Updating job ${id} to paused state with email_sent_at=${emailSentAt}, last_email_type=${lastEmailType}`);
          db.run(
            `UPDATE jobs SET
              last_run = ?,
              last_duration = ?,
              last_result = ?,
              failure_count = ?,
              failure_state = 'paused',
              pause_until = ?,
              last_email_sent = ?,
              email_sent_at = ?,
              last_email_type = ?
            WHERE id = ?`,
            [now, duration, result, newFailureCount, pauseUntil, lastEmailSent, emailSentAt, lastEmailType, id],
            (err) => {
              if (err) {
                console.error(`❌ Database update error for job ${id}:`, err.message);
              } else {
                console.log(`✅ Database updated successfully for job ${id}`);
              }

              // Stop the current task
              if (activeTasks[id]) {
                activeTasks[id].stop();
                delete activeTasks[id];
              }

              // Schedule resume after 5 minutes
              console.log(`⏸️  Job ${id} paused for 5 minutes. Will resume at ${new Date(pauseUntil).toLocaleTimeString()}`);
              pauseTimeouts[id] = setTimeout(() => resumeJob(id), PAUSE_DURATION_MS);
            }
          );

        } else {
          // Still in rapid_check, but not at threshold yet
          db.run(
            `UPDATE jobs SET
              last_run = ?,
              last_duration = ?,
              last_result = ?,
              failure_count = ?
            WHERE id = ?`,
            [now, duration, result, newFailureCount, id]
          );
        }
      });
    }
  });

  activeTasks[id] = task;
};

// Note: Job loading is now done inside db.serialize() in database setup above

// API Endpoints

// GET /api/jobs - List all jobs
app.get('/api/jobs', (req, res) => {
  db.all("SELECT * FROM jobs ORDER BY created_at DESC", [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    // Calculate next_run for each job
    const jobsWithNextRun = rows.map(job => {
      if (job.status === 'stopped') {
        return { ...job, next_run: null };
      }
      try {
        const now = new Date();
        const interval = parseExpression(getCronExpression(job.interval), {
          currentDate: now
        });

        let next = interval.next().toDate();

        // If next is too close to now (within 1 second), get the one after
        if (next - now < 1000) {
          next = interval.next().toDate();
        }

        return { ...job, next_run: next };
      } catch (e) {
        console.error(`Error parsing cron for job ${job.id}:`, e.message);
        return { ...job, next_run: null };
      }
    });

    res.json(jobsWithNextRun);
  });
});

// POST /api/jobs - Create a new job
app.post('/api/jobs', async (req, res) => {
  const { url, interval, alert_email, email_rate_limit } = req.body;
  if (!url || !interval) {
    return res.status(400).json({ error: "URL and interval are required" });
  }

  const rateLimit = email_rate_limit || 30; // Default to 30 minutes

  const sql = "INSERT INTO jobs (url, interval, alert_email, email_rate_limit) VALUES (?, ?, ?, ?)";
  db.run(sql, [url, interval, alert_email || null, rateLimit], async function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const id = this.lastID;

    // Perform immediate ping before starting the scheduled job
    console.log(`🚀 New job ${id} created. Performing immediate first ping...`);
    await performSinglePing(id, url);

    // Now start the scheduled job
    startJob(id, url, interval, 'active');

    res.json({
      id,
      url,
      interval,
      alert_email,
      email_rate_limit: rateLimit,
      status: 'active',
      last_run: null,
      last_duration: null,
      last_result: null
    });
  });
});

// PATCH /api/jobs/:id/toggle - Toggle job status
app.patch('/api/jobs/:id/toggle', (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM jobs WHERE id = ?", [id], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ error: "Job not found" });
    }

    const newStatus = row.status === 'active' ? 'stopped' : 'active';

    db.run("UPDATE jobs SET status = ? WHERE id = ?", [newStatus, id], (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Update the running task
      startJob(id, row.url, row.interval, newStatus);

      res.json({ ...row, status: newStatus });
    });
  });
});

// PATCH /api/jobs/:id/reset - Reset permanently paused job
app.patch('/api/jobs/:id/reset', (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM jobs WHERE id = ?", [id], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ error: "Job not found" });
    }

    if (!row.permanently_paused) {
      return res.status(400).json({ error: "Job is not permanently paused" });
    }

    console.log(`🔄 Manually resetting permanently paused job ${id}`);

    // Reset all failure-related fields
    db.run(
      `UPDATE jobs SET
        status = 'active',
        failure_count = 0,
        failure_cycles = 0,
        failure_state = 'normal',
        permanently_paused = 0,
        pause_until = NULL,
        failure_started_at = NULL
      WHERE id = ?`,
      [id],
      (err) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        // Clear failure history
        delete failureHistory[id];

        // Restart the job
        startJob(id, row.url, row.interval, 'active');

        res.json({ message: "Job reset and resumed", id });
      }
    );
  });
});

// PATCH /api/jobs/:id/email - Update alert email
app.patch('/api/jobs/:id/email', (req, res) => {
  const id = req.params.id;
  const { alert_email } = req.body;

  db.run("UPDATE jobs SET alert_email = ? WHERE id = ?", [alert_email || null, id], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Job not found" });
    }
    res.json({ message: "Alert email updated", id, alert_email });
  });
});

// DELETE /api/jobs/:id - Delete a job
app.delete('/api/jobs/:id', (req, res) => {
  const id = req.params.id;

  // Stop the cron task if it exists
  if (activeTasks[id]) {
    activeTasks[id].stop();
    delete activeTasks[id];
  }

  // Clear pause timeout if it exists
  if (pauseTimeouts[id]) {
    clearTimeout(pauseTimeouts[id]);
    delete pauseTimeouts[id];
  }

  // Clear failure history
  delete failureHistory[id];

  db.run("DELETE FROM jobs WHERE id = ?", id, function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: "Job deleted", id });
  });
});

// Serve index.html for SPA routing in production
if (process.env.SERVE_STATIC) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(process.env.SERVE_STATIC, 'index.html'));
  });
}

// Start server function for Electron integration
function startServer() {
  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  return server;
}

// If run directly (not required by Electron), start the server
if (require.main === module) {
  startServer();
}

module.exports = startServer;
