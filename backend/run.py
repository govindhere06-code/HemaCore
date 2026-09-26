from flask import Flask
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
import os

load_dotenv()

from auth import auth_bp
from donors import donors_bp
from inventory import inventory_bp
from requests import requests_bp
from donations import donations_bp   # ← new
from reports import reports_bp

app = Flask(__name__)
app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "change-me")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES", 3600))

CORS(app)
JWTManager(app)

app.register_blueprint(auth_bp,      url_prefix="/api/auth")
app.register_blueprint(donors_bp,    url_prefix="/api/donors")
app.register_blueprint(inventory_bp, url_prefix="/api/inventory")
app.register_blueprint(requests_bp,  url_prefix="/api/requests")
app.register_blueprint(donations_bp, url_prefix="/api/donations")  # ← new
app.register_blueprint(reports_bp,   url_prefix="/api/reports")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
