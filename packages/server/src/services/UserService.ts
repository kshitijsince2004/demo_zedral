import { db } from '../db';
import { hashPin } from './pinService';
import { MachineAccessService } from './MachineAccessService';
import supertokens from 'supertokens-node';
import EmailPassword from 'supertokens-node/recipe/emailpassword';
import Session from 'supertokens-node/recipe/session';

export interface LineAccessInput {
  line_id: string;
  level: string;
}

export interface UserAccessDto {
  id: string;
  username: string;
  display_name: string;
  emp_code: string | null;
  role: string;
  status: string;
  line_access: LineAccessInput[];
  machine_access: string[];
}

export interface UpsertUserInput {
  username: string;
  display_name: string;
  role: string;
  status: string;
  emp_code?: string;
  pin?: string;
  line_access?: LineAccessInput[];
  machine_access?: string[];
  email?: string;
  password?: string;
}

function isStaffRole(role: string): boolean {
  return ['ADMIN', 'PLANT_HEAD', 'MACHINE_HEAD', 'SUPERVISOR'].includes(role.toUpperCase());
}

function genTempPassword(): string {
  return Math.random().toString(36).slice(2, 12) + 'A1!';
}

const VALID_STATUSES = new Set(['ACTIVE', 'DISABLED', 'LOCKED']);
const VALID_LEVELS = new Set(['READ', 'WRITE', 'APPROVE']);

async function resolveRoleId(roleName: string): Promise<number> {
  const role = await db
    .selectFrom('security.role')
    .select('role_id')
    .where('role_name', '=', roleName)
    .executeTakeFirst();

  if (!role) {
    throw new Error(`Unknown role: ${roleName}`);
  }
  return role.role_id;
}

async function resolveProcessId(processCode: string): Promise<number> {
  const process = await db
    .selectFrom('master.process')
    .select('process_id')
    .where('code', '=', processCode.toUpperCase())
    .executeTakeFirst();

  if (!process) {
    throw new Error(`Unknown process line: ${processCode}`);
  }
  return process.process_id;
}

async function loadLineAccess(userId: number): Promise<LineAccessInput[]> {
  const rows = await db
    .selectFrom('security.line_access')
    .innerJoin('master.process', 'security.line_access.process_id', 'master.process.process_id')
    .select(['master.process.code', 'security.line_access.access_level'])
    .where('security.line_access.user_id', '=', userId)
    .execute();

  return rows.map((r) => ({
    line_id: r.code,
    level: r.access_level,
  }));
}

async function loadPrimaryRole(userId: number): Promise<string> {
  const row = await db
    .selectFrom('security.user_role')
    .innerJoin('security.role', 'security.user_role.role_id', 'security.role.role_id')
    .select('security.role.role_name')
    .where('security.user_role.user_id', '=', userId)
    .orderBy('security.role.role_id', 'asc')
    .executeTakeFirst();

  return row?.role_name ?? 'OPERATOR';
}

async function toDto(user: {
  user_id: number;
  username: string;
  full_name: string;
  emp_code: string | null;
  status: string;
}): Promise<UserAccessDto> {
  return {
    id: String(user.user_id),
    username: user.username,
    display_name: user.full_name,
    emp_code: user.emp_code,
    role: await loadPrimaryRole(user.user_id),
    status: user.status,
    line_access: await loadLineAccess(user.user_id),
    machine_access: await MachineAccessService.getForUser(user.user_id),
  };
}

async function replaceLineAccess(userId: number, lineAccess: LineAccessInput[]) {
  await db.deleteFrom('security.line_access').where('user_id', '=', userId).execute();

  for (const entry of lineAccess) {
    const level = entry.level.toUpperCase();
    if (!VALID_LEVELS.has(level)) {
      throw new Error(`Invalid access level: ${entry.level}`);
    }
    const processId = await resolveProcessId(entry.line_id);
    await db
      .insertInto('security.line_access')
      .values({
        user_id: userId,
        process_id: processId,
        access_level: level,
      })
      .execute();
  }
}

async function replaceRole(userId: number, roleName: string) {
  const roleId = await resolveRoleId(roleName);
  await db.deleteFrom('security.user_role').where('user_id', '=', userId).execute();
  await db.insertInto('security.user_role').values({ user_id: userId, role_id: roleId }).execute();
}

export class UserService {
  static async list(): Promise<UserAccessDto[]> {
    const users = await db
      .selectFrom('security.app_user')
      .select(['user_id', 'username', 'full_name', 'emp_code', 'status'])
      .orderBy('username', 'asc')
      .execute();

    return Promise.all(users.map((u) => toDto(u)));
  }

  static async getById(userId: string): Promise<UserAccessDto | null> {
    const user = await db
      .selectFrom('security.app_user')
      .select(['user_id', 'username', 'full_name', 'emp_code', 'status'])
      .where('user_id', '=', Number(userId))
      .executeTakeFirst();

    return user ? toDto(user) : null;
  }

