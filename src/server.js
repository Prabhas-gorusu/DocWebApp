require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const dayjs = require('dayjs');
const { db, init } = require('./db');
const { signToken, authRequired, requireRole } = require('./auth');
const { markExpiredAppointmentsAndNotify } = require('./appointmentService');

init();

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_req, res) => {
  res.json({ ok: true, app: 'hospital-appointment-app' });
});

app.post('/auth/register', (req, res) => {
  const { name, email, password, role = 'patient', phone } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'name, email, and password are required' });
  }

  const normalizedRole = ['patient', 'doctor', 'admin'].includes(role) ? role : 'patient';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ message: 'Email already registered' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare('INSERT INTO users (name, email, password_hash, role, phone) VALUES (?, ?, ?, ?, ?)')
    .run(name, email, passwordHash, normalizedRole, phone || null);

  const user = db.prepare('SELECT id, name, email, role, phone, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json({ user, token: signToken(user) });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  return res.json({
    token: signToken(user),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone
    }
  });
});

app.get('/doctors', authRequired, (_req, res) => {
  const doctors = db
    .prepare("SELECT id, name, email, phone, created_at FROM users WHERE role = 'doctor' ORDER BY name")
    .all();
  res.json({ doctors });
});

app.post('/appointments', authRequired, requireRole('patient', 'admin'), (req, res) => {
  const { doctorId, appointmentTime, reason } = req.body;
  if (!doctorId || !appointmentTime) {
    return res.status(400).json({ message: 'doctorId and appointmentTime are required' });
  }

  if (!dayjs(appointmentTime).isValid()) {
    return res.status(400).json({ message: 'appointmentTime must be a valid ISO date string' });
  }

  const doctor = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'doctor'").get(doctorId);
  if (!doctor) {
    return res.status(404).json({ message: 'Doctor not found' });
  }

  const result = db
    .prepare('INSERT INTO appointments (patient_id, doctor_id, appointment_time, reason) VALUES (?, ?, ?, ?)')
    .run(req.user.id, doctorId, dayjs(appointmentTime).toISOString(), reason || null);

  const appointment = db
    .prepare(
      `SELECT a.id, a.patient_id, a.doctor_id, a.appointment_time, a.reason, a.status, a.created_at,
              p.name AS patient_name, d.name AS doctor_name
       FROM appointments a
       JOIN users p ON p.id = a.patient_id
       JOIN users d ON d.id = a.doctor_id
       WHERE a.id = ?`
    )
    .get(result.lastInsertRowid);

  return res.status(201).json({ appointment });
});

app.get('/appointments/me', authRequired, (req, res) => {
  const query =
    req.user.role === 'doctor'
      ? `SELECT a.*, p.name AS patient_name, p.email AS patient_email
         FROM appointments a JOIN users p ON p.id = a.patient_id
         WHERE a.doctor_id = ? ORDER BY a.appointment_time DESC`
      : `SELECT a.*, d.name AS doctor_name, d.email AS doctor_email
         FROM appointments a JOIN users d ON d.id = a.doctor_id
         WHERE a.patient_id = ? ORDER BY a.appointment_time DESC`;

  const appointments = db.prepare(query).all(req.user.id);
  return res.json({ appointments });
});

app.patch('/appointments/:id/status', authRequired, requireRole('doctor', 'admin'), (req, res) => {
  const { status } = req.body;
  const allowed = ['booked', 'completed', 'cancelled'];

  if (!allowed.includes(status)) {
    return res.status(400).json({ message: `status must be one of ${allowed.join(', ')}` });
  }

  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!appointment) {
    return res.status(404).json({ message: 'Appointment not found' });
  }

  if (req.user.role === 'doctor' && appointment.doctor_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only update your own appointments' });
  }

  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, req.params.id);
  return res.json({ message: 'Status updated' });
});

app.get('/dashboard/doctor', authRequired, requireRole('doctor'), (req, res) => {
  const total = db
    .prepare('SELECT COUNT(*) AS count FROM appointments WHERE doctor_id = ?')
    .get(req.user.id).count;

  const todayStart = dayjs().startOf('day').toISOString();
  const todayEnd = dayjs().endOf('day').toISOString();

  const today = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM appointments
       WHERE doctor_id = ? AND appointment_time BETWEEN ? AND ?`
    )
    .get(req.user.id, todayStart, todayEnd).count;

  const byStatus = db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM appointments
       WHERE doctor_id = ?
       GROUP BY status`
    )
    .all(req.user.id);

  const upcoming = db
    .prepare(
      `SELECT a.id, a.appointment_time, a.status, p.name AS patient_name, p.email AS patient_email
       FROM appointments a
       JOIN users p ON p.id = a.patient_id
       WHERE a.doctor_id = ? AND a.appointment_time >= ?
       ORDER BY a.appointment_time ASC
       LIMIT 5`
    )
    .all(req.user.id, dayjs().toISOString());

  res.json({
    doctorId: req.user.id,
    stats: { totalAppointments: total, todayAppointments: today, byStatus },
    upcoming
  });
});

app.get('/notifications/me', authRequired, (req, res) => {
  const notifications = db
    .prepare(
      `SELECT id, appointment_id, type, message, sent_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY sent_at DESC`
    )
    .all(req.user.id);
  res.json({ notifications });
});

app.post('/jobs/check-expired-appointments', (_req, res) => {
  const result = markExpiredAppointmentsAndNotify(db);
  return res.json(result);
});

cron.schedule('*/1 * * * *', () => {
  const result = markExpiredAppointmentsAndNotify(db);
  if (result.expiredCount > 0) {
    console.log(`Expired appointments processed: ${result.expiredCount}`, result.notified);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Hospital app API running on port ${PORT}`);
});
