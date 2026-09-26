from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from db import get_db

notifications_bp = Blueprint("notifications", __name__)

LOW_STOCK = 10


# ── Helpers used by other modules ─────────────────────────────────────────────
# They write through the caller's connection so the notification is saved in
# the same transaction as the change it describes.

def notify(db, user_ids, title, message, type_="info", link=None):
    ids = [i for i in dict.fromkeys(user_ids) if i]
    if not ids:
        return
    cur = db.cursor()
    cur.executemany(
        "INSERT INTO notifications (user_id, title, message, type, link) VALUES (%s, %s, %s, %s, %s)",
        [(i, title, message, type_, link) for i in ids],
    )
    cur.close()


def notify_admins(db, title, message, type_="info", link=None):
    cur = db.cursor()
    cur.execute("SELECT id FROM users WHERE role = 'admin'")
    ids = [r[0] for r in cur.fetchall()]
    cur.close()
    notify(db, ids, title, message, type_, link)


def check_low_stock(db, blood_type, before, after):
    """Alert admins when stock crosses into low or runs out (not on every deduction)."""
    if after <= 0 < before:
        notify_admins(db, f"{blood_type} is out of stock",
                      f"All {blood_type} units have been used. Restock as soon as possible.", "danger", "inventory")
    elif after <= LOW_STOCK < before:
        notify_admins(db, f"{blood_type} stock is low",
                      f"Only {after} unit{'s' if after != 1 else ''} of {blood_type} left.", "warning", "inventory")


# ── API ───────────────────────────────────────────────────────────────────────

@notifications_bp.route("/", methods=["GET"])
@jwt_required()
def list_notifications():
    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        uid = get_jwt_identity()
        cur.execute(
            """SELECT id, title, message, type, link, is_read, created_at
               FROM notifications WHERE user_id = %s ORDER BY created_at DESC, id DESC LIMIT 30""",
            (uid,),
        )
        items = cur.fetchall()
        for n in items:
            n["is_read"] = bool(n["is_read"])
            # MySQL stores local time; send it without a zone so the browser reads it as local
            n["created_at"] = n["created_at"].isoformat()
        cur.execute("SELECT COUNT(*) AS n FROM notifications WHERE user_id = %s AND is_read = FALSE", (uid,))
        return jsonify({"items": items, "unread": cur.fetchone()["n"]}), 200
    finally:
        cur.close()
        db.close()


@notifications_bp.route("/<int:notification_id>/read", methods=["PATCH"])
@jwt_required()
def mark_read(notification_id):
    db  = get_db()
    cur = db.cursor()
    try:
        cur.execute("UPDATE notifications SET is_read = TRUE WHERE id = %s AND user_id = %s",
                    (notification_id, get_jwt_identity()))
        db.commit()
        if cur.rowcount == 0:
            # Either not found, not yours, or already read — all fine for the caller
            return jsonify({"message": "No change"}), 200
        return jsonify({"message": "Marked as read"}), 200
    finally:
        cur.close()
        db.close()


@notifications_bp.route("/read-all", methods=["POST"])
@jwt_required()
def mark_all_read():
    db  = get_db()
    cur = db.cursor()
    try:
        cur.execute("UPDATE notifications SET is_read = TRUE WHERE user_id = %s AND is_read = FALSE", (get_jwt_identity(),))
        db.commit()
        return jsonify({"message": "All notifications marked as read", "updated": cur.rowcount}), 200
    finally:
        cur.close()
        db.close()
