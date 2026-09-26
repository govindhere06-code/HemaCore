from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from db import get_db, BLOOD_TYPES
from auth import current_user, admin_required
from notifications import notify, notify_admins, check_low_stock

# What the requester is told when an admin changes their request's status
STATUS_NOTICES = {
    "approved":  ("success", "Blood request approved",
                  "Your request for {units} unit(s) of {bt} for {patient} was approved. The blood has been reserved."),
    "fulfilled": ("success", "Blood request fulfilled",
                  "Your request for {units} unit(s) of {bt} for {patient} has been fulfilled."),
    "rejected":  ("danger", "Blood request rejected",
                  "Your request for {units} unit(s) of {bt} for {patient} was rejected. Please contact the blood bank."),
}

requests_bp = Blueprint("requests", __name__)

VALID_STATUSES = ("pending", "approved", "fulfilled", "rejected")

# Request rows plus the requesting user's contact details
REQUEST_SELECT = """
    SELECT r.*, u.name AS requester_name, u.email AS requester_email, u.phone AS requester_phone
    FROM blood_requests r
    LEFT JOIN users u ON u.id = r.created_by
"""


@requests_bp.route("/", methods=["GET"])
@jwt_required()
def list_requests():
    status = request.args.get("status")
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        if status:
            cur.execute(REQUEST_SELECT + " WHERE r.status = %s ORDER BY r.created_at DESC", (status,))
        else:
            cur.execute(REQUEST_SELECT + " ORDER BY r.created_at DESC")
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
        cur.execute(REQUEST_SELECT + " WHERE r.id = %s", (request_id,))
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
        new_id = cur.lastrowid
        notify_admins(db, "New blood request",
                      f"{units} unit{'s' if units != 1 else ''} of {blood_type} for {patient} at {hospital}.",
                      "info", "requests")
        db.commit()
        return jsonify({"message": "Request submitted", "id": new_id}), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()


def owner_check(req, user):
    """Non-admins may only change their own requests, and only while pending."""
    if user["role"] == "admin":
        return None
    if str(req["created_by"]) != str(user["id"]):
        return jsonify({"error": "You can only change your own requests"}), 403
    if req["status"] != "pending":
        return jsonify({"error": f"This request is already {req['status']} and can no longer be changed"}), 409
    return None


@requests_bp.route("/<int:request_id>", methods=["PUT"])
@jwt_required()
def edit_request(request_id):
    data     = request.get_json()
    patient  = (data.get("patient_name") or "").strip()
    hospital = (data.get("hospital") or "").strip()
    blood    = data.get("blood_type")
    units    = data.get("units")
    if not patient or not hospital or blood not in BLOOD_TYPES or not isinstance(units, int) or units <= 0:
        return jsonify({"error": "Patient, hospital, a valid blood type and positive units are required"}), 400

    user = current_user()
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT * FROM blood_requests WHERE id = %s", (request_id,))
        req = cur.fetchone()
        if not req:
            return jsonify({"error": "Request not found"}), 404
        denied = owner_check(req, user)
        if denied:
            return denied
        # Stock was already deducted for approved/fulfilled requests, so only pending ones are editable
        if req["status"] != "pending":
            return jsonify({"error": "Only pending requests can be edited"}), 409
        cur.execute(
            "UPDATE blood_requests SET patient_name = %s, hospital = %s, blood_type = %s, units = %s WHERE id = %s",
            (patient, hospital, blood, units, request_id),
        )
        db.commit()
        return jsonify({"message": "Request updated"}), 200
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()


@requests_bp.route("/<int:request_id>/status", methods=["PATCH"])
@admin_required
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
            check_low_stock(db, blood_type, inv["units_available"], inv["units_available"] - units)

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

        if new_status != old_status and new_status in STATUS_NOTICES:
            type_, title, text = STATUS_NOTICES[new_status]
            notify(db, [req["created_by"]], title,
                   text.format(units=req["units"], bt=req["blood_type"], patient=req["patient_name"]),
                   type_, "requests")

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
    user = current_user()
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        # If an approved/fulfilled request is deleted, restore inventory
        cur.execute("SELECT * FROM blood_requests WHERE id = %s", (request_id,))
        req = cur.fetchone()
        if not req:
            return jsonify({"error": "Request not found"}), 404
        denied = owner_check(req, user)
        if denied:
            return denied

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
