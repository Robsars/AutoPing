import { useState, useEffect } from 'react'

const API_URL = 'http://localhost:3001/api/jobs';

const INTERVAL_OPTIONS = [
  '30 seconds',
  '1 minute',
  '5 minutes',
  '30 minutes',
  '1 hour',
  'Custom'
];

function App() {
  const [jobs, setJobs] = useState([]);
  const [url, setUrl] = useState('');
  const [interval, setInterval] = useState('1 minute');
  const [alertEmail, setAlertEmail] = useState('');
  const [emailRateLimit, setEmailRateLimit] = useState('30');
  const [loading, setLoading] = useState(false);

  const fetchJobs = async () => {
    try {
      // Add cache-busting timestamp to prevent browser caching
      const timestamp = new Date().getTime();
      const response = await fetch(`${API_URL}?t=${timestamp}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      const data = await response.json();
      console.log('API returned jobs:', data.map(j => ({
        id: j.id,
        next_run: j.next_run
      })));
      setJobs(data);
    } catch (error) {
      console.error('Error fetching jobs:', error);
    }
  };

  useEffect(() => {
    console.log('[POLLING] Setting up polling with setTimeout');

    let pollCount = 0;
    let isActive = true;

    const pollData = async () => {
      if (!isActive) return;

      pollCount++;
      console.log(`[POLLING] Fetch #${pollCount} starting`);
      await fetchJobs();
      console.log(`[POLLING] Fetch #${pollCount} completed`);

      if (isActive) {
        setTimeout(pollData, 2000);
      }
    };

    // Start polling
    pollData();

    return () => {
      console.log('[POLLING] Cleanup - stopping polling');
      isActive = false;
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url) return;

    // Auto-HTTPS
    let finalUrl = url;
    if (!/^https?:\/\//i.test(url)) {
      finalUrl = `https://${url}`;
    }

    setLoading(true);
    try {
      await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: finalUrl,
          interval,
          alert_email: alertEmail,
          email_rate_limit: parseInt(emailRateLimit)
        }),
      });
      setUrl('');
      setAlertEmail('');
      setEmailRateLimit('30');
      fetchJobs();
    } catch (error) {
      console.error('Error creating job:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
      fetchJobs();
    } catch (error) {
      console.error('Error deleting job:', error);
    }
  };

  const handleToggle = async (id) => {
    try {
      await fetch(`${API_URL}/${id}/toggle`, { method: 'PATCH' });
      fetchJobs();
    } catch (error) {
      console.error('Error toggling job:', error);
    }
  };

  const handleReset = async (id) => {
    if (!window.confirm('Are you sure you want to reset and resume this permanently paused job?')) {
      return;
    }
    try {
      await fetch(`${API_URL}/${id}/reset`, { method: 'PATCH' });
      fetchJobs();
    } catch (error) {
      console.error('Error resetting job:', error);
    }
  };

  const formatLastRun = (job) => {
    if (!job.last_run) return 'Never';

    const date = new Date(job.last_run);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    let timeStr = '';
    if (diffMins < 1) timeStr = 'Just now';
    else if (diffMins === 1) timeStr = '1 min ago';
    else timeStr = `${diffMins} mins ago`;

    // Status Badge
    let statusBadge = null;
    if (job.last_result) {
      const isSuccess = job.last_result.startsWith('Success');
      const badgeClass = isSuccess ? 'badge-success' : 'badge-error';
      const shortResult = isSuccess ? '200 OK' : 'Error';

      statusBadge = (
        <span className={`status-badge ${badgeClass}`}>
          {shortResult} • {job.last_duration}ms
        </span>
      );
    }

    return (
      <span className="last-run-wrapper">
        {timeStr} {statusBadge}
      </span>
    );
  };



  return (
    <div className="dashboard">
      <h1>AutoPing</h1>
      <p className="subtitle">Schedule automated HTTP pings</p>

      <form className="add-job-form" onSubmit={handleSubmit}>
        <div className="input-group">
          <input
            type="text"
            placeholder="example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </div>

        <div className="input-group">
          <input
            type="email"
            placeholder="Alert Email (optional)"
            value={alertEmail}
            onChange={(e) => setAlertEmail(e.target.value)}
          />
        </div>

        <div className="input-group">
          <label className="input-label">Email Rate Limit (prevents duplicate alerts)</label>
          <select
            value={emailRateLimit}
            onChange={(e) => setEmailRateLimit(e.target.value)}
            title="Minimum time between failure emails for the same job"
          >
            <option value="5">5 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes (recommended)</option>
            <option value="60">60 minutes</option>
          </select>
        </div>

        <div className="interval-selector">
          {INTERVAL_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`btn-interval ${interval === opt ? 'active' : ''}`}
              onClick={() => setInterval(opt)}
            >
              {opt}
            </button>
          ))}
        </div>

        <button type="submit" className="btn-primary full-width" disabled={loading}>
          {loading ? 'Adding...' : 'Start Pinging'}
        </button>
      </form>

      <div className="job-list">
        {jobs.length === 0 ? (
          <div className="empty-state">No active pings. Add one above!</div>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className={`job-card ${job.status} ${job.failure_state || ''}`}>
              <div className="job-info">
                <div className="job-header">
                  <span className="job-url">{job.url}</span>
                  {job.alert_email && <span className="email-badge" title={`Alerts: ${job.alert_email}`}>📧</span>}
                  {/* Show alert badge persistently until recovery */}
                  {(job.last_email_type === 'failure' && job.email_sent_at) && (
                    <span
                      className="email-sent-badge failure"
                      title={`Failure alert sent ${new Date(job.email_sent_at).toLocaleString()}`}
                    >
                      📩 Alert Sent
                    </span>
                  )}
                  {/* Show next email countdown while failure email is active */}
                  {(job.last_email_type === 'failure' && job.email_sent_at && job.email_rate_limit && job.permanently_paused !== 1) && (
                    <EmailCooldownTimer
                      emailSentAt={job.email_sent_at}
                      rateLimitMinutes={job.email_rate_limit}
                    />
                  )}
                  {/* Show recovery badge when recovered */}
                  {(job.last_email_type === 'recovery' && job.email_sent_at) && (
                    <span
                      className="email-sent-badge recovery"
                      title={`Recovery email sent ${new Date(job.email_sent_at).toLocaleString()}`}
                    >
                      ✅ Recovery Sent
                    </span>
                  )}
                </div>
                <div className="job-meta">
                  <span className="job-interval">{job.interval}</span>
                  {job.failure_state === 'paused' ? (
                    <PauseCountdown pauseUntil={job.pause_until} />
                  ) : (
                    <Countdown
                      key={`${job.id}-${job.next_run}`}
                      nextRun={job.next_run}
                      status={job.status}
                    />
                  )}
                  {job.failure_state === 'rapid_check' && (
                    <span className="state-badge rapid">Rapid Check</span>
                  )}
                  {job.failure_state === 'paused' && (
                    <span className="state-badge paused">Paused</span>
                  )}
                  {job.permanently_paused === 1 && (
                    <span className="state-badge permanently-paused">⛔ Requires Manual Reset</span>
                  )}
                </div>
                <div className="job-meta-secondary">
                  <span className="job-last-run">Last: {formatLastRun(job)}</span>
                  {job.failure_count > 0 && (
                    <span className="failure-count">⚠️ {job.failure_count} consecutive failure{job.failure_count > 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
              <div className="job-actions">
                {job.permanently_paused === 1 ? (
                  <button
                    className="btn-reset"
                    onClick={() => handleReset(job.id)}
                  >
                    Reset & Resume
                  </button>
                ) : (
                  <button
                    className={`btn-toggle ${job.status}`}
                    onClick={() => handleToggle(job.id)}
                  >
                    {job.status === 'active' ? 'Pause' : 'Resume'}
                  </button>
                )}
                <button
                  className="btn-delete"
                  onClick={() => handleDelete(job.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// Countdown Component - simplified approach without internal interval
const Countdown = ({ nextRun, status }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    // Force re-render every second to update the display
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!nextRun || status === 'stopped') {
    return null;
  }

  const now = new Date();
  const target = new Date(nextRun);
  const diff = target - now;

  // Debug: log the values
  console.log('Countdown render:', {
    nextRun,
    now: now.toISOString(),
    target: target.toISOString(),
    diff,
    diffSeconds: Math.floor(diff / 1000)
  });

  let displayText;
  if (diff <= 0) {
    displayText = 'Pinging...';
  } else {
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    displayText = `${mins}m ${secs}s`;
  }

  return (
    <span className="countdown-timer">
      Next: {displayText}
    </span>
  );
};

// Pause Countdown Component - shows time remaining until resume
const PauseCountdown = ({ pauseUntil }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    // Force re-render every second to update the display
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!pauseUntil) {
    return null;
  }

  const now = new Date();
  const target = new Date(pauseUntil);
  const diff = target - now;

  let displayText;
  if (diff <= 0) {
    displayText = 'Resuming...';
  } else {
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    displayText = `${mins}m ${secs}s`;
  }

  return (
    <span className="pause-countdown-timer">
      Resume in: {displayText}
    </span>
  );
};

// Email Cooldown Timer - shows time until next email can be sent
const EmailCooldownTimer = ({ emailSentAt, rateLimitMinutes }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    // Force re-render every second to update the display
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!emailSentAt || !rateLimitMinutes) {
    return null;
  }

  const now = new Date();
  const sentTime = new Date(emailSentAt);
  const nextEmailTime = new Date(sentTime.getTime() + rateLimitMinutes * 60000);
  const diff = nextEmailTime - now;

  let displayText;
  if (diff <= 0) {
    displayText = 'Ready';
  } else {
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    displayText = `${mins}m ${secs}s`;
  }

  return (
    <span
      className="email-cooldown-timer"
      title={`Next alert can be sent at ${nextEmailTime.toLocaleTimeString()}`}
    >
      Next alert: {displayText}
    </span>
  );
};

export default App
