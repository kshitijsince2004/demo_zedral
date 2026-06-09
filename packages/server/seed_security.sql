-- Roles (Security Schema)
INSERT INTO security.role (role_id, role_name, description) VALUES
(1, 'OPERATOR', 'Line Operator: Can submit shift logs'),
(2, 'SUPERVISOR', 'Shift Supervisor: Can approve logs'),
(3, 'PLANT_HEAD', 'Plant Head: View all reports'),
(4, 'ADMIN', 'System Administrator: Manage master data'),
(5, 'MACHINE_HEAD', 'Machine Head: Manages assigned machines')
ON CONFLICT (role_id) DO NOTHING;

-- Admin User
INSERT INTO security.app_user (user_id, username, full_name, status) VALUES
(1, 'admin', 'System Administrator', 'ACTIVE')
ON CONFLICT (user_id) DO NOTHING;

-- Link Admin to ADMIN role
INSERT INTO security.user_role (user_id, role_id) VALUES
(1, 4)
ON CONFLICT (user_id, role_id) DO NOTHING;
