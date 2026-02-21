# Hospital Appointment Application (Backend)

This project is a starter **Hospital Application API** that includes:

- Database integration (SQLite)
- User account creation and login (Patient / Doctor / Admin)
- Appointment booking
- Expired appointment notification job
- Doctor dashboard analytics
- Extra features: appointment status updates and user notifications feed

## Tech Stack

- Node.js + Express
- SQLite via `better-sqlite3`
- JWT authentication
- Cron job (`node-cron`) for expired appointments

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Server runs on `http://localhost:3000`.

## Main API Endpoints

### Auth

- `POST /auth/register` – Create account
- `POST /auth/login` – Login and get JWT token

### Doctors & Appointments

- `GET /doctors` – List available doctors
- `POST /appointments` – Book appointment (patient/admin)
- `GET /appointments/me` – My appointments (patient or doctor view)
- `PATCH /appointments/:id/status` – Doctor/admin updates appointment status

### Dashboard & Notifications

- `GET /dashboard/doctor` – Doctor dashboard stats and upcoming list
- `GET /notifications/me` – User notifications

### Background Job

- `POST /jobs/check-expired-appointments` – Manually trigger expired-appointment check
- Auto-job runs every minute to mark past `booked` appointments as `expired` and create notification records.

## Example flow

1. Register one doctor and one patient.
2. Login as patient.
3. Book appointment with doctor using doctor ID.
4. If appointment time is in the past, job marks it `expired` and stores notification message.
5. Patient can read it from `/notifications/me`.

## Notes for Production

- Move from SQLite to PostgreSQL/MySQL for scale.
- Integrate SMS/email provider (Twilio, SendGrid, etc.) to send real messages.
- Add rate limiting and refresh tokens.
