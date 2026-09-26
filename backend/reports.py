from datetime import date
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from db import get_db, BLOOD_TYPES
from auth import current_user

reports_bp = Blueprint("reports", __name__)

DONATION_GAP_DAYS = 56
LOW_STOCK = 10
ISSUED = ("approved", "fulfilled")        # request statuses where stock was issued
ACCEPTED = ("approved", "completed")      # donation statuses where stock was received


def parse_date(value, default):
    try:
        return date.fromisoformat(value) if value else default
    except ValueError:
        return None


@reports_bp.route("/", methods=["GET"])
@jwt_required()
def summary():
    """All report figures for requests and donations submitted between ?from= and ?to= (inclusive)."""
    user = current_user()
    if not user or user["role"] != "admin":
        return jsonify({"error": "Reports are available to admins only"}), 403

    start = parse_date(request.args.get("from"), date(2000, 1, 1))
    end   = parse_date(request.args.get("to"), date.today())
    if not start or not end:
        return jsonify({"error": "Dates must be in YYYY-MM-DD format"}), 400
    if start > end:
        return jsonify({"error": "'From' date must be on or before 'To' date"}), 400
    period = (start, end)

    db  = get_db()
    cur = db.cursor(dictionary=True)
    try:
        def rows(sql, params=()):
            cur.execute(sql, params)
            return cur.fetchall()

        # ── Stock (current, not date-filtered) ──
        stock = {r["blood_type"]: r["units_available"] for r in rows("SELECT blood_type, units_available FROM blood_inventory")}
        demand = {r["blood_type"]: int(r["units"]) for r in rows(
            "SELECT blood_type, SUM(units) AS units FROM blood_requests WHERE status = 'pending' GROUP BY blood_type")}
        stock_report = []
        for bt in BLOOD_TYPES:
            units, pending = stock.get(bt, 0), demand.get(bt, 0)
            after = units - pending
            stock_report.append({
                "blood_type": bt, "in_stock": units, "pending_demand": pending, "after_pending": after,
                "level": "Short" if after < 0 else "Out of stock" if units == 0 else "Low" if units <= LOW_STOCK else "Healthy",
            })

        # ── Requests submitted in the period ──
        req_where = "DATE(created_at) BETWEEN %s AND %s"
        req_by_status = rows(f"""SELECT status, COUNT(*) AS requests, SUM(units) AS units
                                 FROM blood_requests WHERE {req_where} GROUP BY status""", period)
        req_by_type = rows(f"""SELECT blood_type, COUNT(*) AS requests, SUM(units) AS units_requested,
                                      SUM(CASE WHEN status IN ('approved','fulfilled') THEN units ELSE 0 END) AS units_issued
                               FROM blood_requests WHERE {req_where} GROUP BY blood_type""", period)
        req_by_hospital = rows(f"""SELECT hospital, COUNT(*) AS requests, SUM(units) AS units
                                   FROM blood_requests WHERE {req_where}
                                   GROUP BY hospital ORDER BY requests DESC, units DESC LIMIT 10""", period)
        req_by_day = rows(f"""SELECT DATE(created_at) AS day, COUNT(*) AS requests, SUM(units) AS units
                              FROM blood_requests WHERE {req_where} GROUP BY day ORDER BY day""", period)

        # ── Donation offers submitted in the period ──
        don_where = "DATE(d.created_at) BETWEEN %s AND %s"
        don_by_status = rows(f"""SELECT status, COUNT(*) AS offers, SUM(units) AS units
                                 FROM donation_offers d WHERE {don_where} GROUP BY status""", period)
        don_by_type = rows(f"""SELECT blood_type, COUNT(*) AS offers,
                                      SUM(CASE WHEN status IN ('approved','completed') THEN units ELSE 0 END) AS units_received
                               FROM donation_offers d WHERE {don_where} GROUP BY blood_type""", period)
        top_donors = rows(f"""SELECT u.name, u.email, COUNT(*) AS offers,
                                     SUM(CASE WHEN d.status IN ('approved','completed') THEN d.units ELSE 0 END) AS units_received
                              FROM donation_offers d JOIN users u ON u.id = d.user_id
                              WHERE {don_where}
                              GROUP BY u.id, u.name, u.email
                              ORDER BY units_received DESC, offers DESC LIMIT 10""", period)

        # ── Donors (current register, not date-filtered) ──
        donors_by_type = rows(f"""SELECT blood_type, COUNT(*) AS donors,
                                         SUM(CASE WHEN last_donation_date IS NULL
                                                    OR last_donation_date <= CURDATE() - INTERVAL {DONATION_GAP_DAYS} DAY
                                             THEN 1 ELSE 0 END) AS eligible_now
                                  FROM donors GROUP BY blood_type""")
        new_donors = rows(f"SELECT COUNT(*) AS n FROM donors WHERE DATE(created_at) BETWEEN %s AND %s", period)[0]["n"]

        # Fill in every blood type so tables always show all eight, in a fixed order
        def by_type(data, zero):
            found = {r["blood_type"]: r for r in data}
            return [{"blood_type": bt, **{k: int(found[bt][k] or 0) if bt in found else 0 for k in zero}} for bt in BLOOD_TYPES]

        def num(data, *keys):
            return [{**r, **{k: int(r[k] or 0) for k in keys}} for r in data]

        req_by_status = num(req_by_status, "requests", "units")
        don_by_status = num(don_by_status, "offers", "units")
        total = lambda data, key, statuses=None: sum(r[key] for r in data if statuses is None or r["status"] in statuses)

        requests_total = total(req_by_status, "requests")
        decided = total(req_by_status, "requests", ("approved", "fulfilled", "rejected"))
        issued_reqs = total(req_by_status, "requests", ISSUED)

        return jsonify({
            "period": {"from": start.isoformat(), "to": end.isoformat()},
            "totals": {
                "requests": requests_total,
                "units_requested": total(req_by_status, "units"),
                "units_issued": total(req_by_status, "units", ISSUED),
                "approval_rate": round(issued_reqs / decided * 100) if decided else None,
                "offers": total(don_by_status, "offers"),
                "units_received": total(don_by_status, "units", ACCEPTED),
                "new_donors": int(new_donors),
                "units_in_stock": sum(stock.values()),
            },
            "stock": stock_report,
            "requests_by_status": req_by_status,
            "requests_by_type": by_type(req_by_type, ("requests", "units_requested", "units_issued")),
            "requests_by_hospital": num(req_by_hospital, "requests", "units"),
            "requests_by_day": [{"day": r["day"].isoformat(), "requests": int(r["requests"]), "units": int(r["units"] or 0)} for r in req_by_day],
            "donations_by_status": don_by_status,
            "donations_by_type": by_type(don_by_type, ("offers", "units_received")),
            "top_donors": num(top_donors, "offers", "units_received"),
            "donors_by_type": by_type(donors_by_type, ("donors", "eligible_now")),
        }), 200
    finally:
        cur.close()
        db.close()
