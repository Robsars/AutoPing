const nodemailer = require('nodemailer');
require('dotenv').config();

// Create reusable transporter
let transporter = null;

const initializeTransporter = () => {
  if (!transporter) {
    const config = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    };

    // Only create transporter if credentials are configured
    if (config.auth.user && config.auth.pass) {
      transporter = nodemailer.createTransport(config);
      console.log('Email transporter initialized');
    } else {
      console.warn('Email credentials not configured. Email notifications will be disabled.');
    }
  }
  return transporter;
};

/**
 * Send email notification for ping failure
 * @param {Object} job - Job details
 * @param {Array} failureHistory - Array of failure timestamps and messages
 * @returns {Promise<boolean>} - Success status
 */
const sendFailureNotification = async (job, failureHistory = []) => {
  console.log(`📧 Attempting to send failure notification for job ${job.id} to ${job.alert_email}`);

  const emailTransporter = initializeTransporter();

  if (!emailTransporter) {
    console.warn(`❌ Email not configured. Skipping notification for job ${job.id}`);
    return false;
  }

  if (!job.alert_email) {
    console.warn(`❌ No alert email configured for job ${job.id}. Skipping notification.`);
    return false;
  }

  console.log(`✓ Email transporter ready, sending to ${job.alert_email}...`);

  try {
    const failureList = failureHistory.length > 0
      ? failureHistory.map((f, i) => `  ${i + 1}. ${f.time} - ${f.result}`).join('\n')
      : 'No detailed failure history available';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 10px 10px 0 0;
            text-align: center;
          }
          .header h1 {
            margin: 0;
            font-size: 28px;
          }
          .content {
            background: #f8f9fa;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          .alert-box {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
          }
          .info-grid {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
          }
          .info-row {
            display: flex;
            padding: 10px 0;
            border-bottom: 1px solid #eee;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            font-weight: bold;
            width: 150px;
            color: #666;
          }
          .info-value {
            flex: 1;
            color: #333;
          }
          .failure-log {
            background: #fff;
            padding: 15px;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            overflow-x: auto;
            white-space: pre-wrap;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            color: #666;
            font-size: 12px;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
          }
          .status-badge {
            display: inline-block;
            padding: 4px 12px;
            background: #dc3545;
            color: white;
            border-radius: 20px;
            font-size: 14px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>⚠️ AutoPing Alert</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">Domain Unreachable</p>
        </div>
        <div class="content">
          <div class="alert-box">
            <strong>🚨 Alert:</strong> Your monitored domain has failed to respond after 3 consecutive ping attempts.
          </div>

          <div class="info-grid">
            <div class="info-row">
              <span class="info-label">Domain:</span>
              <span class="info-value"><strong>${job.url}</strong></span>
            </div>
            <div class="info-row">
              <span class="info-label">Status:</span>
              <span class="info-value"><span class="status-badge">OFFLINE</span></span>
            </div>
            <div class="info-row">
              <span class="info-label">Check Interval:</span>
              <span class="info-value">${job.interval}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Failure Count:</span>
              <span class="info-value">${job.failure_count} consecutive failures</span>
            </div>
            <div class="info-row">
              <span class="info-label">Last Checked:</span>
              <span class="info-value">${new Date(job.last_run).toLocaleString()}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Last Result:</span>
              <span class="info-value">${job.last_result || 'N/A'}</span>
            </div>
          </div>

          <h3 style="color: #333; margin-top: 25px;">Failure History:</h3>
          <div class="failure-log">${failureList}</div>

          <div class="alert-box" style="background: #d1ecf1; border-left-color: #0c5460;">
            <strong>📋 Next Steps:</strong>
            <ul style="margin: 10px 0 0 0; padding-left: 20px;">
              <li>AutoPing will pause monitoring for 5 minutes</li>
              <li>After 5 minutes, normal ping interval will resume</li>
              <li>You will be notified again only if the issue persists</li>
            </ul>
          </div>
        </div>
        <div class="footer">
          <p>This is an automated notification from AutoPing.</p>
          <p>Monitoring Job ID: ${job.id} | Generated at ${new Date().toLocaleString()}</p>
        </div>
      </body>
      </html>
    `;

    const textContent = `
AutoPing Alert - Domain Unreachable
====================================

Your monitored domain has failed to respond after 3 consecutive ping attempts.

Domain: ${job.url}
Status: OFFLINE
Check Interval: ${job.interval}
Failure Count: ${job.failure_count} consecutive failures
Last Checked: ${new Date(job.last_run).toLocaleString()}
Last Result: ${job.last_result || 'N/A'}

Failure History:
${failureList}

Next Steps:
- AutoPing will pause monitoring for 5 minutes
- After 5 minutes, normal ping interval will resume
- You will be notified again only if the issue persists

---
This is an automated notification from AutoPing.
Monitoring Job ID: ${job.id} | Generated at ${new Date().toLocaleString()}
    `;

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: job.alert_email,
      subject: `🚨 AutoPing Alert: ${job.url} is DOWN`,
      text: textContent,
      html: htmlContent,
    };

    console.log(`📨 Sending email with config: From: ${mailOptions.from}, To: ${mailOptions.to}, Subject: ${mailOptions.subject}`);
    await emailTransporter.sendMail(mailOptions);
    console.log(`✅ ✅ ✅ FAILURE EMAIL SENT SUCCESSFULLY to ${job.alert_email} for job ${job.id} ✅ ✅ ✅`);
    return true;
  } catch (error) {
    console.error(`❌ Error sending email for job ${job.id}:`, error.message);
    return false;
  }
};

/**
 * Send email notification for domain recovery
 * @param {Object} job - Job details
 * @param {string} downtimeDuration - Human-readable downtime duration
 * @returns {Promise<boolean>} - Success status
 */
const sendRecoveryNotification = async (job, downtimeDuration = 'Unknown') => {
  console.log(`📧 Attempting to send recovery notification for job ${job.id} to ${job.alert_email}`);

  const emailTransporter = initializeTransporter();

  if (!emailTransporter) {
    console.warn(`❌ Email not configured. Skipping recovery notification for job ${job.id}`);
    return false;
  }

  if (!job.alert_email) {
    console.warn(`❌ No alert email configured for job ${job.id}. Skipping recovery notification.`);
    return false;
  }

  console.log(`✓ Email transporter ready for recovery, sending to ${job.alert_email}...`);

  try {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
            color: white;
            padding: 30px;
            border-radius: 10px 10px 0 0;
            text-align: center;
          }
          .header h1 {
            margin: 0;
            font-size: 28px;
          }
          .content {
            background: #f8f9fa;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          .alert-box {
            background: #d1f4e0;
            border-left: 4px solid #22c55e;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
          }
          .info-grid {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
          }
          .info-row {
            display: flex;
            padding: 10px 0;
            border-bottom: 1px solid #eee;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            font-weight: bold;
            width: 150px;
            color: #666;
          }
          .info-value {
            flex: 1;
            color: #333;
          }
          .footer {
            text-align: center;
            color: #666;
            font-size: 12px;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
          }
          .status-badge {
            display: inline-block;
            padding: 4px 12px;
            background: #22c55e;
            color: white;
            border-radius: 20px;
            font-size: 14px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>✅ AutoPing Recovery</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">Domain Back Online</p>
        </div>
        <div class="content">
          <div class="alert-box">
            <strong>🎉 Good News:</strong> Your monitored domain is now responding successfully!
          </div>

          <div class="info-grid">
            <div class="info-row">
              <span class="info-label">Domain:</span>
              <span class="info-value"><strong>${job.url}</strong></span>
            </div>
            <div class="info-row">
              <span class="info-label">Status:</span>
              <span class="info-value"><span class="status-badge">ONLINE</span></span>
            </div>
            <div class="info-row">
              <span class="info-label">Downtime Duration:</span>
              <span class="info-value">${downtimeDuration}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Recovery Time:</span>
              <span class="info-value">${new Date().toLocaleString()}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Check Interval:</span>
              <span class="info-value">${job.interval}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Last Result:</span>
              <span class="info-value">${job.last_result || 'Success'}</span>
            </div>
          </div>

          <div class="alert-box" style="background: #e0f2fe; border-left-color: #0ea5e9;">
            <strong>📋 Status:</strong>
            <ul style="margin: 10px 0 0 0; padding-left: 20px;">
              <li>Domain is responding normally</li>
              <li>AutoPing has resumed normal monitoring at ${job.interval} intervals</li>
              <li>You will be notified if the issue occurs again</li>
            </ul>
          </div>
        </div>
        <div class="footer">
          <p>This is an automated notification from AutoPing.</p>
          <p>Monitoring Job ID: ${job.id} | Generated at ${new Date().toLocaleString()}</p>
        </div>
      </body>
      </html>
    `;

    const textContent = `
AutoPing Recovery - Domain Back Online
======================================

Good News! Your monitored domain is now responding successfully!

Domain: ${job.url}
Status: ONLINE
Downtime Duration: ${downtimeDuration}
Recovery Time: ${new Date().toLocaleString()}
Check Interval: ${job.interval}
Last Result: ${job.last_result || 'Success'}

Status:
- Domain is responding normally
- AutoPing has resumed normal monitoring at ${job.interval} intervals
- You will be notified if the issue occurs again

---
This is an automated notification from AutoPing.
Monitoring Job ID: ${job.id} | Generated at ${new Date().toLocaleString()}
    `;

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: job.alert_email,
      subject: `✅ AutoPing Recovery: ${job.url} is BACK ONLINE`,
      text: textContent,
      html: htmlContent,
    };

    console.log(`📨 Sending recovery email with config: From: ${mailOptions.from}, To: ${mailOptions.to}, Subject: ${mailOptions.subject}`);
    await emailTransporter.sendMail(mailOptions);
    console.log(`✅ ✅ ✅ RECOVERY EMAIL SENT SUCCESSFULLY to ${job.alert_email} for job ${job.id} ✅ ✅ ✅`);
    return true;
  } catch (error) {
    console.error(`❌ Error sending recovery email for job ${job.id}:`, error.message);
    return false;
  }
};

/**
 * Check if enough time has passed since last email (rate limiting)
 * @param {string} lastEmailSent - ISO timestamp of last email
 * @param {number} rateLimitMinutes - Minimum minutes between emails
 * @returns {boolean} - True if email can be sent
 */
const canSendEmail = (lastEmailSent, rateLimitMinutes = 60) => {
  if (!lastEmailSent) return true;

  const lastSent = new Date(lastEmailSent);
  const now = new Date();
  const minutesSinceLastEmail = (now - lastSent) / 1000 / 60;

  return minutesSinceLastEmail >= rateLimitMinutes;
};

module.exports = {
  sendFailureNotification,
  sendRecoveryNotification,
  canSendEmail,
  initializeTransporter,
};
