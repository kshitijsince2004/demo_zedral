-- Seed data for M1 / ZedralV2 Master Schema

-- Process
INSERT INTO master.process (process_id, code, name, seq_no, has_mill_type) VALUES
(1, 'HRS', 'Hot Rolled Slitter', 1, FALSE),
(2, 'PKL', 'Pickling Line', 2, FALSE),
(3, 'CRM', 'Cold Rolling Mill', 3, TRUE),
(4, 'ANN', 'Annealing', 4, FALSE),
(5, 'SKP', 'Skin Pass Mill', 5, TRUE),
(6, 'RWD', 'Rewinding', 6, FALSE),
(7, 'CRS', 'Cold Rolled Slitter', 7, FALSE),
(8, 'CTL', 'Cut to Length', 8, FALSE),
(31, 'CRM6', 'CRM 6HI', 31, FALSE)
ON CONFLICT (process_id) DO NOTHING;

-- Shift
INSERT INTO master.shift (shift_code, name, start_time, end_time) VALUES
('A', 'Morning Shift', '06:00:00', '14:00:00'),
('B', 'Afternoon Shift', '14:00:00', '22:00:00'),
('C', 'Night Shift', '22:00:00', '06:00:00'),
('GEN', 'General Shift', '09:00:00', '17:00:00')
ON CONFLICT (shift_code) DO NOTHING;

-- Customer
INSERT INTO master.customer (customer_code, customer_name, is_active) VALUES
('CUST_TATA', 'Tata Motors', TRUE),
('CUST_MARUTI', 'Maruti Suzuki', TRUE),
('CUST_HONDA', 'Honda Siel', TRUE),
('CUST_BAJAJ', 'Bajaj Auto', TRUE)
ON CONFLICT (customer_code) DO NOTHING;

-- Grade
INSERT INTO master.grade (grade_code, description, grade_family, is_active) VALUES
('CRCA', 'Cold Rolled Close Annealed', 'CRCA', TRUE),
('HROP', 'Hot Rolled Pickled & Oiled', 'HROP', TRUE),
('D513', 'Deep Drawing Grade', 'CRCA', TRUE),
('IS2062', 'Structural Grade', 'HROP', TRUE)
ON CONFLICT (grade_code) DO NOTHING;

-- Surface Finish
INSERT INTO master.surface_finish (surface_finish, description) VALUES
('M', 'Matt Finish'),
('B', 'Bright Finish')
ON CONFLICT (surface_finish) DO NOTHING;

-- Defect Code
INSERT INTO master.defect_code (defect_code, symbol, description, applies_to, is_active) VALUES
('D_RUST', 'RU', 'Surface Rust', 'PKL,CRM,ANN,SKP,RWD,CRS,CTL', TRUE),
('D_DENT', 'DE', 'Handling Dent', 'HRS,PKL,CRM,ANN,SKP,RWD,CRS,CTL', TRUE),
('D_SCRATCH', 'SC', 'Surface Scratch', 'HRS,PKL,CRM,ANN,SKP,RWD,CRS,CTL', TRUE),
('D_WAVINESS', 'WV', 'Edge Waviness', 'CRM,SKP', TRUE)
ON CONFLICT (defect_code) DO NOTHING;

-- Stoppage Code
INSERT INTO master.stoppage_code (stoppage_code, description, category, is_planned, is_active) VALUES
('S_MECH', 'Mechanical Breakdown', 'MECH', FALSE, TRUE),
('S_ELEC', 'Electrical Failure', 'ELECT', FALSE, TRUE),
('S_POWER', 'Power Outage', 'POWER', FALSE, TRUE),
('S_MAINT', 'Planned Maintenance', 'PLANNED', TRUE, TRUE),
('S_SETUP', 'Line Setup / Changeover', 'OPN', TRUE, TRUE)
ON CONFLICT (stoppage_code) DO NOTHING;

-- Operator
INSERT INTO master.operator (emp_code, full_name, is_active) VALUES
('EMP001', 'Rajesh Kumar', TRUE),
('EMP002', 'Amit Singh', TRUE),
('EMP003', 'Suresh Sharma', TRUE),
('EMP004', 'Manoj Verma', TRUE)
ON CONFLICT (emp_code) DO NOTHING;

-- Furnace
INSERT INTO master.furnace (furnace_id, code, name, furnace_type) VALUES
(1, 'F01', 'HPH Furnace 1', 'HPH'),
(2, 'F02', 'HPH Furnace 2', 'HPH'),
(3, 'F03', 'HPH Furnace 3', 'HPH')
ON CONFLICT (furnace_id) DO NOTHING;

-- RP Oil Grade
INSERT INTO master.rp_oil_grade (rp_oil_grade, description) VALUES
('RP_100', 'Standard Rust Preventive Oil'),
('RP_200', 'Premium Rust Preventive Oil')
ON CONFLICT (rp_oil_grade) DO NOTHING;

-- Roles & Users (Security Schema)
INSERT INTO security.role (role_code, name, description) VALUES
('OPERATOR', 'Line Operator', 'Can submit shift logs for authorized lines'),
('SUPERVISOR', 'Shift Supervisor', 'Can approve logs and manage shift workflow'),
('PLANT_HEAD', 'Plant Head', 'View all reports and KPI dashboards'),
('ADMIN', 'System Administrator', 'Manage master data, users, and settings')
ON CONFLICT (role_code) DO NOTHING;

-- Admin User
INSERT INTO security.app_user (username, password_hash, display_name, role_code, status) VALUES
('admin', 'noop', 'System Administrator', 'ADMIN', 'ACTIVE')
ON CONFLICT (username) DO NOTHING;
