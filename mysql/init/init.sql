CREATE DATABASE IF NOT EXISTS gymdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gymdb;

CREATE TABLE IF NOT EXISTS trainers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  gender VARCHAR(20) NULL,
  specialty VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(120),
  profile_photo MEDIUMTEXT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'Đang làm việc',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS packages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  duration_months INT NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Đang bán',
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(120),
  profile_photo MEDIUMTEXT NULL,
  gender VARCHAR(20) DEFAULT 'Nam',
  package_id INT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'Hoạt động',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_member_package FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  class_type VARCHAR(80) NOT NULL,
  schedule_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  room VARCHAR(50),
  trainer_id INT NULL,
  max_members INT NOT NULL DEFAULT 20,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_schedule_trainer FOREIGN KEY (trainer_id) REFERENCES trainers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO trainers (full_name, specialty, phone, email, status) VALUES
('Nguyen Minh Anh','Gym & Strength','0901000001','anh.trainer@gym.local','Đang lam viec'),
('Tran Quoc Huy','Cardio','0901000002','huy.trainer@gym.local','Đang lam viec'),
('Le Thu Ha','Yoga & Mobility','0901000003','ha.trainer@gym.local','Đang lam viec');

INSERT INTO packages (name, duration_months, price, description) VALUES
('Basic 1 tháng',1,350000,'Tập gym tự do trong 30 ngày'),
('Standard 3 tháng',3,900000,'Gym + lớp nhóm'),
('Premium 6 tháng',6,1600000,'Gym + lớp nhóm + ưu đãi PT');

INSERT INTO members (full_name, phone, email, gender, package_id, start_date, end_date, status) VALUES
('Nguyễn Văn Nam','0912000001','nam.member@gym.local','Nam',2,'2026-10-01','2026-12-31','Hoạt động'),
('Phạm Ngọc Lan','0912000002','lan.member@gym.local','Nữ',3,'2026-09-15','2027-03-14','Hoạt động'),
('Đỗ Hoàng Long','0912000003','long.member@gym.local','Nam',1,'2026-08-01','2026-08-31','Hết hạn');

INSERT INTO schedules (title, class_type, schedule_date, start_time, end_time, room, trainer_id, max_members) VALUES
('Morning Strength','Strength','2026-10-07','07:00:00','08:00:00','Phòng A',1,20),
('Cardio Burn','Cardio','2026-10-07','17:30:00','18:30:00','Phòng B',2,25),
('Yoga Relax','Yoga','2026-10-08','18:00:00','19:00:00','Phòng C',3,18);