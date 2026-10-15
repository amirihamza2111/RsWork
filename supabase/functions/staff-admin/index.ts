// Staff account management (needs the Auth admin API, so it can't run in the
// browser). Callers must be a manager of the target restaurant or superadmin.
//
// POST { action: 'create', name, email, password, phone?, role?, restaurantId? }
// POST { action: 'update', userId, name?, phone?, role?, isActive?, password? }
// POST { action: 'deactivate', userId }
import { HttpError, json, readJson, serve } from '../_shared/http.ts';
import { admin, requireCaller } from '../_shared/supabase.ts';

const MANAGER_ALLOWED_ROLES = new Set(['manager', 'waiter', 'cashier', 'cook']);
const SUPERADMIN_ROLES = new Set([...MANAGER_ALLOWED_ROLES, 'superadmin']);
// Effectively permanent: Supabase Auth refuses sign-in for banned users.
const DEACTIVATED_BAN = '876000h';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Profile {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  restaurant_id: string | null;
  is_active: boolean;
}

const toDto = (p: Profile) => ({
  _id: p.id,
  name: p.name,
  email: p.email,
  role: p.role,
  phone: p.phone,
  restaurant: p.restaurant_id,
  isActive: p.is_active,
});

const loadProfile = async (id: string): Promise<Profile | null> => {
  const { data } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
  return (data as Profile) ?? null;
};

const ownsRestaurant = async (userId: string, restaurantId: string | null) => {
  if (!restaurantId) return false;
  const { data } = await admin
    .from('restaurants')
    .select('id')
    .eq('id', restaurantId)
    .eq('owner_id', userId)
    .maybeSingle();
  return Boolean(data);
};

// Manager of the restaurant (assigned or owner) or superadmin.
const canManage = async (me: Profile, restaurantId: string | null) => {
  if (me.role === 'superadmin') return true;
  if (me.role !== 'manager' || !restaurantId) return false;
  return me.restaurant_id === restaurantId || (await ownsRestaurant(me.id, restaurantId));
};

const allowedRoles = (me: Profile) => (me.role === 'superadmin' ? SUPERADMIN_ROLES : MANAGER_ALLOWED_ROLES);

serve(async (req) => {
  const caller = await requireCaller(req);
  const me = await loadProfile(caller.id);
  if (!me?.is_active || !['manager', 'superadmin'].includes(me.role)) {
    throw new HttpError(403, 'Only managers can manage staff');
  }

  const body = await readJson(req);
  const action = String(body.action ?? '');

  if (action === 'create') {
    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const role = String(body.role ?? 'waiter').trim();
    const phone = body.phone ? String(body.phone).trim() : undefined;
    const restaurantId = (body.restaurantId as string | undefined) || me.restaurant_id;

    if (!name || !EMAIL_RE.test(email)) throw new HttpError(400, 'Please provide a name and a valid email');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    if (!allowedRoles(me).has(role)) throw new HttpError(400, 'Invalid role for staff account');
    if (!(await canManage(me, restaurantId))) throw new HttpError(403, 'Restaurant context is required');

    // Role and restaurant travel in app_metadata (service-role only); the
    // on_auth_user_created trigger turns them into the profile row.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, phone },
      app_metadata: { staff_role: role, restaurant_id: restaurantId },
    });
    if (error) {
      throw new HttpError(400, /already|exists|registered/i.test(error.message) ? 'Email already in use' : error.message);
    }
    const created = await loadProfile(data.user.id);
    return json({ user: created ? toDto(created) : null }, 201);
  }

  if (action === 'update' || action === 'deactivate') {
    const target = await loadProfile(String(body.userId ?? ''));
    if (!target) throw new HttpError(404, 'User not found');
    if (!(await canManage(me, target.restaurant_id))) throw new HttpError(403, 'Forbidden');
    // Another manager must not be able to take over the owner's account.
    if (me.role !== 'superadmin' && target.id !== me.id && (await ownsRestaurant(target.id, target.restaurant_id))) {
      throw new HttpError(403, "Only the owner can change the owner's account");
    }

    const patch: Partial<Profile> = {};
    if (action === 'deactivate') {
      patch.is_active = false;
    } else {
      if (body.name !== undefined) patch.name = String(body.name).trim();
      if (body.phone !== undefined) patch.phone = String(body.phone).trim() || null;
      if (body.isActive !== undefined) patch.is_active = Boolean(body.isActive);
      if (body.role !== undefined) {
        const role = String(body.role).trim();
        if (!allowedRoles(me).has(role)) throw new HttpError(400, 'Invalid role for staff account');
        patch.role = role;
      }
    }

    const authPatch: Record<string, unknown> = {};
    if (patch.is_active !== undefined && patch.is_active !== target.is_active) {
      authPatch.ban_duration = patch.is_active ? 'none' : DEACTIVATED_BAN;
    }
    if (patch.role && patch.role !== target.role) {
      authPatch.app_metadata = { staff_role: patch.role, restaurant_id: target.restaurant_id };
    }
    // There is no email delivery, so a forgotten password is reset by a manager.
    if (action === 'update' && body.password !== undefined && body.password !== '') {
      const password = String(body.password);
      if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
      authPatch.password = password;
    }
    if (Object.keys(authPatch).length) {
      const { error } = await admin.auth.admin.updateUserById(target.id, authPatch);
      if (error) throw new HttpError(400, error.message);
    }

    if (!Object.keys(patch).length) return json({ user: toDto(target) });
    const { data, error } = await admin.from('profiles').update(patch).eq('id', target.id).select('*').single();
    if (error) throw new HttpError(400, error.message);
    return json({ user: toDto(data as Profile) });
  }

  throw new HttpError(400, 'Unknown action');
});
