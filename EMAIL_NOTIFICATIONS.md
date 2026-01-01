# Email Notifications - AutoPing

AutoPing now includes intelligent email notifications for domain downtime monitoring with smart failure detection and recovery logic.

## Features

### Intelligent Failure Detection

AutoPing uses a **3-state system** to monitor your domains intelligently:

1. **Normal State** - Regular monitoring at your configured interval
2. **Rapid Check State** - After first failure, switches to 15-second intervals to quickly verify if the issue persists
3. **Paused State** - After 3 consecutive failures, sends email notification + Windows toast notification and pauses for 5 minutes

### Recovery Notifications

AutoPing automatically sends **recovery email notifications** when your domain comes back online:
- Sends immediately when domain recovers (whether during rapid check or after pause)
- Includes downtime duration and recovery time
- Provides reassurance that monitoring has resumed normally

### State Transitions

```
NORMAL STATE (e.g., 5 min interval)
    ↓ (First failure detected)
RAPID CHECK STATE (15 sec interval)
    ↓ (Success) → Returns to NORMAL STATE
    ↓ (3rd consecutive failure)
PAUSED STATE (5 min pause)
    ↓ (After 5 minutes)
NORMAL STATE (Resume original interval)
```

### Key Benefits

- **Quick Verification**: Rapidly checks if a failure is temporary or persistent
- **Smart Recovery**: Automatically returns to normal operation if domain recovers, with recovery email notification
- **Per-Job Email Rate Limiting**: Configure rate limits per job (5, 15, 30, or 60 minutes) to prevent spam
- **Desktop Notifications**: Windows toast notifications alert you immediately when emails are sent
- **Detailed Notifications**: Emails include failure history, timestamps, and recovery information
- **Pause After Alert**: 5-minute pause prevents continuous pinging of a down server
- **Automatic Safeguards**: Permanent pause after 5 failure cycles prevents endless monitoring of dead domains
- **Persistent Alert Badges**: Alert badges remain visible until domain actually recovers, not just when monitoring resumes

## Setup Guide

### 1. Configure SMTP Settings

Edit the `.env` file in the `server` directory:

```env
# Gmail Example
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Email Settings
EMAIL_FROM=AutoPing <your-email@gmail.com>
EMAIL_RATE_LIMIT_MINUTES=60
```

#### Gmail Setup (Recommended for Testing)

1. Go to your Google Account settings
2. Navigate to Security → 2-Step Verification
3. Scroll down to "App passwords"
4. Generate a new app password for "Mail"
5. Use this 16-character password as `SMTP_PASS`

#### Other SMTP Providers

**Outlook/Office 365:**
```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
```

**Yahoo Mail:**
```env
SMTP_HOST=smtp.mail.yahoo.com
SMTP_PORT=587
SMTP_SECURE=false
```

**SendGrid:**
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
```

### 2. Add Alert Email to Your Jobs

When creating a new monitoring job:

1. Enter the domain URL (e.g., `example.com`)
2. **Enter your alert email address** (e.g., `alerts@yourdomain.com`)
3. **Select email rate limit** from the dropdown:
   - 5 minutes
   - 15 minutes
   - 30 minutes (recommended)
   - 60 minutes
4. Select the ping interval
5. Click "Start Pinging"

The email icon (📧) will appear next to jobs with configured alert emails.

### 3. Understanding the UI Indicators

- **📧 Badge**: Email notifications are enabled for this job
- **📩 Alert Sent Badge**: Failure alert email has been sent (persists until recovery)
- **✅ Recovery Sent Badge**: Recovery email has been sent
- **Next alert: Xm Ys**: Countdown timer showing when next failure email can be sent (based on rate limit)
- **⚠️ X failures**: Shows current consecutive failure count
- **RAPID CHECK Badge**: Job is in rapid verification mode (15s intervals)
- **PAUSED Badge**: Job is in 5-minute pause after sending alert
- **⛔ Requires Manual Reset Badge**: Job permanently paused after 5 failure cycles

## Email Notification Details

### What You'll Receive

**Failure Alert Email** - When a domain fails 3 consecutive pings:

- **Alert Summary**: Clear notification of the issue
- **Domain Details**: URL, status, and check interval
- **Failure Count**: Number of consecutive failures
- **Failure History**: Timestamped log of recent failures
- **Next Steps**: What AutoPing will do next
- **Windows Toast Notification**: Desktop notification appears immediately

**Recovery Email** - When your domain comes back online:

- **Recovery Summary**: Notification that domain is responding
- **Downtime Duration**: How long the domain was offline
- **Recovery Time**: When domain came back online
- **Status Update**: Confirmation that normal monitoring has resumed

### Sample Email Content

```
🚨 AutoPing Alert: example.com is DOWN

