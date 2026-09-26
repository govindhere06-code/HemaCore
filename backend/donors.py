from flask import Blueprint, request, jsonify
from mysql.connector import IntegrityError
from db import get_db
from auth import admin_required

donors_bp = Blueprint("donors", __name__)

DUPLICATE_ENTRY = 1062   # MySQL error for breaking a UNIQUE rule (here: donor email)


def clean_email(value):
    """Blank emails are stored as NULL (no email), so they never clash with the unique rule."""
    return (value or "").strip().lower() or None

@donors_bp.route("/", methods=["GET"])
@admin_required
def list_donors():
    blood_type = request.args.get("blood_type")
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        if blood_type:
            cur.execute("SELECT * FROM donors WHERE blood_type = %s ORDER BY name", (blood_type,))
        else:
            cur.execute("SELECT * FROM donors ORDER BY name")
        return jsonify(cur.fetchall()), 200
    finally:
        cur.close()
        db.close()

@donors_bp.route("/<int:donor_id>", methods=["GET"])
@admin_required
def get_donor(donor_id):
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT * FROM donors WHERE id = %s", (donor_id,))
        donor = cur.fetchone()
        if not donor:
            return jsonify({"error": "Donor not found"}), 404
        return jsonify(donor), 200
    finally:
        cur.close()
        db.close()

@donors_bp.route("/", methods=["POST"])
@admin_required
def create_donor():
    data = request.get_json()
    required = ["name", "blood_type", "phone"]
    if not all(data.get(f) for f in required):
        return jsonify({"error": f"Required fields: {required}"}), 400
    db  = get_db()
    cur = db.cursor()
    try:
        cur.execute(
            """INSERT INTO donors (name, blood_type, phone, email, date_of_birth, address, last_donation_date)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (data["name"], data["blood_type"], data["phone"],
             clean_email(data.get("email")), data.get("date_of_birth"),
             data.get("address"), data.get("last_donation_date")),
        )
        db.commit()
        return jsonify({"message": "Donor created", "id": cur.lastrowid}), 201
    except IntegrityError as e:
        db.rollback()
        if e.errno == DUPLICATE_ENTRY:
            return jsonify({"error": "A donor with this email is already registered"}), 409
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()

@donors_bp.route("/<int:donor_id>", methods=["PUT"])
@admin_required
def update_donor(donor_id):
    data = request.get_json()
    fields = ["name", "blood_type", "phone", "email", "date_of_birth", "address", "last_donation_date"]
    updates = {f: data[f] for f in fields if f in data}
    if "email" in updates:
        updates["email"] = clean_email(updates["email"])
    if not updates:
        return jsonify({"error": "No fields to update"}), 400
    set_clause = ", ".join(f"{k} = %s" for k in updates)
    db  = get_db()
    cur = db.cursor()
    try:
        cur.execute(f"UPDATE donors SET {set_clause} WHERE id = %s", (*updates.values(), donor_id))
        db.commit()
        if cur.rowcount == 0:
            return jsonify({"error": "Donor not found"}), 404
        return jsonify({"message": "Donor updated"}), 200
    except IntegrityError as e:
        db.rollback()
        if e.errno == DUPLICATE_ENTRY:
            return jsonify({"error": "A donor with this email is already registered"}), 409
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()

@donors_bp.route("/<int:donor_id>", methods=["DELETE"])
@admin_required
def delete_donor(donor_id):
    db  = get_db()
    cur = db.cursor()
    try:
        cur.execute("DELETE FROM donors WHERE id = %s", (donor_id,))
        db.commit()
        if cur.rowcount == 0:
            return jsonify({"error": "Donor not found"}), 404
        return jsonify({"message": "Donor deleted"}), 200
    finally:
        cur.close()
        db.close()