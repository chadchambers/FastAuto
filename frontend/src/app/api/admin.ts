const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1';

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('access_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...options?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Ошибка сервера' }));
    throw new Error(err.detail ?? 'Ошибка');
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Types

export type UserRole = 'admin' | 'manager' | 'support' | 'user';
export type UserStatus = 'active' | 'inactive' | 'banned';
export type CarStatus = 'available' | 'reserved' | 'sold' | 'inactive';
// Listing statuses from new backend
export type ListingStatus = 'draft' | 'pending_review' | 'active' | 'reserved' | 'sold' | 'archived';
export type MessageStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
// For backward compat - maps old offer status to ticket status
export type CarOfferStatus = 'pending' | 'approved' | 'rejected';
export type DealStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  phone: string | null;
  created_at: string;
}

// AdminCar now maps from Listing (the new backend listing model)
export interface AdminCar {
  id: string;
  brand: string;    // mark_name from list endpoint
  model: string;    // model_name from list endpoint
  year: number;
  price: number;    // integer in new backend
  mileage: number;
  status: CarStatus;
  fuel_type: string | null;   // engine_type
  transmission: string | null;
  body_type: string | null;
  engine_volume: string | null;
  engine_power: number | null;
  color: string | null;
  vin: string | null;
  description: string | null;
  created_at: string;
  images: { id: string; url: string; thumbnail_url: string; is_primary: boolean; sort_order: number }[];
  // new fields
  listing_status: ListingStatus;
  mark_id?: string;
  model_id?: string;
  seller_id?: string;
}

// Car offer mapped from pending listing (moderation queue)
export interface AdminCarOffer {
  id: string;
  user_id: string;
  brand: string;    // mark_id
  model: string;    // model_id
  year: number;
  price: number;
  mileage: number;
  status: CarOfferStatus;
  rejection_reason: string | null;
  created_at: string;
  images: { id: string; url: string; thumbnail_url: string; is_primary: boolean; sort_order: number }[];
}

// Ticket (replaces Message)
export interface AdminMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  body: string;
  message_type: string;
  status: MessageStatus;
  car_id: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminDeal {
  id: string;
  deal_date: string;
  amount: string;
  payment_method: string;
  status: DealStatus;
  notes: string | null;
  car_id: string;
  client_id: string;
  manager_id: string;
  created_at: string;
}

// New backend DashboardStats (matches /admin/stats response)
export interface DashboardStats {
  // Real backend fields
  total_listings: number;
  active_listings: number;
  reserved_listings: number;
  sold_listings: number;
  total_reservations: number;
  active_reservations: number;
  settling_reservations: number;
  completed_reservations: number;
  total_users: number;
  open_tickets: number;
  // Legacy aliases (mapped from real fields for backward compat with UI)
  total_cars: number;
  available_cars: number;
  sold_cars: number;
  reserved_cars: number;
  total_clients: number;
  total_deals: number;
  completed_deals: number;
  pending_deals: number;
  new_messages: number;
  total_viewings: number;
  pending_offers: number;
  total_offers: number;
}

export interface AdminListingFilters {
  sort?: string;
  cursor?: string;
  limit?: number;
  mark_id?: string;
  model_id?: string;
  price_min?: number;
  price_max?: number;
  year_min?: number;
  year_max?: number;
  engine_type?: string;
  body_type?: string;
}

export interface UserCreate {
  full_name: string;
  email: string;
  password: string;
  role: UserRole;
}

export interface UserUpdate {
  full_name?: string;
  email?: string;
  role?: UserRole;
  status?: UserStatus;
  password?: string;
}

export interface CarCreate {
  brand: string;
  model: string;
  year: number;
  price: number;
  mileage: number;
  color?: string;
  fuel_type?: string;
  transmission?: string;
  body_type?: string;
  engine_volume?: number;
  engine_power?: number;
  description?: string;
  vin?: string;
}

// Helper: map listing status → CarStatus
function mapListingStatus(status: string): CarStatus {
  switch (status) {
    case 'active': return 'available';
    case 'reserved': return 'reserved';
    case 'sold': return 'sold';
    default: return 'inactive';
  }
}

// Helper: map listing row (from public /listings endpoint) → AdminCar
function mapListingRow(row: Record<string, unknown>): AdminCar {
  return {
    id: row.id as string,
    brand: (row.mark_name ?? row.mark_id ?? '') as string,
    model: (row.model_name ?? row.model_id ?? '') as string,
    year: row.year as number,
    price: row.price as number,
    mileage: row.mileage as number,
    status: mapListingStatus((row.status as string) ?? 'active'),
    fuel_type: (row.engine_type as string | null) ?? null,
    transmission: (row.transmission as string | null) ?? null,
    body_type: (row.body_type as string | null) ?? null,
    engine_volume: row.displacement != null ? String(row.displacement) : null,
    engine_power: (row.power as number | null) ?? null,
    color: null,
    vin: null,
    description: null,
    created_at: row.created_at as string,
    images: [],
    listing_status: (row.status ?? 'active') as ListingStatus,
    mark_id: row.mark_id as string | undefined,
    model_id: row.model_id as string | undefined,
    seller_id: row.seller_id as string | undefined,
  };
}

