"""TaskFlow API - a small multi-user SaaS backend.

Demonstrates: REST API design, JWT authentication, persistent SQL storage
(sqlite3), and full CRUD workflows for Projects and Tasks that a
responsive frontend consumes end-to-end.
"""
from datetime import date

from flask import Flask, g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from auth import create_token, login_required
from db import get_connection, init_db, row_to_dict

STATUSES = ("todo", "in_progress", "done")
PRIORITIES = ("low", "medium", "high")

app = Flask(__name__)


# --------------------------------------------------------------------- CORS
@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response


@app.route("/api/<path:_any>", methods=["OPTIONS"])
def cors_preflight(_any):
    return "", 204


# --------------------------------------------------------------------- misc
def project_to_dict(row, task_rows=None):
    data = dict(row)
    if task_rows is not None:
        data["tasks"] = [task_to_dict(t) for t in task_rows]
        data["task_count"] = len(task_rows)
        data["done_count"] = sum(1 for t in task_rows if t["status"] == "done")
    return data


def task_to_dict(row):
    return dict(row)


def user_to_dict(row):
    return {"id": row["id"], "name": row["name"], "email": row["email"]}


def owned_project(conn, project_id, owner_id):
    return conn.execute(
        "SELECT * FROM projects WHERE id = ? AND owner_id = ?",
        (project_id, owner_id),
    ).fetchone()


def owned_task(conn, task_id, owner_id):
    return conn.execute(
        """
        SELECT tasks.* FROM tasks
        JOIN projects ON projects.id = tasks.project_id
        WHERE tasks.id = ? AND projects.owner_id = ?
        """,
        (task_id, owner_id),
    ).fetchone()


def parse_date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        return None


# --------------------------------------------------------------------- auth
@app.post("/api/auth/register")
def register():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not name or not email or not password:
        return jsonify(error="name, email, and password are required"), 400
    if len(password) < 6:
        return jsonify(error="password must be at least 6 characters"), 400

    conn = get_connection()
    try:
        if conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
            return jsonify(error="an account with that email already exists"), 409

        password_hash = generate_password_hash(password)
        cur = conn.execute(
            "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
            (name, email, password_hash),
        )
        user_id = cur.lastrowid

        # Seed a starter project so a new account isn't empty.
        cur = conn.execute(
            "INSERT INTO projects (name, description, color, owner_id) "
            "VALUES (?, ?, ?, ?)",
            (
                "Getting Started",
                "A sample project to show how TaskFlow works.",
                "#6366f1",
                user_id,
            ),
        )
        project_id = cur.lastrowid
        conn.execute(
            "INSERT INTO tasks (title, notes, status, priority, project_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                "Create your first real project",
                "Use the + button on the dashboard.",
                "todo",
                "medium",
                project_id,
            ),
        )
        conn.commit()

        user_row = conn.execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        token = create_token(user_id)
        return jsonify(token=token, user=user_to_dict(user_row)), 201
    finally:
        conn.close()


@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    conn = get_connection()
    try:
        user_row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        ).fetchone()
        if not user_row or not check_password_hash(user_row["password_hash"], password):
            return jsonify(error="invalid email or password"), 401

        token = create_token(user_row["id"])
        return jsonify(token=token, user=user_to_dict(user_row))
    finally:
        conn.close()


@app.get("/api/auth/me")
@login_required
def me():
    conn = get_connection()
    try:
        user_row = conn.execute(
            "SELECT * FROM users WHERE id = ?", (g.user_id,)
        ).fetchone()
        return jsonify(user=user_to_dict(user_row))
    finally:
        conn.close()


# ---------------------------------------------------------------- projects
@app.get("/api/projects")
@login_required
def list_projects():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT p.*, "
            "  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count, "
            "  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count "
            "FROM projects p WHERE p.owner_id = ? ORDER BY p.created_at DESC",
            (g.user_id,),
        ).fetchall()
        return jsonify(projects=[dict(r) for r in rows])
    finally:
        conn.close()


