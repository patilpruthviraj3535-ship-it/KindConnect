# KindConnect Backend

This is the backend foundation for the current KindConnect frontend.

## Included
- Node.js + Express API
- SQLite persistent database
- Donor / NGO authentication
- Password hashing with bcrypt
- Session login
- NGO directory
- NGO profiles
- Donation requirements
- Donor pledges
- Donor dashboard API
- NGO dashboard API
- NGO requirement create/update/delete
- Google Maps-ready `map_query`
- Seeded Pune NGO data

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Development:

```bash
npm run dev
```

## Main endpoints

GET `/api/ngos`
GET `/api/ngos/:id`
GET `/api/requirements`

POST `/api/auth/register`
POST `/api/auth/login`
POST `/api/auth/logout`
GET `/api/auth/me`

POST `/api/pledges`
GET `/api/donor/dashboard`

POST `/api/ngo/profile`
GET `/api/ngo/dashboard`
POST `/api/ngo/requirements`
PATCH `/api/ngo/requirements/:id`
DELETE `/api/ngo/requirements/:id`

## Production
Set a strong `SESSION_SECRET`, use HTTPS/secure cookies, add admin NGO verification, and move from local SQLite to a managed database if deploying at scale.
