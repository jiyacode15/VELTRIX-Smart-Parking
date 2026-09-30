// Production always uses same-origin /api routes through Vercel Services.
// VITE_API_URL is only an optional local-development override.
export const API_BASE = (import.meta.env.DEV ? (import.meta.env.VITE_API_URL || 'http://localhost:8000') : '').replace(/\/$/, '');

const USER_KEY = 'veltrix_user';
const TOKEN_KEY = 'veltrix_token';

async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    const isJson = response.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      const errorDetail = (typeof data === 'object' && data?.detail)
        ? data.detail
        : (typeof data === 'string' && data)
        ? data
        : `Request failed with status ${response.status}`;
      throw new Error(errorDetail);
    }

    return data;
  } catch (error) {
    console.error(`API request failed for ${url}:`, error);
    throw error;
  }
}

export const authService = {
  currentUser: () => {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  },

  getToken: () => localStorage.getItem(TOKEN_KEY) || '',

  login: async ({ email, password }) => {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (data?.token && data?.user) {
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    }
    return data.user;
  },

  signup: async ({ name, email, password }) => {
    const data = await apiRequest('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });

    if (data?.token && data?.user) {
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    }
    return data.user;
  },

  logout: () => {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
  },

  getMe: async () => {
    return apiRequest('/api/auth/me');
  },
};

export const parkingService = {
  getAreas: async () => {
    return apiRequest('/api/parking-areas');
  },

  getArea: async (id) => {
    return apiRequest(`/api/parking-areas/${id}`);
  },

  getSlots: async (id) => {
    return apiRequest(`/api/parking-areas/${id}/slots`);
  },

  getNearby: async (lat, lng, radiusKm = 5) => {
    return apiRequest(`/api/parking/nearby?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius_km=${encodeURIComponent(radiusKm)}`);
  },

  geocode: async (query) => {
    return apiRequest(`/api/geocode?q=${encodeURIComponent(query)}`);
  },

  getPrediction: async (id) => {
    return apiRequest(`/api/parking/${id}/prediction`);
  },

  routeAndParking: async ({ origin, destination, radius_km = 5, arrival_minutes = 30 }) => {
    return apiRequest('/api/route-and-parking', {
      method: 'POST',
      body: JSON.stringify({
        origin,
        destination,
        radius_km,
        arrival_minutes,
      }),
    });
  },

  getOccupancyPrediction: async (id, hoursAhead = 1) => {
    return apiRequest(`/api/predictions/occupancy?parking_area_id=${encodeURIComponent(id)}&hours_ahead=${encodeURIComponent(hoursAhead)}`);
  },

  updateOccupancy: async (id, occupiedSlots, source = 'admin') => {
    return apiRequest(`/api/parking-areas/${id}/occupancy`, {
      method: 'PATCH',
      body: JSON.stringify({ occupied_slots: Number(occupiedSlots), source }),
    });
  },
};

export const bookingService = {
  createBooking: async ({ parking_id, slot_id, customer_name, phone_number, vehicle_number }) => {
    return apiRequest('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        parking_id: Number(parking_id),
        slot_id: Number(slot_id),
        customer_name,
        phone_number,
        vehicle_number,
      }),
    });
  },

  getBookings: async (phoneNumber) => {
    const query = phoneNumber ? `?phone_number=${encodeURIComponent(phoneNumber)}` : '';
    return apiRequest(`/api/bookings${query}`);
  },

  cancelBooking: async (bookingId, phoneNumber) => {
    const query = phoneNumber ? `?phone_number=${encodeURIComponent(phoneNumber)}` : '';
    return apiRequest(`/api/bookings/${encodeURIComponent(bookingId)}/cancel${query}`, {
      method: 'POST',
    });
  },
};

export const adminService = {
  getStats: async () => {
    return apiRequest('/api/admin/stats');
  },

  getBookings: async (status = '') => {
    const query = status && status !== 'ALL' ? `?status=${encodeURIComponent(status)}` : '';
    return apiRequest(`/api/admin/bookings${query}`);
  },

  getUsers: async () => {
    return apiRequest('/api/admin/users');
  },

  getMlStats: async () => {
    return apiRequest('/api/admin/ml-stats');
  },
};

export const dashboardService = {
  getOverview: async () => {
    return apiRequest('/api/dashboard/overview');
  },
};
