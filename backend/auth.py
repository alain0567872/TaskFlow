"""JWT authentication helpers (hand-rolled on top of PyJWT).

Provides create_token()/decode_token() plus a @login_required decorator
that resolves the current user id onto flask.g.user_id.
"""
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import g, jsonify, request

SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-secret-change-me")
ALGORITHM = "HS256"
TOKEN_TTL = timedelta(days=7)


def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + TOKEN_TTL,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload["sub"]), None
    except jwt.ExpiredSignatureError:
        return None, "token expired"
    except jwt.InvalidTokenError:
        return None, "invalid token"


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify(error="missing bearer token"), 401

        token = auth_header.split(" ", 1)[1].strip()
        user_id, err = decode_token(token)
        if err:
            return jsonify(error=err), 401

        g.user_id = user_id
        return view(*args, **kwargs)

    return wrapper
