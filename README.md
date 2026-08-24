# Zennara — Admin Panel

Standalone Admin Panel for the Zennara clinic. Vite + React, talks to the Zennara
backend for everything (`VITE_API_BASE_URL` in `.env`).

- Sign-in: email OTP or password via `/api/admin/auth/*`.
- Only accounts with role **`super_admin`** can use this panel; other roles are told
  which panel to use instead and no session is stored.
- Home route: `/overview` · dev server port: 5173.

```
npm install
npm run dev
```
