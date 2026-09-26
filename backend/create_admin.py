import bcrypt
import mysql.connector
import os
from dotenv import load_dotenv

load_dotenv()

db = mysql.connector.connect(
    host='127.0.0.1',
    user='root',
    password=os.getenv('DB_PASSWORD'),
    database='bloodbank_db'
)
cur = db.cursor()
hashed = bcrypt.hashpw(b'admin123', bcrypt.gensalt()).decode()
cur.execute(
    "INSERT INTO users (name, email, password_hash, role) VALUES (%s, %s, %s, %s)",
    ('Admin', 'admin@hemacore.com', hashed, 'admin')
)
db.commit()
print('Admin created!')