Your monitored domain has failed to respond after 3 consecutive ping attempts.

Domain: https://example.com
Status: OFFLINE
Failure Count: 3 consecutive failures
Last Checked: 11/26/2025, 2:30:15 PM

Failure History:
  1. 2025-11-26T14:30:00Z - Error: connect ECONNREFUSED
  2. 2025-11-26T14:30:15Z - Error: connect ECONNREFUSED
  3. 2025-11-26T14:30:30Z - Error: connect ECONNREFUSED

Next Steps:
- AutoPing will pause monitoring for 5 minutes
- After 5 minutes, normal ping interval will resume
- You will be notified again only if the issue persists
```

## Edge Cases Handled

### 1. Recovery During Rapid Check
- If domain responds successfully during rapid check phase
- System immediately returns to normal interval
- Failure count resets to 0
- No email is sent (transient issue detected)

### 2. Server Restart During Failure State
- Job state persists in database
- On restart, system checks pause status
- If pause period remaining, schedules resume
- If pause period over, resumes immediately

### 3. Email Rate Limiting
- Multiple failure cycles within rate limit window
- Second failure won't send email within 60 minutes
- Console logs indicate "Email rate limit active"
- Pause and recovery logic still executes normally

### 4. Missing Email Configuration
- Job without alert email will monitor normally
- State transitions work (rapid check → pause → resume)
- Console logs indicate "No alert email configured"
- No email sent, but system continues monitoring

### 5. Email Sending Failure
- SMTP errors are caught and logged
- Job continues with pause logic regardless
- System doesn't block on email failures

### 6. Repeated Failures
- If domain fails again after resume
- Enters rapid check again
- Will send new email only after rate limit expires
- Prevents email spam for prolonged outages

### 7. Permanent Pause
- After 5 failure cycles (each cycle = 3 failures + pause + resume)
- Job is automatically permanently paused
- Status set to "stopped" with `permanently_paused` flag
- Windows toast notification sent
- UI shows "⛔ Requires Manual Reset" badge
- Manual reset button appears instead of pause/resume
- Prevents endless monitoring of dead domains

## API Endpoints

### Create Job with Email Alert
```bash
POST /api/jobs
Content-Type: application/json

{
  "url": "https://example.com",
  "interval": "5 minutes",
  "alert_email": "alerts@yourdomain.com",
  "email_rate_limit": 30
}
```

### Update Alert Email for Existing Job
```bash
PATCH /api/jobs/:id/email
Content-Type: application/json

{
  "alert_email": "newemail@yourdomain.com"
}
```

### Get All Jobs (includes failure states)
```bash
GET /api/jobs

