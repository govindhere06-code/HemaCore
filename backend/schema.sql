-- Blood Bank Database Schema
-- Run: mysql -u root -p bloodbank_db < schema.sql

CREATE DATABASE IF NOT EXISTS bloodbank_db;
USE bloodbank_db;

-- ─── Users (staff / admin) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(100)                        NOT NULL,
    email         VARCHAR(150) UNIQUE                 NOT NULL,
    password_hash VARCHAR(255)                        NOT NULL,
    role          ENUM('admin', 'staff') DEFAULT 'staff',
    phone         VARCHAR(20),
    created_at    TIMESTAMP              DEFAULT CURRENT_TIMESTAMP
);

-- ─── Donors ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS donors (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    name               VARCHAR(100)                           NOT NULL,
    blood_type         ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
    phone              VARCHAR(20)                            NOT NULL,
    email              VARCHAR(150) UNIQUE,                   -- one donor record per person
    date_of_birth      DATE,
    address            TEXT,
    last_donation_date DATE,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── Blood Inventory ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blood_inventory (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    blood_type       ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') UNIQUE NOT NULL,
    units_available  INT DEFAULT 0,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed initial rows so every blood type exists
INSERT IGNORE INTO blood_inventory (blood_type, units_available) VALUES
    ('A+',0),('A-',0),('B+',0),('B-',0),
    ('AB+',0),('AB-',0),('O+',0),('O-',0);

-- ─── Blood Requests ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blood_requests (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    blood_type   ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
    units        INT                                              NOT NULL,
    patient_name VARCHAR(100)                                     NOT NULL,
    hospital     VARCHAR(150)                                     NOT NULL,
    status       ENUM('pending','approved','fulfilled','rejected') DEFAULT 'pending',
    created_by   INT,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ─── Donation Offers ─────────────────────────────────────────────────────────
-- Users submit willingness to donate; admins approve/reject.
-- On approval: donor is upserted into `donors` and inventory is auto-incremented.
CREATE TABLE IF NOT EXISTS donation_offers (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    user_id        INT NOT NULL,
    blood_type     ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
    units          INT          DEFAULT 1,
    preferred_date DATE,
    preferred_time VARCHAR(50),
    notes          TEXT,
    status         ENUM('pending','approved','rejected','completed') DEFAULT 'pending',
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─── Notifications ────────────────────────────────────────────────────────────
-- One row per recipient. `link` names the portal page the notification opens.
CREATE TABLE IF NOT EXISTS notifications (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT          NOT NULL,
    title      VARCHAR(150) NOT NULL,
    message    VARCHAR(500) NOT NULL,
    type       ENUM('info','success','warning','danger') DEFAULT 'info',
    link       VARCHAR(50),
    is_read    BOOLEAN   DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_unread (user_id, is_read)
);
