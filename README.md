# TaskFlow — Full-Stack SaaS Application

A small multi-user project/task manager built to demonstrate the resume bullet:

> Built a full-stack web application with a responsive frontend, backend API, authentication, and persistent SQL data storage. Implemented CRUD workflows and connected frontend components to backend services for end-to-end user functionality.

## Stack

- **Backend:** Python + Flask, hand-rolled JWT auth (PyJWT), `sqlite3` (stdlib) for persistent SQL storage — no ORM, so the SQL itself is visible in `backend/db.py` / `backend/app.py`.
- **Frontend:** Vanilla JavaScript + DOM APIs, no framework and no build step (`frontend/app.js`, ~450 lines). It talks to the API purely over `fetch`. See "Porting to React" below if you'd rather present it as a React app.
- **Auth:** Register/login issue a signed JWT; the frontend stores it and sends `Authorization: Bearer <token>` on every request; the API scopes every project/task query to the logged-in user's `owner_id`.
- **Data model:** `users` → `projects` → `tasks`, each task has `status` (`todo` / `in_progress` / `done`), `priority`, and an optional `due_date`.

## Running it

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python3 app.py            # http://127.0.0.1:5001
```

In a second terminal:

```bash
cd frontend
python3 -m http.server 5173   # or any static file server
```

Open `http://127.0.0.1:5173`, create an account, and use the app. A new account is seeded with a "Getting Started" project so the dashboard isn't empty on first login.

If you serve the frontend from a different host/port than `127.0.0.1:5001`, update `API_BASE_URL` in `frontend/config.js`.

## API summary

| Method | Path                              | Description                        |
|--------|-----------------------------------|-------------------------------------|
| POST   | `/api/auth/register`              | Create an account, returns JWT      |
| POST   | `/api/auth/login`                 | Log in, returns JWT                 |
| GET    | `/api/auth/me`                    | Current user                        |
| GET    | `/api/projects`                   | List the caller's projects          |
| POST   | `/api/projects`                   | Create a project                    |
| GET    | `/api/projects/:id`                | Project + its tasks                 |
| PUT    | `/api/projects/:id`                | Update a project                    |
| DELETE | `/api/projects/:id`                | Delete a project (cascades tasks)   |
| POST   | `/api/projects/:id/tasks`          | Create a task                       |
| PUT    | `/api/tasks/:id`                   | Update a task                       |
| DELETE | `/api/tasks/:id`                   | Delete a task                       |

## Porting to React

The frontend is deliberately dependency-free so it runs anywhere with zero install step. To present it as a React app instead (e.g. to match "React" on a resume line):

1. `npm create vite@latest taskflow-frontend -- --template react`
2. Move the JSX-shaped logic in `app.js` — each section (`AuthScreen`, `Dashboard`, `ProjectView`, `TaskCard`, `ProjectModal`) already maps 1:1 onto a React function component; the `el(...)` calls become JSX tags and the manual `render()`/`rerender()` calls become `useState`.
3. Reuse `styles.css` and `config.js` as-is, and the Flask API is unchanged.
