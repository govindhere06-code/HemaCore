from functools import wraps
from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from db import get_db, BLOOD_TYPES
import bcrypt

auth_bp = Blueprint("auth", __name__)

# Role given to everyone who signs up. Admin accounts are only created with create_admin.py.
SIGNUP_ROLE = "user"


def current_user():
    """The logged-in user's id and role, or None if the account no longer exists."""
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT id, role FROM users WHERE id = %s", (get_jwt_identity(),))
        return cur.fetchone()
    finally:
        cur.close()
        db.close()


def admin_required(fn):
    """Like @jwt_required(), but the logged-in account must also be an admin."""
    @wraps(fn)
    @jwt_required()
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user or user["role"] != "admin":
            return jsonify({"error": "Admin access required"}), 403
        return fn(*args, **kwargs)
    return wrapper


@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    name     = data.get("name", "").strip()
    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")
    phone    = (data.get("phone") or "").strip() or None
    blood    = data.get("blood_type") or None
    dob      = data.get("date_of_birth") or None
    address  = (data.get("address") or "").strip() or None
    # Any "role" sent by the client is ignored — see SIGNUP_ROLE

    if not all([name, email, password]):
        return jsonify({"error": "name, email and password are required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    if blood and blood not in BLOOD_TYPES:
        return jsonify({"error": "Invalid blood type"}), 400

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    db  = get_db()
    cur = db.cursor()
    try:
        cur.execute(
            "INSERT INTO users (name, email, password_hash, role, phone) VALUES (%s, %s, %s, %s, %s)",
            (name, email, hashed, SIGNUP_ROLE, phone),
        )
        # The new user's donor record is created here, in the same transaction,
        # because adding donors through /api/donors is admin-only. If an admin already
        # registered this person as a donor, that record is kept (one per email).
        cur.execute("SELECT id FROM donors WHERE email = %s", (email,))
        if blood and phone and not cur.fetchone():
            cur.execute(
                """INSERT INTO donors (name, blood_type, phone, email, date_of_birth, address)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (name, blood, phone, email, dob, address),
            )
        db.commit()
        return jsonify({"message": "User registered successfully"}), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 409
    finally:
        cur.close()
        db.close()

@auth_bp.route("/login", methods=["POST"])
def login():
    data     = request.get_json()
    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not all([email, password]):
        return jsonify({"error": "email and password are required"}), 400

    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT * FROM users WHERE email = %s", (email,))
        user = cur.fetchone()
        if not user or not bcrypt.checkpw(password.encode(), user["password_hash"].encode()):
            return jsonify({"error": "Invalid credentials"}), 401
        token = create_access_token(identity=str(user["id"]))
        return jsonify({"access_token": token, "role": user["role"]}), 200
    finally:
        cur.close()
        db.close()

@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    user_id = get_jwt_identity()
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT id, name, email, role, phone, created_at FROM users WHERE id = %s", (user_id,))
        user = cur.fetchone()
        if not user:
            return jsonify({"error": "User not found"}), 404
        # The donor record (if any) is linked by email
        cur.execute(
            """SELECT id, blood_type, phone, date_of_birth, address, last_donation_date
               FROM donors WHERE LOWER(email) = LOWER(%s) ORDER BY id LIMIT 1""",
            (user["email"],),
        )
        user["donor"] = cur.fetchone()
        return jsonify(user), 200
    finally:
        cur.close()
        db.close()


@auth_bp.route("/me", methods=["PUT"])
@jwt_required()
def update_me():
    """Update the logged-in user's name/phone, and their donor record's details."""
    data  = request.get_json()
    name  = (data.get("name") or "").strip()
    phone = (data.get("phone") or "").strip()
    blood = data.get("blood_type") or None
    dob   = data.get("date_of_birth") or None
    addr  = (data.get("address") or "").strip() or None

    if not name or not phone:
        return jsonify({"error": "Name and phone are required"}), 400
    if blood and blood not in BLOOD_TYPES:
        return jsonify({"error": "Invalid blood type"}), 400

    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT email FROM users WHERE id = %s", (get_jwt_identity(),))
        user = cur.fetchone()
        if not user:
            return jsonify({"error": "User not found"}), 404

        cur.execute("UPDATE users SET name = %s, phone = %s WHERE id = %s", (name, phone, get_jwt_identity()))

        cur.execute("SELECT id FROM donors WHERE LOWER(email) = LOWER(%s) ORDER BY id LIMIT 1", (user["email"],))
        donor = cur.fetchone()
        if donor:
            cur.execute(
                """UPDATE donors SET name = %s, phone = %s, blood_type = COALESCE(%s, blood_type),
                   date_of_birth = %s, address = %s WHERE id = %s""",
                (name, phone, blood, dob, addr, donor["id"]),
            )
        elif blood:
            cur.execute(
                """INSERT INTO donors (name, blood_type, phone, email, date_of_birth, address)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (name, blood, phone, user["email"], dob, addr),
            )
        db.commit()
        return jsonify({"message": "Profile updated"}), 200
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()


@auth_bp.route("/change-password", methods=["POST"])
@jwt_required()
def change_password():
    data    = request.get_json()
    current = data.get("current_password", "")
    new     = data.get("new_password", "")
    if len(new) < 6:
        return jsonify({"error": "New password must be at least 6 characters"}), 400

    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT password_hash FROM users WHERE id = %s", (get_jwt_identity(),))
        user = cur.fetchone()
        if not user or not bcrypt.checkpw(current.encode(), user["password_hash"].encode()):
            return jsonify({"error": "Current password is incorrect"}), 401
        hashed = bcrypt.hashpw(new.encode(), bcrypt.gensalt()).decode()
        cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (hashed, get_jwt_identity()))
        db.commit()
        return jsonify({"message": "Password changed"}), 200
    finally:
        cur.close()
        db.close()