Response includes:
- failure_count: Current consecutive failures
- failure_state: "normal" | "rapid_check" | "paused" | "permanently_paused"
- pause_until: ISO timestamp when pause ends
- last_email_sent: ISO timestamp of last alert
- email_sent_at: ISO timestamp when last email was sent
- last_email_type: "failure" | "recovery"
- alert_email: Configured notification email
- email_rate_limit: Minutes between emails for this job
- failure_cycles: Number of failure cycles completed
- permanently_paused: 1 if permanently paused, 0 otherwise
```

## Database Schema

New fields added to `jobs` table:

```sql
failure_count INTEGER DEFAULT 0
original_interval TEXT
failure_state TEXT DEFAULT 'normal'
pause_until DATETIME
last_email_sent DATETIME
alert_email TEXT
failure_started_at DATETIME
last_email_type TEXT
email_sent_at DATETIME
email_rate_limit INTEGER DEFAULT 30
failure_cycles INTEGER DEFAULT 0
permanently_paused INTEGER DEFAULT 0
```

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | `false` | Use SSL/TLS |
| `SMTP_USER` | - | SMTP username/email |
| `SMTP_PASS` | - | SMTP password/app password |
| `EMAIL_FROM` | `SMTP_USER` | From email address |
| `EMAIL_RATE_LIMIT_MINUTES` | `60` | Min minutes between emails |

### Code Constants

In `server.js`, you can modify:

```javascript
const RAPID_CHECK_INTERVAL = '15 seconds';  // Interval for rapid verification
const PAUSE_DURATION_MS = 5 * 60 * 1000;    // 5 minutes pause
const FAILURE_THRESHOLD = 3;                 // Failures before email
const MAX_FAILURE_CYCLES = 5;               // Cycles before permanent pause
const EMAIL_RATE_LIMIT_MINUTES = 60;        // Global default email rate limit
```

**Note:** Email rate limits are now configurable per-job (5, 15, 30, or 60 minutes) through the UI dropdown.

## Troubleshooting

### Email Not Sending

1. **Check SMTP credentials**: Verify `.env` file has correct settings
2. **Check console logs**: Look for email-related errors
3. **Verify alert email**: Ensure job has `alert_email` configured
4. **Test SMTP connection**: Use Gmail app password, not regular password
5. **Check rate limiting**: May be within 60-minute window

### Jobs Stuck in Paused State

1. **Check `pause_until` timestamp**: Should auto-resume after 5 minutes
2. **Restart server**: Will recalculate pause time on startup
3. **Check console**: Look for resume messages

### Not Receiving Alerts

1. **Check spam folder**: Alerts may be filtered
2. **Verify email address**: Check for typos in alert email
3. **Check failure count**: Must reach 3 failures to trigger
4. **Rate limiting**: Check `last_email_sent` timestamp

### Permanently Paused Jobs

1. **Check failure cycles**: View `failure_cycles` field in database
2. **Manual reset**: Click "Reset & Resume" button in UI
3. **Verify domain**: Ensure domain is actually working before resetting
4. **API reset**: Use `PATCH /api/jobs/:id/reset` endpoint

## Testing

### Simulate Failure

1. Add a job with a non-existent domain: `http://this-domain-does-not-exist-12345.com`
2. Set interval to "30 seconds" for faster testing
3. Add your email address
4. Watch console logs for state transitions:
   - First failure: Switches to rapid check (15s)
   - After 3 failures: Sends email and pauses
   - After 5 minutes: Resumes normal interval

### Simulate Recovery

1. Add a job with interval "30 seconds"
2. After first failure (rapid check active)
3. Manually fix the issue or use a working domain
4. System detects success and returns to normal state

## Security Best Practices

1. **Never commit `.env` file** - Contains sensitive credentials
2. **Use app passwords** - Don't use your main email password
3. **Limit SMTP permissions** - Use dedicated email account for alerts
4. **Rotate credentials** - Change SMTP passwords periodically
5. **Monitor email usage** - Watch for unusual sending patterns

## Future Enhancements

Potential improvements for future versions:

- [ ] Multiple alert emails per job
- [ ] Custom email templates
- [ ] Slack/Discord/SMS notifications
- [ ] Configurable failure threshold per job
- [ ] Escalation policies (different alerts at different failure counts)
- [ ] Weekly/monthly summary reports
- [ ] Webhook support for custom integrations
- [ ] Mobile app notifications

---

**AutoPing** - Intelligent domain monitoring with smart failure detection