  static async create(input: UpsertUserInput, assignedBy?: number): Promise<UserAccessDto> {
    if (!input.username?.trim()) throw new Error('username is required');
    if (!input.display_name?.trim()) throw new Error('display_name is required');
    if (!VALID_STATUSES.has(input.status)) throw new Error(`Invalid status: ${input.status}`);

    const empCode = (input.emp_code || input.username).trim();
    const values: Record<string, unknown> = {
      username: input.username.trim(),
      full_name: input.display_name.trim(),
      emp_code: empCode,
      status: input.status,
    };
    if (input.email?.trim()) {
      values.email = input.email.trim();
    }

    if (input.pin?.trim()) {
      if (!/^\d{4}$/.test(input.pin.trim())) {
        throw new Error('PIN must be exactly 4 digits');
      }
      values.pin_hash = hashPin(input.pin.trim());
      values.pin_failed_attempts = 0;
      values.pin_locked_until = null;
    }

    const created = await db
      .insertInto('security.app_user')
      .values(values as any)
      .returning(['user_id', 'username', 'full_name', 'emp_code', 'status'])
      .executeTakeFirstOrThrow();

    await replaceRole(created.user_id, input.role);
    if (input.machine_access !== undefined) {
      await MachineAccessService.setForUser(
        created.user_id,
        input.machine_access,
        assignedBy ?? created.user_id,
      );
    } else {
      await replaceLineAccess(created.user_id, input.line_access ?? []);
    }

    if (isStaffRole(input.role) && input.email?.trim()) {
      const signUp = await EmailPassword.signUp('public', input.email.trim(), input.password || genTempPassword());
      if (signUp.status === 'OK') {
        await db.updateTable('security.app_user')
          .set({ supertokens_user_id: signUp.user.id })
          .where('user_id', '=', created.user_id).execute();
      } else if (signUp.status === 'EMAIL_ALREADY_EXISTS_ERROR') {
        throw new Error('Email already registered');
      }
    }

    return toDto(created);
  }

  static async update(
    userId: string,
    input: Partial<UpsertUserInput>,
    assignedBy?: number,
  ): Promise<UserAccessDto> {
    const existing = await db
      .selectFrom('security.app_user')
      .select(['user_id', 'username', 'full_name', 'emp_code', 'status', 'supertokens_user_id', 'email'])
      .where('user_id', '=', Number(userId))
      .executeTakeFirst();

    if (!existing) {
      throw new Error('User not found');
    }

    const updates: Record<string, unknown> = {};

    if (input.username?.trim()) updates.username = input.username.trim();
    if (input.display_name?.trim()) updates.full_name = input.display_name.trim();
    if (input.emp_code?.trim()) updates.emp_code = input.emp_code.trim();
    if (input.email?.trim()) updates.email = input.email.trim();
    
    if (input.status) {
      if (!VALID_STATUSES.has(input.status)) throw new Error(`Invalid status: ${input.status}`);
      updates.status = input.status;
      
      if (input.status === 'DISABLED' && existing.supertokens_user_id) {
        await Session.revokeAllSessionsForUser(existing.supertokens_user_id);
      }
    }
    if (input.pin?.trim()) {
      if (!/^\d{4}$/.test(input.pin.trim())) {
        throw new Error('PIN must be exactly 4 digits');
      }
      updates.pin_hash = hashPin(input.pin.trim());
      updates.pin_failed_attempts = 0;
      updates.pin_locked_until = null;
    }

    let user = existing;
    if (Object.keys(updates).length > 0) {
      user = await db
        .updateTable('security.app_user')
        .set(updates as any)
        .where('user_id', '=', Number(userId))
        .returning(['user_id', 'username', 'full_name', 'emp_code', 'status', 'supertokens_user_id', 'email'])
        .executeTakeFirstOrThrow();
    }

    if (existing.supertokens_user_id) {
      const recipeUserId = new supertokens.RecipeUserId(existing.supertokens_user_id);
      if (input.email?.trim() && input.email.trim() !== existing.email) {
        await EmailPassword.updateEmailOrPassword({
          recipeUserId,
          email: input.email.trim(),
        });
      }
      if (input.password?.trim()) {
        await EmailPassword.updateEmailOrPassword({
          recipeUserId,
          password: input.password.trim(),
        });
      }
    } else if (input.email?.trim() && isStaffRole(input.role || await loadPrimaryRole(existing.user_id))) {
      const signUp = await EmailPassword.signUp('public', input.email.trim(), input.password || genTempPassword());
      if (signUp.status === 'OK') {
        await db.updateTable('security.app_user')
          .set({ supertokens_user_id: signUp.user.id })
          .where('user_id', '=', existing.user_id).execute();
      } else if (signUp.status === 'EMAIL_ALREADY_EXISTS_ERROR') {
        throw new Error('Email already registered');
      }
    }

    if (input.role) {
      await replaceRole(Number(userId), input.role);
    }
    if (input.machine_access !== undefined) {
      await MachineAccessService.setForUser(
        Number(userId),
        input.machine_access,
        assignedBy ?? Number(userId),
      );
    } else if (input.line_access) {
      await replaceLineAccess(Number(userId), input.line_access);
    }

    return toDto(user);
  }

  static async updateMachineAccess(
    userId: string,
    machineCodes: string[],
    assignedBy: number,
  ): Promise<UserAccessDto> {
    const existing = await this.getById(userId);
    if (!existing) throw new Error('User not found');
    await MachineAccessService.setForUser(Number(userId), machineCodes, assignedBy);
    return (await this.getById(userId))!;
  }

  static async updateLineAccess(userId: string, lineAccess: LineAccessInput[]): Promise<UserAccessDto> {
    const existing = await this.getById(userId);
    if (!existing) {
      throw new Error('User not found');
    }
    await replaceLineAccess(Number(userId), lineAccess);
    return (await this.getById(userId))!;
  }
}
