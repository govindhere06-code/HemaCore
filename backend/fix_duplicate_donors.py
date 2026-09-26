"""One-time maintenance script: merges duplicate donor records and adds a unique email rule.

Donors with the same email (ignoring case) are merged into the oldest record. Blank fields on
that record are filled from the duplicates, and the most recent donation date is kept.
Afterwards a UNIQUE index on donors.email stops new duplicates. Safe to run more than once.

Run from the project folder:  venv\\Scripts\\python backend\\fix_duplicate_donors.py
"""
import os
import mysql.connector
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

db = mysql.connector.connect(
    host=os.getenv("DB_HOST", "127.0.0.1"),
    port=int(os.getenv("DB_PORT", 3306)),
    user=os.getenv("DB_USER", "root"),
    password=os.getenv("DB_PASSWORD", ""),
    database=os.getenv("DB_NAME", "bloodbank_db"),
)
cur = db.cursor(dictionary=True)

# Blank emails would clash under a unique index; store them as NULL (no email) instead
cur.execute("UPDATE donors SET email = NULL WHERE TRIM(email) = ''")
blanks = cur.rowcount

cur.execute("""SELECT LOWER(email) AS email FROM donors WHERE email IS NOT NULL
               GROUP BY LOWER(email) HAVING COUNT(*) > 1""")
merged = 0
for row in cur.fetchall():
    cur.execute("SELECT * FROM donors WHERE LOWER(email) = %s ORDER BY id", (row["email"],))
    keep, *dupes = cur.fetchall()
    for field in ("date_of_birth", "address", "phone"):
        if not keep[field] or keep[field] == "N/A":
            keep[field] = next((d[field] for d in dupes if d[field] and d[field] != "N/A"), keep[field])
    dates = [d["last_donation_date"] for d in [keep, *dupes] if d["last_donation_date"]]
    cur.execute("""UPDATE donors SET date_of_birth = %s, address = %s, phone = %s, last_donation_date = %s
                   WHERE id = %s""",
                (keep["date_of_birth"], keep["address"], keep["phone"], max(dates) if dates else None, keep["id"]))
    cur.executemany("DELETE FROM donors WHERE id = %s", [(d["id"],) for d in dupes])
    merged += len(dupes)
    print(f"Merged {len(dupes)} duplicate(s) of {row['email']} into donor #{keep['id']}")

# schema.sql already declares the column UNIQUE for new databases; only older ones need the index
cur.execute("SHOW INDEX FROM donors WHERE Column_name = 'email' AND Non_unique = 0")
if not cur.fetchall():
    cur.execute("ALTER TABLE donors ADD UNIQUE KEY uq_donors_email (email)")
    print("Added unique email rule to donors")
else:
    print("Unique email rule already present")

db.commit()
print(f"Done: {merged} duplicate record(s) merged, {blanks} blank email(s) cleared.")