// Helper: map Listing object (from /admin/listings) → AdminCarOffer
function mapListingToOffer(listing: Record<string, unknown>): AdminCarOffer {
  return {
    id: listing.id as string,
    user_id: (listing.seller_id as string) ?? '',
    brand: (listing.mark_id as string) ?? '',
    model: (listing.model_id as string) ?? '',
    year: listing.year as number,
    price: listing.price as number,
    mileage: listing.mileage as number,
    status: 'pending' as CarOfferStatus,
    rejection_reason: null,
    created_at: listing.created_at as string,
    images: [],
  };
}

// Helper: map Ticket → AdminMessage (for backward compat with UI)
function mapTicketToMessage(ticket: Record<string, unknown>): AdminMessage {
  return {
    id: ticket.id as string,
    name: 'Пользователь',
    email: '',
    phone: null,
    subject: (ticket.title as string) ?? null,
    body: (ticket.title as string) ?? '',
    message_type: (ticket.type as string) ?? 'support_inquiry',
    status: (ticket.status as MessageStatus) ?? 'open',
    car_id: (ticket.listing_id as string | null) ?? null,
    assigned_to: (ticket.assignee_id as string | null) ?? null,
    created_at: ticket.created_at as string,
    updated_at: (ticket.updated_at as string) ?? (ticket.created_at as string),
  };
}

// Helper: map new DashboardStats → augmented stats with legacy aliases
function mapStats(raw: Record<string, unknown>): DashboardStats {
  const totalReservations = (raw.total_reservations as number) ?? 0;
  const completedReservations = (raw.completed_reservations as number) ?? 0;
  const settlingReservations = (raw.settling_reservations as number) ?? 0;
  const activeReservations = (raw.active_reservations as number) ?? 0;
  return {
    // Real backend fields
    total_listings: (raw.total_listings as number) ?? 0,
    active_listings: (raw.active_listings as number) ?? 0,
    reserved_listings: (raw.reserved_listings as number) ?? 0,
    sold_listings: (raw.sold_listings as number) ?? 0,
    total_reservations: totalReservations,
    active_reservations: activeReservations,
    settling_reservations: settlingReservations,
    completed_reservations: completedReservations,
    total_users: (raw.total_users as number) ?? 0,
    open_tickets: (raw.open_tickets as number) ?? 0,
    // Legacy aliases for existing UI
    total_cars: (raw.total_listings as number) ?? 0,
    available_cars: (raw.active_listings as number) ?? 0,
    sold_cars: (raw.sold_listings as number) ?? 0,
    reserved_cars: (raw.reserved_listings as number) ?? 0,
    total_clients: (raw.total_users as number) ?? 0,
    total_deals: totalReservations,
    completed_deals: completedReservations,
    pending_deals: settlingReservations,
    new_messages: (raw.open_tickets as number) ?? 0,
    total_viewings: 0,
    pending_offers: 0,
    total_offers: 0,
  };
}

// API calls

