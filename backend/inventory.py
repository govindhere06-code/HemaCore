from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from db import get_db
from auth import admin_required
from notifications import check_low_stock

inventory_bp = Blueprint("inventory", __name__)

@inventory_bp.route("/", methods=["GET"])
@jwt_required()
def list_inventory():
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT * FROM blood_inventory ORDER BY blood_type")
        return jsonify(cur.fetchall()), 200
    finally:
        cur.close()
        db.close()

@inventory_bp.route("/<string:blood_type>", methods=["GET"])
@jwt_required()
def get_inventory(blood_type):
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT * FROM blood_inventory WHERE blood_type = %s", (blood_type,))
        record = cur.fetchone()
        if not record:
            return jsonify({"error": "Blood type not found"}), 404
        return jsonify(record), 200
    finally:
        cur.close()
        db.close()

@inventory_bp.route("/add", methods=["POST"])
@admin_required
def add_units():
    data       = request.get_json()
    blood_type = data.get("blood_type")
    units      = data.get("units", 0)
    if not blood_type or units <= 0:
        return jsonify({"error": "blood_type and positive units are required"}), 400
    db  = get_db()
    cur = db.cursor()
    try:
        cur.execute(
            """INSERT INTO blood_inventory (blood_type, units_available)
               VALUES (%s, %s)
               ON DUPLICATE KEY UPDATE units_available = units_available + VALUES(units_available)""",
            (blood_type, units),
        )
        db.commit()
        return jsonify({"message": f"{units} units added for {blood_type}"}), 200
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()

@inventory_bp.route("/deduct", methods=["POST"])
@admin_required
def deduct_units():
    data       = request.get_json()
    blood_type = data.get("blood_type")
    units      = data.get("units", 0)
    if not blood_type or units <= 0:
        return jsonify({"error": "blood_type and positive units are required"}), 400
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT units_available FROM blood_inventory WHERE blood_type = %s", (blood_type,))
        record = cur.fetchone()
        if not record:
            return jsonify({"error": "Blood type not found"}), 404
        if record["units_available"] < units:
            return jsonify({"error": "Insufficient units"}), 409
        cur.execute(
            "UPDATE blood_inventory SET units_available = units_available - %s WHERE blood_type = %s",
            (units, blood_type),
        )
        check_low_stock(db, blood_type, record["units_available"], record["units_available"] - units)
        db.commit()
        return jsonify({"message": f"{units} units deducted for {blood_type}"}), 200
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        db.close()

