# 🏢 CommercialSpace Manager

[![Build Status](https://img.shields.io/badge/status-in--progress-yellow)](#)
[![Tech Stack](https://img.shields.io/badge/stack-PERN-blueviolet)](#)

A full-stack web application for **landlords and renters** to efficienttly manage commercial rental spaces. It allows landlords to track rooms, contracts, and payments, while giving renters access to their lease details and communication tools — all within a secure, role-based platform.

---

## 🚀 Project Goals

- ✅ Develop **RESTful APIs** that are secure, scalable, and well-documented
- ✅ Build a **user-friendly interface** for both landlords and tenants
- ✅ Implement **secure authentication and role-based access**
- ✅ Learn and apply the **PERN stack**: PostgreSQL, Express.js, React, and Node.js
- ✅ Focus on **encryption, password hashing**, and other security best practices

---

## 🛠️ Tech Stack

| Area       | Tech Used                             |
|------------|----------------------------------------|
| Frontend   | React, HTML5/CSS3 or (EJS)            |
| Backend    | Node.js, Express.js                    |
| Database   | PostgreSQL                             |
| Security   | Sessions (express-session + Passport, stored in Postgres), bcrypt, helmet, rate limiting, zod validation |
| Tools      | Git, GitHub, Postman                   |
| Future     | WebSockets (for real-time messaging)   |

---

## 📈 Progress Tracker

### ✅ Core Features

- [x] Database schema setup (users, rooms, contracts, payments)
- [x] User registration & login (bcrypt + session cookies)
- [x] Role-based access for landlords and renters (the role comes from the database and is checked on every route)
- [ ] Room management (create and view done; update and delete still to do)
- [ ] Frontend integration with backend API
- [ ] Responsive dashboard UI

  **Potential core features**

    - [ ] Payment tracking (linked to contracts)
    - [ ] Direct messaging system (basic)
    - [ ] Contract upload/generation

### 🔒 Security Features

- [x] Password hashing with Bcrypt
- [x] Session-based authentication (Passport, Postgres session store)

  **Potential security fearures**

    - [x] Server-side input validation (zod)
    - [x] Helmet headers + HTTPS (via Vercel); nonce-based script policy, inline styles still allowed
    - [x] Shared PostgreSQL rate limiting on login and sign-up
    - [x] CSRF tokens on every form + POST-based logout
    - [x] Renter profiles are private by default; renters can opt in or withdraw consent

---

## 📆 Weekly Timeline

| Week | Milestone |
|------|-----------|
| 1    | Set up database schema and basic backend server |
| 2 - 3| Create user authentication and roles (JWT + Bcrypt) |
| 3 - 5| Build backend APIs for rooms and contracts |
| 5 - 7| Start frontend development using React |
| 7    | Integrate frontend with backend APIs |
| 8    | Polish UI, testing, and prepare for deployment |

---

## 🧠 Key Learning Outcomes

- Built RESTful APIs from scratch with Express and PostgreSQL
- Gained hands-on experience with secure authentication
- Learned full-stack development with the PERN architecture (gained hands-on experience )
- Practiced frontend-backend integration and secure coding principles

---

## 🚧 To-Do Next

- [ ] Complete frontend views (dashboard, login, register, rooms)
- [ ] Test API endpoints using Postman
- [ ] Finalize real-time messaging logic
- [ ] Deploy full app to Render, Vercel, or Heroku


## ▶️ Running it

```bash
cp .env.example .env   # fill in your database and SESSION_SECRET
npm install
npm start              # http://localhost:3000
npm test               # runs the whole test suite (no database needed)
```

If your database already exists, apply the migrations below. The new consent column defaults existing renters to private; do not mark existing renters discoverable without their consent. Check for duplicate room titles per landlord before creating the unique index:

```sql
SELECT landlord_id, lower(title), COUNT(*)
FROM rooms
GROUP BY landlord_id, lower(title)
HAVING COUNT(*) > 1;
```

Resolve any duplicates, then run this statement against that database:

```sql
CREATE UNIQUE INDEX rooms_landlord_title_unique ON rooms (landlord_id, lower(title));
```

```sql
ALTER TABLE renters
ADD COLUMN IF NOT EXISTS discoverable BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);
```

## 🔒 Security model (and what is still open)

- **Who you are comes from the database.** The login form's role picker only chooses which table to check; whoever passes the password check in that table gets that role. Roles are never taken from the browser.
- **Everything a landlord sees is filtered by their own id** (rooms, contracts, totals), and a lease can only use a room that belongs to the logged-in landlord and is still free (one atomic database statement inside a transaction).
- Sessions live in Postgres (`session` table), the cookie is `HttpOnly` + `SameSite=Lax` (+ `Secure` in production), and the session holds only `id`, `role` and `full_name`.
- Every form carries a secret CSRF token tied to the session, and every POST without it is refused (a malicious site can send your browser to our URLs but can't read our pages, so it can't know the token). Logout is a POST for the same reason.
- Renter profiles are private by default. Landlords only see discovery details when a renter opts in, and renters can withdraw consent from their dashboard.
- Login and registration limits are stored in PostgreSQL, so app instances share the same counters.
- Helmet's Content-Security-Policy restricts scripts to same-origin sources and per-response nonces. Inline styles remain allowed while templates are migrated away from `style` attributes.
- The tests in `test/` try the attacks (role switching, reading other landlords' data, double-booking, ...) and fail if one of them works again.

Known gaps: lease forms identify renters by name instead of id, payments/messages/contracts pages show placeholder data, the renter portal is mostly a placeholder dashboard, and real-PostgreSQL deployment behavior should be checked in staging in addition to the PGlite tests.

---

## 🙋‍♂️ About Me

I'm a full-stack developer in training, passionate about solving real-world problems through digital innovations. This project is a major milestone in my journey to mastering backend and frontend systems.

Let's connect!  
📫 [LinkedIn](https://www.linkedin.com/in/josue-cikanga) | 🧑‍💻 Portfolio coming soon...

---
