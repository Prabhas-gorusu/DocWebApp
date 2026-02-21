const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { markExpiredAppointmentsAndNotify } = require('../src/appointmentService');

const setup = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      phone TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      appointment_time TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'booked',
      message_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      appointment_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('Patient', 'p@example.com', 'x', 'patient')").run();
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('Doctor', 'd@example.com', 'x', 'doctor')").run();

  return db;
};

test('marks booked appointments in the past as expired and creates notifications', () => {
  const db = setup();
  db.prepare(
    "INSERT INTO appointments (patient_id, doctor_id, appointment_time, status) VALUES (1, 2, datetime('now', '-2 hour'), 'booked')"
  ).run();
  db.prepare(
    "INSERT INTO appointments (patient_id, doctor_id, appointment_time, status) VALUES (1, 2, datetime('now', '+2 hour'), 'booked')"
  ).run();

  const result = markExpiredAppointmentsAndNotify(db);

  assert.equal(result.expiredCount, 1);
  const expired = db.prepare("SELECT status, message_sent FROM appointments WHERE id = 1").get();
  assert.equal(expired.status, 'expired');
  assert.equal(expired.message_sent, 1);

  const future = db.prepare('SELECT status FROM appointments WHERE id = 2').get();
  assert.equal(future.status, 'booked');

  const notifications = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE appointment_id = 1').get();
  assert.equal(notifications.count, 1);
});
