from datetime import date
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from db import get_db, BLOOD_TYPES
from auth import current_user, admin_required
from notifications import notify, notify_admins

# What the donor is told when an admin changes their offer's status
STATUS_NOTICES = {
    "approved":  ("success", "Donation offer approved",
                  "Thank you! Your offer to donate {units} unit(s) of {bt} on {date} ({time}) was approved. See you then."),
    "completed": ("success", "Donation completed",
                  "Your donation of {units} unit(s) of {bt} has been recorded. Thank you for saving lives!"),
    "rejected":  ("danger", "Donation offer declined",
                  "Your offer to donate {units} unit(s) of {bt} on {date} could not be accepted. Please contact the blood bank."),
}

donations_bp = Blueprint("donations", __name__)

VALID_STATUSES = ("pending", "approved", "rejected", "completed")

# Offer rows plus the offering user's contact details
OFFER_SELECT = """
    SELECT d.*, u.name AS user_name, u.email AS user_email, u.phone AS user_phone
    FROM donation_offers d
    LEFT JOIN users u ON u.id = d.user_id
"""


@donations_bp.route("/", methods=["GET"])
@jwt_required()
def list_donations():
    """Admin gets all; regular user gets their own via query param or filtered client-side."""
    status  = request.args.get("status")
    user_id = request.args.get("user_id")
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        query  = OFFER_SELECT
        params = []
        conditions = []
        if status:
            conditions.append("d.status = %s")
            params.append(status)
        if user_id:
            conditions.append("d.user_id = %s")
            params.append(user_id)
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY d.created_at DESC"
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
        cur.execute(OFFER_SELECT + " WHERE d.id = %s", (donation_id,))
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
        new_id = cur.lastrowid
        cur.execute("SELECT name FROM users WHERE id = %s", (user_id,))
        donor = cur.fetchone()
        try:
            when = date.fromisoformat(pref_date).strftime("%d %b %Y")
        except (TypeError, ValueError):
            when = pref_date
        notify_admins(db, "New donation offer",
                      f"{donor[0] if donor else 'A donor'} offered {units} unit{'s' if units != 1 else ''} "
                      f"of {blood_type} on {when} ({pref_time}).",
                      "info", "donations")
        db.commit()
        return jsonify({"message": "Donation offer submitted", "id": new_id}), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()


def owner_check(offer, user):
    """Non-admins may only change their own offers, and only while pending."""
    if user["role"] == "admin":
        return None
    if str(offer["user_id"]) != str(user["id"]):
        return jsonify({"error": "You can only change your own donation offers"}), 403
    if offer["status"] != "pending":
        return jsonify({"error": f"This offer is already {offer['status']} and can no longer be changed"}), 409
    return None


@donations_bp.route("/<int:donation_id>", methods=["PUT"])
@jwt_required()
def edit_donation(donation_id):
    data      = request.get_json()
    blood     = data.get("blood_type")
    units     = data.get("units")
    pref_date = data.get("preferred_date")
    pref_time = (data.get("preferred_time") or "").strip()
    notes     = (data.get("notes") or "").strip()
    if blood not in BLOOD_TYPES or not isinstance(units, int) or units <= 0 or not pref_date or not pref_time:
        return jsonify({"error": "A valid blood type, positive units, preferred date and time are required"}), 400

    user = current_user()
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT * FROM donation_offers WHERE id = %s", (donation_id,))
        offer = cur.fetchone()
        if not offer:
            return jsonify({"error": "Donation offer not found"}), 404
        denied = owner_check(offer, user)
        if denied:
            return denied
        # Approval already added the units to stock, so only the schedule can change after that
        if offer["status"] not in ("pending", "approved"):
            return jsonify({"error": f"A {offer['status']} offer can no longer be edited"}), 409
        if offer["status"] == "approved" and (blood != offer["blood_type"] or units != offer["units"]):
            return jsonify({"error": "Blood type and units can't change after approval — only the schedule and notes"}), 409
        cur.execute(
            """UPDATE donation_offers SET blood_type = %s, units = %s, preferred_date = %s,
               preferred_time = %s, notes = %s WHERE id = %s""",
            (blood, units, pref_date, pref_time, notes, donation_id),
        )
        db.commit()
        return jsonify({"message": "Donation offer updated"}), 200
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()


@donations_bp.route("/<int:donation_id>/status", methods=["PATCH"])
@admin_required
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

        if status != offer["status"] and status in STATUS_NOTICES:
            type_, title, text = STATUS_NOTICES[status]
            pref = offer["preferred_date"]
            notify(db, [offer["user_id"]], title,
                   text.format(units=offer["units"], bt=offer["blood_type"],
                               date=pref.strftime("%d %b %Y") if pref else "the chosen date",
                               time=offer["preferred_time"] or "any time"),
                   type_, "donate")

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
    user = current_user()
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT * FROM donation_offers WHERE id = %s", (donation_id,))
        offer = cur.fetchone()
        if not offer:
            return jsonify({"error": "Donation offer not found"}), 404
        denied = owner_check(offer, user)
        if denied:
            return denied
        cur.execute("DELETE FROM donation_offers WHERE id = %s", (donation_id,))
        db.commit()
        if cur.rowcount == 0:
            return jsonify({"error": "Donation offer not found"}), 404
        return jsonify({"message": "Donation offer deleted"}), 200
    finally:
        cur.close()
        db.close()
