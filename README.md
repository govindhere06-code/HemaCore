# HemaCore — Blood Bank Management System

A web app for managing a blood bank: donors, blood stock, blood requests and donation offers, with separate portals for administrators and users.

## Project structure

```
backend/    Flask REST API + MySQL
frontend/   Admin and user portals (HTML, CSS, JavaScript)
```

| Backend file | Purpose |
|---|---|
| `run.py` | Starts the API server on port 5000 |
| `db.py` | MySQL connection |
| `auth.py` | Register, login, profile, change password |
| `donors.py` | Donor records |
| `inventory.py` | Blood stock |
| `requests.py` | Blood requests |
| `donations.py` | Donation offers |
| `schema.sql` | Database tables |
| `create_admin.py` | Creates the first admin account |

| Frontend file | Purpose |
|---|---|
| `admin.html`, `admin.js` | Admin portal |
| `user.html`, `user.js` | User portal |
| `api.js` | Shared API helpers |

## Setup

Requires Python 3 and MySQL 8.

1. Create a virtual environment and install the dependencies:
   ```
   python -m venv venv
   venv\Scripts\python -m pip install -r backend/requirements.txt
   ```
2. Copy `backend/.env.example` to `backend/.env` and fill in your MySQL password and a random JWT secret.
3. Create the database:
   ```
   mysql -u root -p < backend/schema.sql
   ```
4. Create the admin account:
   ```
   venv\Scripts\python backend/create_admin.py
   ```

## Running

Start the API (port 5000):
```
venv\Scripts\python backend/run.py
```

Serve the frontend (port 8000), in a second terminal:
```
venv\Scripts\python -m http.server 8000 --directory frontend
```

Then open:
- Admin portal: http://localhost:8000/admin.html
- User portal: http://localhost:8000/user.html