export const adminApi = {
  // Stats
  getStats: () =>
    req<Record<string, unknown>>('/admin/stats').then(mapStats),

  // Users
  getUsers: (skip = 0, limit = 20) =>
    req<{ data: AdminUser[]; count: number }>(`/admin/users?skip=${skip}&limit=${limit}`),
  createUser: (body: UserCreate) =>
    req<AdminUser>('/admin/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: string, body: UserUpdate) =>
    req<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteUser: (id: string) =>
    req<void>(`/admin/users/${id}`, { method: 'DELETE' }),

  // Listings (replaces Cars)
  getCars: async (filters: AdminListingFilters = {}) => {
    const params = new URLSearchParams();
    params.set('sort', filters.sort ?? 'newest');
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.cursor) params.set('cursor', filters.cursor);
    if (filters.mark_id) params.set('mark_id', filters.mark_id);
    if (filters.model_id) params.set('model_id', filters.model_id);
    if (filters.price_min != null) params.set('price_min', String(filters.price_min));
    if (filters.price_max != null) params.set('price_max', String(filters.price_max));
    if (filters.year_min != null) params.set('year_min', String(filters.year_min));
    if (filters.year_max != null) params.set('year_max', String(filters.year_max));
    if (filters.engine_type) params.set('engine_type', filters.engine_type);
    if (filters.body_type) params.set('body_type', filters.body_type);

    // Active listings from the public endpoint (has mark_name / model_name from JOIN)
    const activeRes = await req<{ items: Record<string, unknown>[]; next_cursor: string | null }>(
      `/listings?${params.toString()}`
    );
    const activeCars = activeRes.items.map(mapListingRow);
    const activeIds = new Set(activeCars.map(c => c.id));

    // Reserved + sold listings from the admin endpoint.
    // The public /listings endpoint filters WHERE status = 'active', so reserved/sold cars
    // would otherwise disappear from the admin panel the moment a buyer books them.
    let extraCars: AdminCar[] = [];
    try {
      const [reservedRows, soldRows] = await Promise.all([
        req<Record<string, unknown>[]>('/admin/listings?status=reserved'),
        req<Record<string, unknown>[]>('/admin/listings?status=sold'),
      ]);
      extraCars = [...reservedRows, ...soldRows]
        .filter(row => !activeIds.has(String(row.id)))   // deduplicate
        .map(mapListingRow);
    } catch {
      // Non-admin token or endpoint unavailable — fall back to active-only list
    }

    return {
      data: [...activeCars, ...extraCars],
      next_cursor: activeRes.next_cursor,
    };
  },

  // Admin cannot create/delete cars in the new backend
  // These are stubs that throw a clear error
  createCar: (_body: CarCreate): Promise<AdminCar> =>
    Promise.reject(new Error('Создание авто недоступно: пользователи создают объявления самостоятельно')),
  updateCar: (_id: string, _body: Partial<CarCreate> & { status?: CarStatus }): Promise<AdminCar> =>
    Promise.reject(new Error('Изменение авто недоступно через панель администратора')),
  deleteCar: (_id: string): Promise<void> =>
    Promise.reject(new Error('Удаление авто недоступно через панель администратора')),

  deleteListing: (id: string): Promise<void> =>
    req<void>(`/admin/listings/${id}`, { method: 'DELETE' }),

  updateListing: (id: string, body: {
    year?: number; price?: number; mileage?: number;
    color_id?: string; vin?: string; description?: string; condition?: string;
  }): Promise<Record<string, unknown>> =>
    req<Record<string, unknown>>(`/admin/listings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  getListingDetail: (id: string): Promise<Record<string, unknown>> =>
    req<Record<string, unknown>>(`/admin/listings/${id}`),

  changeListingStatus: (id: string, carStatus: string): Promise<{ id: string; status: string }> => {
    // Конвертируем frontend CarStatus → backend ListingStatus
    const statusMap: Record<string, string> = {
      available: 'active',
      reserved: 'reserved',
      sold: 'sold',
      inactive: 'archived',
    };
    const backendStatus = statusMap[carStatus] ?? carStatus;
    return req<{ id: string; status: string }>(
      `/admin/listings/${id}/status`,
      { method: 'PATCH', body: JSON.stringify({ status: backendStatus }) }
    );
  },

  // Moderation queue (pending listings) — replaces Car offers
  getOffers: async (_status?: CarOfferStatus, skip = 0, limit = 20) => {
    const listings = await req<Record<string, unknown>[]>(
      `/admin/listings?status=pending_review&skip=${skip}&limit=${limit}`
    );
    const data = listings.map(mapListingToOffer);
    return { data, count: data.length };
  },
  reviewOffer: async (id: string, action: 'approved' | 'rejected', rejection_reason?: string) => {
    if (action === 'approved') {
      const res = await req<Record<string, unknown>>(`/admin/listings/${id}/approve`, { method: 'POST' });
      return { ...mapListingToOffer(res), status: 'approved' as CarOfferStatus };
    } else {
      const res = await req<Record<string, unknown>>(`/admin/listings/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejection_reason }),
      });
      return { ...mapListingToOffer(res), status: 'rejected' as CarOfferStatus, rejection_reason: rejection_reason ?? null };
    }
  },

  // Tickets (replaces Messages)
  getMessages: async (status?: MessageStatus, skip = 0, limit = 20) => {
    let url = `/tickets?skip=${skip}&limit=${limit}`;
    if (status) url += `&status=${status}`;
    const tickets = await req<Record<string, unknown>[]>(url);
    const data = tickets.map(mapTicketToMessage);
    return { data, count: data.length };
  },
  updateMessage: (id: string, body: { status?: MessageStatus; assigned_to?: string }) =>
    req<Record<string, unknown>>(`/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: body.status,
        assignee_id: body.assigned_to,
      }),
    }).then(mapTicketToMessage),

  // Deals (not directly supported, stub)
  getDeals: (_skip = 0, _limit = 20): Promise<{ data: AdminDeal[]; count: number }> =>
    Promise.resolve({ data: [], count: 0 }),

  // Car images upload — now for listings
  uploadCarImages: async (id: string, formData: FormData): Promise<void> => {
    const token = localStorage.getItem('access_token');
    const files = formData.getAll('images') as File[];
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BASE_URL}/listings/${id}/images`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Ошибка загрузки' }));
        throw new Error(err.detail ?? 'Ошибка загрузки');
      }
    }
  },
};
