"""One-time migration: replaces the old 'staff' role with a proper 'user' role.

Databases created before this change stored everyone who signed up as 'staff'. This script
converts them to 'user' and limits the role column to 'admin' and 'user'. Admin accounts are
not touched. Safe to run more than once.

Run from the project folder:  venv\\Scripts\\python backend\\migrate_user_role.py
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
cur = db.cursor()

cur.execute("SHOW COLUMNS FROM users LIKE 'role'")
column_type = cur.fetchone()[1]
if column_type == "enum('admin','user')":
    print("Role column already uses 'admin' / 'user' - nothing to do.")
else:
    # Allow both old and new values while the rows are converted
    cur.execute("ALTER TABLE users MODIFY role ENUM('admin','staff','user') NULL DEFAULT 'user'")
    cur.execute("UPDATE users SET role = 'user' WHERE role = 'staff' OR role IS NULL")
    converted = cur.rowcount
    cur.execute("ALTER TABLE users MODIFY role ENUM('admin','user') NOT NULL DEFAULT 'user'")
    db.commit()
    print(f"Converted {converted} account(s) from 'staff' to 'user'; role column is now 'admin' / 'user'.")

cur.execute("SELECT role, COUNT(*) FROM users GROUP BY role")
for role, count in cur.fetchall():
    print(f"  {role}: {count}")
