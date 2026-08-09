# 🔐 Cuvva Backend

**Cuvva Backend — Node.js / Express API & Database**

The API layer for the Cuvva-style insurance platform. Built with **Node.js** and **Express**, it powers the frontend (Customer / Super Admin / Sub Admin) with a secure **JWT cookie-based** authentication system, a **MongoDB/Mongoose** data layer, role-based access control, an automated policy-status cron worker, and a full **Nodemailer** email service that delivers policy documents as PDF attachments.

---

## ⚙️ Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | [Node.js](https://nodejs.org/) | JavaScript server runtime |
| **Framework** | [Express 4](https://expressjs.com/) | HTTP routing & middleware |
| **Database** | [MongoDB](https://www.mongodb.com/) | NoSQL document database |
| **ODM** | [Mongoose 8](https://mongoosejs.com/) | Schema modeling & queries |
| **Auth** | [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) | JWT access/refresh tokens |
| **Password Hashing** | [bcryptjs](https://github.com/dcodeIO/bcrypt.js) | bcrypt password hashing |
| **Cookies** | [cookie-parser](https://github.com/expressjs/cookie-parser) | Parse httpOnly cookies |
| **Email** | [Nodemailer](https://nodemailer.com/) | Gmail SMTP + PDF/HTML emails |
| **Scheduling** | [node-cron](https://github.com/node-cron/node-cron) | Background policy status worker |
| **Security** | [helmet](https://helmetjs.github.io/) | Set secure HTTP headers |
| **Rate Limiting** | [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) | Protect endpoints |
| **Logging** | [morgan](https://github.com/expressjs/morgan) | HTTP request logging |
| **CORS** | [cors](https://github.com/expressjs/cors) | Cross-origin requests |
| **Config** | [dotenv](https://github.com/motdotla/dotenv) | Load `.env` variables |
| **HTTP Client** | [axios](https://axios.com/) | Outbound requests |
| **Dev** | [nodemon](https://nodemon.io/) | Auto-restart during development |

---

## 🏗️ Core Architecture

The project follows the **MVC pattern**:

```
Backend/
├─ app.js                     # Express app: middleware, routing, error/404 handlers
├─ server.js                  # Entry point: connects DB, seeds admin, starts cron + server
├─ config/
│  └─ database.js             # MongoDB connection (mongoose.connect)
├─ middlewares/
│  ├─ auth.js                 # verifyJWT + authorizeRoles (RBAC)
│  ├─ auditLogger.js          # Action-log snapshot helper (stub)
│  └─ ownershipGuard.js       # Tenant ownership barrier (stub)
├─ models/
│  ├─ User.js                 # Super Admin / Sub Admin / Customer
│  ├─ Policy.js               # Insurance contracts
│  ├─ Vehicle.js              # Vehicle registry
│  └─ AuditLog.js             # Audit trail
├─ routes/
│  ├─ auth.js                 # register / login / logout / refresh-token
│  ├─ customers.js            # customer self-service + admin management
│  ├─ management.js           # sub-admins / global customers / status engine
│  ├─ policies.js             # policy issuance + queries
│  └─ vehicles.js             # vehicle registration + lookup
├─ utils/
│  ├─ sendEmail.js            # Nodemailer policy email w/ PDF attachments
│  ├─ seedSuperAdmin.js       # Boot-time default Super Admin seeding
│  ├─ cron/
│  │  └─ policyStatusUpdater.js  # Upcoming → Active → Expired transitions
│  └─ helpers/
│     └─ policyNumberGenerator.js # POL-YYYY-XXXXX generator
├─ pdfs/                      # 3 static policy PDFs attached to emails
└─ public/email-assets/       # Images embedded (cid:) in the email HTML
```

### Boot Sequence (`server.js`)

1. Load environment via `dotenv`.
2. Import the Express app (`app.js`).
3. Configure the `PORT` (default `3000`).
4. `connectDB()` — connect to MongoDB.
5. `seedSuperAdmin()` — ensure a default Super Admin exists.
6. `app.listen()` — start the HTTP server.
7. `startPolicyStatusUpdater()` — launch the background cron worker.

### Middleware Pipeline (`app.js`)

```
helmet → cookieParser → [dev refresh-token logger] → cors → express.json({1mb})
   → express.urlencoded → morgan → rateLimit(200/15min)
   → /api/auth        (authRoutes — no global JWT)
   → /api/vehicles    (verifyJWT + vehicleRoutes)
   → /api/policies    (verifyJWT + policyRoutes)
   → /api/customers   (customerRoutes — verifyJWT handled inside)
   → /api/management  (managementRoutes)
   → /health          (CI/CD health check)
   → centralized error handler (500)
   → 404 handler
```

---

## 🔐 Authentication & Authorization

### JWT Cookie Flow
- On **login**, the server signs two tokens:
  - **`accessToken`** (15 min) — payload `{ id, role, email }`.
  - **`refreshToken`** (7 days) — payload `{ id }`, stored in `user.refreshTokens`.
- Both are sent back as **httpOnly cookies** (`accessToken`, `refreshToken`) with security options that adapt to HTTP vs. HTTPS:
  - `secure: true` only when the request is actually HTTPS (or in production behind a proxy).
  - `httpOnly: true` to block XSS reads.
  - `sameSite: "lax"` to work across different-frontend/back-ports.
- **Logout** pulls the refresh token from the user doc and clears both cookies.
- **Refresh token** endpoint validates the stored token, optionally rotates it, and issues a fresh `accessToken`.

### Middleware

**`verifyJWT`** (`middlewares/auth.js`)
1. Reads `accessToken` from cookies.
2. Verifies it with `JWT_SECRET`.
3. Loads the user from the DB (excluding password) for **real-time** status checks.
4. **Blocks suspended accounts** (`status === "Suspended"`).
5. **Enforces Sub Admin expiry** (`expiresAt` passed).
6. Attaches `req.user` for downstream handlers.

**`authorizeRoles(...allowedRoles)`** — RBAC gatekeeper
- Requires `req.user` to be present.
- Returns `403` if `req.user.role` is not in the allowed list.

```js
// Usage
router.post("/", verifyJWT, authorizeRoles("Super Admin", "Sub Admin"), handler);
```

### Role Hierarchy
| Role | Global scope | Ownership scope |
|------|-------------|-----------------|
| **Super Admin** | Full platform access; cannot be created or suspended via endpoints. | Everything. |
| **Sub Admin** | Agent console; can only register/see/modify **its own** customers, vehicles, policies. | Only their own records (`createdBy` matches). |
| **Customer** | Self-service only (`/customers/me`, own policies). | Only their own data. |

**Super Admin is structural/permanent** — status endpoints reject modifying a Super Admin, and the register route refuses to create one.

---

## 🗄️ Database Models

### `User` (`models/User.js`)
```js
{
  fullName, firstName, lastName,
  email,                     // unique, lowercase
  password,                  // bcrypt-hashed
  phone, dateOfBirth, gender,
  drivingLicenceNumber,
  address: { line1, line2, city, county, postcode, country },
  preferredName, profilePhotoUrl,
  additionalEmails: [String],
  lastFourDigits,
  role,                       // 'Super Admin' | 'Sub Admin' | 'Customer'
  status,                     // 'Active' | 'Suspended'
  expiresAt,                  // Sub Admin / Customer access window
  createdBy,                  // ownership chain
  refreshTokens: [String],
  resetToken, resetExpires,
}, { timestamps: true }
```
**Key behaviors:**
- `pre("save")` **auto-splits** `fullName` into `firstName` / `lastName`.
- `pre("save")` **hashes the password** with bcrypt (`$2...` guard prevents double-hashing).
- Indexed on `{ role, status }` and `{ createdBy }`.

### `Policy` (`models/Policy.js`)
```js
{
  policyNumber,               // POL-YYYY-XXXXX (auto-generated)
  customerId,                 // ref: User
  vehicleId,                  // ref: Vehicle
  createdBy,                  // ref: User (issuing admin)
  premiumAmount,              // Number — direct decimal pounds (£123.44 = 123.44)
  startDate, endDate,
  startTime, endTime,         // "HH:MM"
  policyType,                 // Temporary Car/Van, Learner Driver, Impound, Motorhome, Drive Away
  coverageType,               // Comprehensive | Third Party Only
  underwriter,                // Wakam | ERS Syndicate | Crawford
  status,                     // Upcoming | Active | Expired | Cancelled
  internalNotes,
}, { timestamps: true }
```
**Key behaviors:**
- `pre("save")` auto-generates `POL-YYYY-XXXXX` using `generatePolicyNumber`.
- `premiumAmount` is stored as a **direct decimal** (pounds, with 2dp), never pence-integer math.
- Indexed on `{ customerId, status }`, `{ vehicleId }`, `{ createdBy }`.

### `Vehicle` (`models/Vehicle.js`)
```js
{
  createdBy,                  // ref: User
  registration,               // unique, uppercase (e.g. "BD55SMR")
  make, model, colour, year,
  fuelType,                   // PETROL | DIESEL | ELECTRIC | HYBRID
  engineCapacityCC, powerBHP, topSpeed, cylinders, fuelConsumptionMPG,
  motStatus, motExpiryDate,   // manually-managed DVLA compliance
  taxStatus, taxDueDate,
  registrationKeeper, v5cIssueDate, co2Emissions, euroStatus, wheelplan,
}, { timestamps: true }
```
`registration` is **unique** so admins can't add the same plate twice.

### `AuditLog` (`models/AuditLog.js`)
```js
{
  actorId, actorRole, actorEmail,     // who did it
  action, module, targetId,           // what happened
  payloadBefore, payloadAfter,         // state snapshots
  ipAddress, userAgent,
  success, errorMessage,
}, { timestamps: true }
```
Indexed for newest-first queries on `{ actorId, createdAt }` and `{ module, action, createdAt }`.

> **Note:** `auditLogger` and `ownershipGuard` middlewares are present as scaffolding stubs — they currently pass through and await controller wiring.

---

## 📡 API Routes & Endpoints

### Auth (`/api/auth`)
| Method | Route | Auth | Role(s) | Description |
|--------|-------|------|---------|-------------|
| `POST` | `/register` | JWT | Super Admin, Sub Admin | Register Sub Admin / Customer accounts. Super Admins cannot be created; Sub Admins can only register Customers. |
| `POST` | `/login` | — | Public | Login, issue access + refresh cookies, return role-aware redirect. |
| `POST` | `/logout` | JWT | Any | Revoke refresh token + clear cookies. |
| `POST` | `/refresh-token` | — | Public | Rotate refresh token → new `accessToken`. |

### Vehicles (`/api/vehicles`)
| Method | Route | Auth | Role(s) | Description |
|--------|-------|------|---------|-------------|
| `POST` | `/` | JWT | Super Admin, Sub Admin | Manually register a vehicle (registration is normalised & de-duplicated). |
| `GET` | `/lookup/:registration` | JWT | Customer, Sub Admin, Super Admin | Plate lookup with role-based visibility (Super Admin sees `createdBy`). |
| `GET` | `/all` | JWT | Super Admin, Sub Admin | Master vehicle catalog, role-based `createdBy` visibility. |

### Policies (`/api/policies`)
| Method | Route | Auth | Role(s) | Description |
|--------|-------|------|---------|-------------|
| `POST` | `/` | JWT | Super Admin, Sub Admin | Issue a policy. Validates customer/vehicle, prevents **timeline overlaps**, and triggers the policy email. |
| `GET` | `/all` | JWT | Super Admin | Full policy ledger with populated relations. |
| `GET` | `/my` | JWT | Customer, Sub Admin, Super Admin | Ownership-scoped policies (Customer = own; admins = personally created). |
| `GET` | `/:id` | JWT | Super Admin | Single policy detail (full population). |
| `PUT` | `/:id` | JWT | Super Admin, Sub Admin | Update policy (premium, dates/times, type/coverage/underwriter, status, notes); Sub Admins restricted to their own. |

### Customers (`/api/customers`)
| Method | Route | Auth | Role(s) | Description |
|--------|-------|------|---------|-------------|
| `GET` | `/me` | JWT | Customer | Get the authenticated customer's own profile. |
| `PATCH` | `/me` | JWT | Customer | Self-service update: preferred name, additional email (validated/uniqued), phone, Cloudinary profile photo URL. |
| `DELETE` | `/me` | JWT | Customer | Delete own account (frontend-ready; route pending). |
| `GET` | `/` | JWT | Super Admin, Sub Admin | List customers (Super = all; Sub = their own only). |
| `GET` | `/:id` | JWT | Super Admin, Sub Admin | Single customer detail with ownership guard for Sub Admins. |
| `PATCH` | `/:id` | JWT | Super Admin, Sub Admin | Update customer profile (with Sub Admin ownership guard). |

### Management (`/api/management`)
| Method | Route | Auth | Role(s) | Description |
|--------|-------|------|---------|-------------|
| `GET` | `/subadmins` | JWT | Super Admin | List all sub-admins. |
| `GET` | `/customers` | JWT | Super Admin | Global customer overview with creator details. |
| `PATCH` | `/status/:id` | JWT | Super Admin, Sub Admin | Toggle `Active` / `Suspended`; Super Admins are protected; Sub Admins limited to their own Customers. |
| `GET` | `/subadmins/:id` | JWT | Super Admin | Single sub-admin detail. |
| `PATCH` | `/subadmins/:id` | JWT | Super Admin | Update a sub-admin (name, email, expiry, password). |

### Misc
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/health` | Health/CI-CD verification endpoint. |

---

## 📧 Email Service Integration

**`utils/sendEmail.js`** uses **Nodemailer** with a configured Gmail SMTP Transporter (`EMAIL_USER` / `EMAIL_PASS`, ideally a Gmail **App Password**).

### How it works
1. **Triggered automatically** inside `POST /api/policies`. After a policy is created, the route builds an `emailData` object (customer name, vehicle make/model/registration, formatted start/end dates, duration, price, card placeholder, and policy number).
2. `sendPolicyEmail(customerEmail, policyData)` is fired **non-blocking** (no `await`) so the admin's API response isn't delayed. Any email failure is logged but **never fails the policy creation**.
3. The function attaches **3 static PDFs** from `pdfs/`:
   - `Policy details and certificate.pdf`
   - `Policy wording (full terms).pdf`
   - `Insurance summary (IPID).pdf`
4. It **embeds CID images** from `public/email-assets/` (Cuvva logo, app-store/Google-Play badges, and social icons for X, Facebook, Instagram, TikTok, LinkedIn, YouTube, and a Mastercard icon) referenced as `cid:` in the HTML.
5. `buildPolicyEmailHtml(policyData)` renders a pixel-matched dark-mode-safe Cuvva-style HTML email: policy summary rows, payment line, "take a photo" reminder, "report an incident" link, social icons, legal footer, and store badges.

> **Non-blocking decision:** policy creation proceeds even if email dispatch fails, because the policy is already persisted and confirmed in the database.

---

## 🔧 Environment Variables

Create a `.env` file in the **`Backend/`** root:

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/cuvva` |
| `JWT_SECRET` | Secret for access tokens | `your-access-secret` |
| `JWT_REFRESH_SECRET` | Secret for refresh tokens | `your-refresh-secret` |
| `EMAIL_USER` | Gmail address for Nodemailer | `you@gmail.com` |
| `EMAIL_PASS` | Gmail App Password for Nodemailer | `xxxx xxxx xxxx xxxx` |
| `CORS_ORIGIN` | Allowed frontend origin (defaults to `*`) | `http://localhost:5173` |
| `CLIENT_URL` | Frontend URL (used for redirects/links) | `http://localhost:5173` |
| `NODE_ENV` | `development` / `production` | `development` |

> **Note:** `CLIENT_URL` / `CORS_ORIGIN` are used by CORS and cookie-security logic. For production you must set `NODE_ENV=production` and run behind HTTPS so the `secure` cookie flag is applied correctly.

---

## 🚀 Installation & Setup

### Prerequisites
- Node.js 18+
- A running MongoDB instance (local or [MongoDB Atlas](https://www.mongodb.com/atlas))

### Steps

```bash
# 1. Move into the backend directory
cd Backend

# 2. Install dependencies
npm install

# 3. Create your environment file
cp .env.example .env   # then fill in MONGO_URI, JWT secrets, email credentials

# 4. (Recommended) Seed the default Super Admin manually if the boot-time
#    seed doesn't run, or to force re-seeding from scratch:
node utils/seedSuperAdmin.js

# 5. Start the server (via nodemon for development)
npm run dev
#    or run without auto-restart:
npm start
```

The server will:
1. Connect to MongoDB.
2. Auto-seed a default **Super Admin** if none exists (`superadmin@cuvvaclone.com`).
3. Launch a **cron worker** that transitions policies `Upcoming → Active → Expired` every minute based on local date/time.
4. Begin listening on `http://localhost:3000`.

> **Default seeded Super Admin:**
> - Email: `superadmin@cuvvaclone.com`
> - Password: `SuperAdminPass2026!`
> ⚠️ **Change this credential immediately for any non-local environment.**

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the server in production mode |
| `npm run dev` | Start with `nodemon` (auto-restart on changes) |
| `node utils/seedSuperAdmin.js` | Manually seed the default Super Admin |

---

## 🕰️ Background Worker

`utils/cron/policyStatusUpdater.js` runs every minute (`* * * * *`):
- **Upcoming → Active** when `startDate`/`startTime` has been reached.
- **Active → Expired** when `endDate`/`endTime` has passed.

It uses the server's **local** date/time to evaluate transitions.

---

## 📦 Utility Helpers

- **`policyNumberGenerator.js`** — generates `POL-YYYY-XXXXX` numbers (zero-padded 5-digit sequence).
- **`seedSuperAdmin.js`** — ensures the default Super Admin account exists on boot.
- **`sendEmail.js`** — the Nodemailer service (see above).

