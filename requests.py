from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from db import get_db

requests_bp = Blueprint("requests", __name__)

VALID_STATUSES = ("pending", "approved", "fulfilled", "rejected")


@requests_bp.route("/", methods=["GET"])
@jwt_required()
def list_requests():
    status = request.args.get("status")
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        if status:
            cur.execute("SELECT * FROM blood_requests WHERE status = %s ORDER BY created_at DESC", (status,))
        else:
            cur.execute("SELECT * FROM blood_requests ORDER BY created_at DESC")
        return jsonify(cur.fetchall()), 200
    finally:
        cur.close()
        db.close()


@requests_bp.route("/<int:request_id>", methods=["GET"])
@jwt_required()
def get_request(request_id):
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT * FROM blood_requests WHERE id = %s", (request_id,))
        req = cur.fetchone()
        if not req:
            return jsonify({"error": "Request not found"}), 404
        return jsonify(req), 200
    finally:
        cur.close()
        db.close()


@requests_bp.route("/", methods=["POST"])
@jwt_required()
def create_request():
    data       = request.get_json()
    blood_type = data.get("blood_type")
    units      = data.get("units", 0)
    patient    = data.get("patient_name", "").strip()
    hospital   = data.get("hospital", "").strip()
    if not all([blood_type, units > 0, patient, hospital]):
        return jsonify({"error": "All fields are required"}), 400
    created_by = get_jwt_identity()
    db  = get_db()
    cur = db.cursor()
    try:
        cur.execute(
            """INSERT INTO blood_requests
               (blood_type, units, patient_name, hospital, status, created_by)
               VALUES (%s, %s, %s, %s, 'pending', %s)""",
            (blood_type, units, patient, hospital, created_by),
        )
        db.commit()
        return jsonify({"message": "Request submitted", "id": cur.lastrowid}), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()


@requests_bp.route("/<int:request_id>/status", methods=["PATCH"])
@jwt_required()
def update_status(request_id):
    data      = request.get_json()
    new_status = data.get("status")
    if new_status not in VALID_STATUSES:
        return jsonify({"error": f"status must be one of {VALID_STATUSES}"}), 400

    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        # Fetch the current request
        cur.execute("SELECT * FROM blood_requests WHERE id = %s", (request_id,))
        req = cur.fetchone()
        if not req:
            return jsonify({"error": "Request not found"}), 404

        old_status = req["status"]

        # ── INVENTORY LOGIC ───────────────────────────────────────────────────
        # Deduct inventory when moving to 'approved' OR 'fulfilled'
        # (only once — guard against double-deduction)
        deduct_on = {"approved", "fulfilled"}
        already_deducted = old_status in deduct_on  # already deducted at a prior step

        if new_status in deduct_on and not already_deducted:
            blood_type = req["blood_type"]
            units      = req["units"]

            # Check available stock
            cur.execute(
                "SELECT units_available FROM blood_inventory WHERE blood_type = %s FOR UPDATE",
                (blood_type,)
            )
            inv = cur.fetchone()
            if not inv:
                return jsonify({"error": f"Blood type {blood_type} not found in inventory"}), 404
            if inv["units_available"] < units:
                return jsonify({
                    "error": f"Insufficient stock. Requested {units} units of {blood_type} "
                             f"but only {inv['units_available']} available."
                }), 409

            # Deduct
            cur2 = db.cursor()
            cur2.execute(
                "UPDATE blood_inventory SET units_available = units_available - %s WHERE blood_type = %s",
                (units, blood_type)
            )
            cur2.close()

        # ── RESTORE INVENTORY if rejecting a previously approved request ─────
        if new_status == "rejected" and old_status in deduct_on:
            blood_type = req["blood_type"]
            units      = req["units"]
            cur2 = db.cursor()
            cur2.execute(
                "UPDATE blood_inventory SET units_available = units_available + %s WHERE blood_type = %s",
                (units, blood_type)
            )
            cur2.close()

        # ── UPDATE STATUS ─────────────────────────────────────────────────────
        cur2 = db.cursor()
        cur2.execute(
            "UPDATE blood_requests SET status = %s WHERE id = %s",
            (new_status, request_id)
        )
        cur2.close()

        db.commit()
        return jsonify({"message": f"Status updated to '{new_status}'"}), 200

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()


@requests_bp.route("/<int:request_id>", methods=["DELETE"])
@jwt_required()
def delete_request(request_id):
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        # If an approved/fulfilled request is deleted, restore inventory
        cur.execute("SELECT * FROM blood_requests WHERE id = %s", (request_id,))
        req = cur.fetchone()
        if not req:
            return jsonify({"error": "Request not found"}), 404

        if req["status"] in ("approved", "fulfilled"):
            cur2 = db.cursor()
            cur2.execute(
                "UPDATE blood_inventory SET units_available = units_available + %s WHERE blood_type = %s",
                (req["units"], req["blood_type"])
            )
            cur2.close()

        cur2 = db.cursor()
        cur2.execute("DELETE FROM blood_requests WHERE id = %s", (request_id,))
        cur2.close()

        db.commit()
        return jsonify({"message": "Request deleted"}), 200
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()
