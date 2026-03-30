from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from db import get_db

donations_bp = Blueprint("donations", __name__)

VALID_STATUSES = ("pending", "approved", "rejected", "completed")


@donations_bp.route("/", methods=["GET"])
@jwt_required()
def list_donations():
    """Admin gets all; regular user gets their own via query param or filtered client-side."""
    status  = request.args.get("status")
    user_id = request.args.get("user_id")
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        query  = "SELECT * FROM donation_offers"
        params = []
        conditions = []
        if status:
            conditions.append("status = %s")
            params.append(status)
        if user_id:
            conditions.append("user_id = %s")
            params.append(user_id)
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY created_at DESC"
        cur.execute(query, params)
        return jsonify(cur.fetchall()), 200
    finally:
        cur.close()
        db.close()


@donations_bp.route("/<int:donation_id>", methods=["GET"])
@jwt_required()
def get_donation(donation_id):
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT * FROM donation_offers WHERE id = %s", (donation_id,))
        record = cur.fetchone()
        if not record:
            return jsonify({"error": "Donation offer not found"}), 404
        return jsonify(record), 200
    finally:
        cur.close()
        db.close()


@donations_bp.route("/", methods=["POST"])
@jwt_required()
def create_donation():
    data       = request.get_json()
    blood_type = data.get("blood_type")
    units      = data.get("units", 1)
    pref_date  = data.get("preferred_date")
    pref_time  = data.get("preferred_time")
    notes      = data.get("notes", "")
    user_id    = get_jwt_identity()

    if not blood_type or not pref_date or not pref_time:
        return jsonify({"error": "blood_type, preferred_date and preferred_time are required"}), 400
    if units <= 0:
        return jsonify({"error": "units must be positive"}), 400

    db  = get_db()
    cur = db.cursor()
    try:
        cur.execute(
            """INSERT INTO donation_offers
               (user_id, blood_type, units, preferred_date, preferred_time, notes, status)
               VALUES (%s, %s, %s, %s, %s, %s, 'pending')""",
            (user_id, blood_type, units, pref_date, pref_time, notes),
        )
        db.commit()
        return jsonify({"message": "Donation offer submitted", "id": cur.lastrowid}), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()


@donations_bp.route("/<int:donation_id>/status", methods=["PATCH"])
@jwt_required()
def update_donation_status(donation_id):
    data   = request.get_json()
    status = data.get("status")
    if status not in VALID_STATUSES:
        return jsonify({"error": f"status must be one of {VALID_STATUSES}"}), 400

    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT * FROM donation_offers WHERE id = %s", (donation_id,))
        offer = cur.fetchone()
        if not offer:
            return jsonify({"error": "Donation offer not found"}), 404

        cur2 = db.cursor()
        cur2.execute("UPDATE donation_offers SET status = %s WHERE id = %s", (status, donation_id))

        # If approved → add donor to donors table (if not already) and increment inventory
        if status == "approved":
            # Upsert donor record using user info
            cur2.execute(
                """INSERT INTO donors (name, blood_type, phone, email, last_donation_date)
                   SELECT u.name, %s, COALESCE(u.phone,'N/A'), u.email, CURDATE()
                   FROM users u WHERE u.id = %s
                   ON DUPLICATE KEY UPDATE
                     blood_type = VALUES(blood_type),
                     last_donation_date = VALUES(last_donation_date)""",
                (offer["blood_type"], offer["user_id"]),
            )
            # Add units to inventory
            cur2.execute(
                """INSERT INTO blood_inventory (blood_type, units_available)
                   VALUES (%s, %s)
                   ON DUPLICATE KEY UPDATE units_available = units_available + VALUES(units_available)""",
                (offer["blood_type"], offer["units"]),
            )
            cur2.close()

        db.commit()
        return jsonify({"message": f"Donation offer status updated to '{status}'"}), 200
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()


@donations_bp.route("/<int:donation_id>", methods=["DELETE"])
@jwt_required()
def delete_donation(donation_id):
    db  = get_db()
    cur = db.cursor()
    try:
        cur.execute("DELETE FROM donation_offers WHERE id = %s", (donation_id,))
        db.commit()
        if cur.rowcount == 0:
            return jsonify({"error": "Donation offer not found"}), 404
        return jsonify({"message": "Donation offer deleted"}), 200
    finally:
        cur.close()
        db.close()
