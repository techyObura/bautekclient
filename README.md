# Bautek Flink Ltd — MERN frontend

A responsive React + Vite frontend prototype for **Bautek Flink Ltd**. Built from the supplied business/workflow specification with colours `#0a192f`, `#ff9f1c`, `#f8f9fa` and `#6c757d`.

## Start

```bash
npm install
cp .env.example .env  # Windows: copy .env.example .env
npm run dev
```

Open `http://localhost:5173` or the Vite LAN URL. The app defaults to **explicit DEMO mode**, with role selection on `/login`. Demo changes are stored in localStorage; sample user sessions are stored in sessionStorage. No payment, real upload, legal verification, role elevation or live messaging occurs.

## Production connection

Set:

```env
VITE_DEMO_MODE=false
VITE_API_URL=https://api.your-domain.com/api/v1
```

The authentication adapter (`src/auth.jsx`) currently expects these endpoints and fields (adjust to your existing Express API contracts):

- `POST /auth/login` body `{email,password}` → `{user:{id,name,email,role},accessToken}` (nested `data` is also supported).
- `POST /auth/register` body `{name,email,password,role:'client'}` → signup result.
- `POST /auth/refresh` → `{user,accessToken}`; HttpOnly cookie sent via `credentials:'include'`.
- `POST /auth/logout` → logout.

**All other workflow screens are demo previews, not yet connected to backend services.** Connect each module to its Express routes and MongoDB Atlas data models; remove the browser-local store before production. The app does **not** create an Express backend, Daraja service, escrow service or file storage.

## Role routes

| Role | Main route | Example responsibilities |
| --- | --- | --- |
| Public | `/`, `/services`, `/marketplace`, `/insights`, `/about` | Browse service info and published listings |
| Client | `/app/client` | Own projects, project wizard, bids, property statements, documents |
| Contractor | `/app/contractor` | Assigned projects, tenders, site updates and bids |
| Admin | `/app/admin` | Review projects, listings, property ledger, verification queue |
| Super admin | `/app/super-admin` | Full overview, user-role demo, audit demo and system rules |

Route guards and menus are **UI conveniences only**. Never trust frontend checks for permissions.

## Backend integration checklist — required before production

1. Verify JWT/access tokens on every protected API route. Verify role *and* object-level ownership/assignment for projects, bids, messages, financial records, documents and listings.
2. Do not allow clients to select `admin`, `super_admin` or `contractor` in self-registration. Role assignment and contractor onboarding must be approved server-side; protect role changes with MFA/re-authentication, immutable audit logs and session revocation.
3. Add `/projects`, `/projects/:id`, `/bids`, `/listings`, `/documents`, `/payments`, `/property`, `/notifications`, `/messages`, `/contractors`, `/admin/users` etc. with consistent JSON schemas and pagination. Map workflow states to server-controlled transitions.
4. Keep official payment statuses and receipts exclusively server-driven. Verify Daraja callback signatures/transactions as available, reconcile amounts, use idempotency keys, and never treat a browser redirect as payment confirmation.
5. Bank escrow/savings is a future financial integration requiring a licensed bank/regulated provider, contractual setup and reconciliation. Do not hold client funds through an unverified escrow claim.
6. Store uploaded evidence privately (e.g. object storage), virus-scan, validate MIME/content/size, remove image metadata if appropriate, generate time-limited download URLs and enforce document-level permissions.
7. Moderate text/media at API level; detect and block phone/email exchange in listing text and messages, including contact details inside image/video content. Client-side regex is *not sufficient*.
8. Implement real PDF generation and cryptographically verifiable certificate/QR codes server-side. Printed browser statements are *not* verified financial records.
9. Validate commercial terms, fees, refunds and statutory land charges with Kenyan legal/tax/engineering professionals before using them to process money. The wizard shows assumptions from the supplied brief, not statutory advice.
10. Set restricted CORS origin(s), HTTPS, cookie security, CSRF protections for cookie authentication, rate limits, security headers, monitoring, backup policies and integration tests.

## Frontend files

- `src/App.jsx`: screens, navigation and demo actions.
- `src/auth.jsx`: session/auth API adapter and role guards.
- `src/data.js`: branded services, navigation, reference roles and demo fixtures.
- `src/store.js`: local browser data store for demonstration.
- `src/style.css`: responsive design, including print stylesheet.

## Known prototype limitations

- Listings have text filtering only; real media upload, reactions, following and private project-scoped messaging are pending.
- No real M-Pesa payments, bank escrow, refunds, notifications or verified receipts.
- Project wizard produces a draft; deeper category-specific forms and approval transitions need API + UX implementation.
- Property statement supports browser print-to-PDF and CSV, not signed backend PDF generation.
- Sample metrics and records are illustrative. Do not present them as actual Bautek business performance.
- Demo role changes affect only local demonstration records, not actual auth identity.

This is a **functional frontend starter/prototype**, not a production-ready fully integrated MERN system.