@app.post("/api/projects")
@login_required
def create_project():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="name is required"), 400

    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO projects (name, description, color, owner_id) VALUES (?, ?, ?, ?)",
            (
                name,
                (data.get("description") or "").strip(),
                data.get("color") or "#6366f1",
                g.user_id,
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT *, 0 AS task_count, 0 AS done_count FROM projects WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
        return jsonify(project=dict(row)), 201
    finally:
        conn.close()


@app.get("/api/projects/<int:project_id>")
@login_required
def get_project(project_id):
    conn = get_connection()
    try:
        project = owned_project(conn, project_id, g.user_id)
        if not project:
            return jsonify(error="project not found"), 404
        tasks = conn.execute(
            "SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC",
            (project_id,),
        ).fetchall()
        return jsonify(project=project_to_dict(project, tasks))
    finally:
        conn.close()


@app.put("/api/projects/<int:project_id>")
@login_required
def update_project(project_id):
    conn = get_connection()
    try:
        project = owned_project(conn, project_id, g.user_id)
        if not project:
            return jsonify(error="project not found"), 404

        data = request.get_json(silent=True) or {}
        fields = {k: data[k] for k in ("name", "description", "color") if k in data}
        if fields:
            set_clause = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(
                f"UPDATE projects SET {set_clause} WHERE id = ?",
                (*fields.values(), project_id),
            )
            conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return jsonify(project=dict(row))
    finally:
        conn.close()


@app.delete("/api/projects/<int:project_id>")
@login_required
def delete_project(project_id):
    conn = get_connection()
    try:
        project = owned_project(conn, project_id, g.user_id)
        if not project:
            return jsonify(error="project not found"), 404
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
        return jsonify(message="project deleted")
    finally:
        conn.close()


# ------------------------------------------------------------------- tasks
@app.post("/api/projects/<int:project_id>/tasks")
@login_required
def create_task(project_id):
    conn = get_connection()
    try:
        project = owned_project(conn, project_id, g.user_id)
        if not project:
            return jsonify(error="project not found"), 404

        data = request.get_json(silent=True) or {}
        title = (data.get("title") or "").strip()
        if not title:
            return jsonify(error="title is required"), 400
        status = data.get("status", "todo")
        priority = data.get("priority", "medium")
        if status not in STATUSES:
            return jsonify(error=f"status must be one of {STATUSES}"), 400
        if priority not in PRIORITIES:
            return jsonify(error=f"priority must be one of {PRIORITIES}"), 400

        cur = conn.execute(
            "INSERT INTO tasks (title, notes, status, priority, due_date, project_id) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                title,
                (data.get("notes") or "").strip(),
                status,
                priority,
                parse_date(data.get("due_date")),
                project_id,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
        return jsonify(task=dict(row)), 201
    finally:
        conn.close()


@app.put("/api/tasks/<int:task_id>")
@login_required
def update_task(task_id):
    conn = get_connection()
    try:
        task = owned_task(conn, task_id, g.user_id)
        if not task:
            return jsonify(error="task not found"), 404

        data = request.get_json(silent=True) or {}
        if "status" in data and data["status"] not in STATUSES:
            return jsonify(error=f"status must be one of {STATUSES}"), 400
        if "priority" in data and data["priority"] not in PRIORITIES:
            return jsonify(error=f"priority must be one of {PRIORITIES}"), 400

        fields = {k: data[k] for k in ("title", "notes", "status", "priority") if k in data}
        if "due_date" in data:
            fields["due_date"] = parse_date(data.get("due_date"))
        if fields:
            fields["updated_at"] = "datetime('now')"
            set_clause = ", ".join(
                f"{k} = {v if k == 'updated_at' else '?'}" for k, v in fields.items()
            )
            values = [v for k, v in fields.items() if k != "updated_at"]
            conn.execute(f"UPDATE tasks SET {set_clause} WHERE id = ?", (*values, task_id))
            conn.commit()

        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return jsonify(task=dict(row))
    finally:
        conn.close()


@app.delete("/api/tasks/<int:task_id>")
@login_required
def delete_task(task_id):
    conn = get_connection()
    try:
        task = owned_task(conn, task_id, g.user_id)
        if not task:
            return jsonify(error="task not found"), 404
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
        return jsonify(message="task deleted")
    finally:
        conn.close()


@app.get("/api/health")
def health():
    return jsonify(status="ok")


init_db()

if __name__ == "__main__":
    app.run(debug=True, port=5001)
