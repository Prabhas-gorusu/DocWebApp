const dayjs = require('dayjs');

const markExpiredAppointmentsAndNotify = (db) => {
  const now = dayjs().toISOString();

  const expired = db
    .prepare(
      `SELECT a.id, a.patient_id, u.name, u.email, a.appointment_time
       FROM appointments a
       JOIN users u ON u.id = a.patient_id
       WHERE a.status = 'booked' AND a.appointment_time < ?`
    )
    .all(now);

  if (!expired.length) {
    return { expiredCount: 0, notified: [] };
  }

  const updateStmt = db.prepare(`UPDATE appointments SET status = 'expired', message_sent = 1 WHERE id = ?`);
  const insertNotificationStmt = db.prepare(
    `INSERT INTO notifications (user_id, appointment_id, message, type) VALUES (?, ?, ?, 'appointment_expired')`
  );

  const tx = db.transaction(() => {
    for (const appointment of expired) {
      const message = `Hi ${appointment.name}, your appointment scheduled at ${appointment.appointment_time} has expired. Please book a new slot.`;
      updateStmt.run(appointment.id);
      insertNotificationStmt.run(appointment.patient_id, appointment.id, message);
    }
  });

  tx();

  return {
    expiredCount: expired.length,
    notified: expired.map((item) => ({ email: item.email, appointmentId: item.id }))
  };
};

module.exports = { markExpiredAppointmentsAndNotify };
